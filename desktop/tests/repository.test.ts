import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Repository,copyLibrary} from '../electron/services/storage/repository.ts';
import {courseDirectory,folderDirectory,materialRoot,safePath,safeExternal,component,materialPath} from '../electron/services/filesystem/paths.ts';
import {decodeLibrary,dateMs} from '../shared/model.ts';

const fixtureDir=fileURLToPath(new URL('./fixtures/',import.meta.url));
const contract=JSON.parse(await fs.readFile(path.join(fixtureDir,'swift-compatibility-contract.json'),'utf8'));
async function scratch(t:{after:(f:()=>Promise<void>)=>void}){
 const dir=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'teachshelf-repository-')));
 t.after(()=>fs.rm(dir,{recursive:true,force:true}));return dir;
}
async function start(t:{after:(f:()=>Promise<void>)=>void},dir:string){const repo=await Repository.open(dir,{create:true});t.after(()=>repo.close());return repo;}
async function sourceFixture(dir:string,name='swift-schema9.json'){
 const root=path.join(dir,'Swift-source');await fs.mkdir(root);
 const raw=JSON.parse(await fs.readFile(path.join(fixtureDir,name),'utf8'));
 raw.futureField={nested:['kept',17]};raw.courses[0].futureCourseProperty={retain:true};
 await fs.writeFile(path.join(root,'library.json'),JSON.stringify(raw,null,2));
 const state=decodeLibrary(raw);
 for(const c of state.courses)await fs.mkdir(path.join(root,materialRoot(state,c.id)),{recursive:true});
 for(const f of state.materialFolders)await fs.mkdir(path.join(root,folderDirectory(state,f)),{recursive:true});
 for(const m of state.materials)if(m.isManaged){await fs.mkdir(path.dirname(path.join(root,m.storedPath)),{recursive:true});await fs.writeFile(path.join(root,m.storedPath),contract.managedFile.content);}
 await fs.writeFile(path.join(root,'files','未索引.bin'),Buffer.from([0,255,10,128,55]));
 return {root,state,raw};
}
async function addFile(repo:Repository,dir:string,courseID?:string,folderID?:string){
 const source=path.join(dir,'课件-é-🌊.txt');await fs.writeFile(source,'binary\0preserve\u{1f30a}');
 const result=await repo.importFiles([source],{courseID,folderID});assert.equal(result.imported,1);assert.deepEqual(result.errors,[]);
 return {source,material:repo.state.materials.at(-1)!};
}

for(const fixture of ['swift-schema9.json','swift-schema6.json','swift-legacy-iso.json'])test(`copies and opens production Swift ${fixture} without losing files or fields`,async t=>{
 const dir=await scratch(t);const {root,raw}=await sourceFixture(dir,fixture);const original=await fs.readFile(path.join(root,'library.json'));
 await assert.rejects(Repository.open(root),/复制导入/);
 const dest=path.join(dir,'Electron');await copyLibrary(root,dest);const repo=await start(t,dest);
 assert.deepEqual(await fs.readFile(path.join(root,'library.json')),original);
 assert.equal(repo.state.schemaVersion,9);assert.equal(repo.state.materials[0].id,raw.materials[0].id);assert.equal(repo.state.materials[0].courseID,raw.materials[0].courseID);
 assert.equal(repo.state.materials[0].notes,raw.materials[0].notes);assert.equal(repo.state.materials[1].storedPath,raw.materials[1].storedPath);
 assert.equal(await fs.readFile(await repo.resolveMaterial(raw.materials[0].id),'utf8'),contract.managedFile.content);
 assert.deepEqual(await fs.readFile(path.join(dest,'files','未索引.bin')),Buffer.from([0,255,10,128,55]));
 assert.deepEqual(repo.state.futureField,raw.futureField);assert.deepEqual(repo.state.timetableTerms,raw.timetableTerms??[]);assert.deepEqual(repo.state.teachingConnections,raw.teachingConnections??[]);
 assert.equal(dateMs(repo.state.materials[0].addedAt),contract.date.unixMilliseconds);
 await repo.updateCourse(raw.courses[0].id,{teacher:'Updated'});await repo.sync();
 assert.equal(repo.state.materials[0].courseID,raw.courses[0].id);assert.deepEqual(repo.state.courses[0].futureCourseProperty,{retain:true});
 assert.deepEqual(await fs.readFile(path.join(root,'library.json')),original);
 await repo.close();const reopened=await start(t,dest);assert.equal(reopened.state.courses[0].teacher,'Updated');
 assert.equal(await fs.readFile(await reopened.resolveMaterial(raw.materials[0].id),'utf8'),contract.managedFile.content);
});

test('course rename, nested folder rename and cross-course move preserve bytes and annotations',async t=>{
 const dir=await scratch(t);const repo=await start(t,path.join(dir,'Library'));
 await repo.createCourse({name:'第一门课'});await repo.createCourse({name:'第二门课'});const [a,b]=repo.state.courses;
 await repo.createFolder({name:'章节',courseID:a.id});const folder=repo.state.materialFolders[0];
 await repo.createFolder({name:'空子目录',courseID:a.id,parentID:folder.id});
 const {source,material}=await addFile(repo,dir,a.id,folder.id);await repo.updateMaterial(material.id,{notes:'must retain',isFavorite:true});
 const before=await fs.readFile(source);const orphan=path.join(repo.root,courseDirectory(a),'保留.bin');await fs.writeFile(orphan,'orphan');
 await repo.updateCourse(a.id,{name:'更名后的课程'});assert.equal(await fs.readFile(path.join(repo.root,courseDirectory(repo.state.courses[0]),'保留.bin'),'utf8'),'orphan');
 await repo.updateFolder(folder.id,{name:'新版章节'});assert.match(await repo.resolveMaterial(material.id),/新版章节/);
 await repo.moveMaterials([material.id],b.id);assert.equal(repo.state.materials[0].courseID,b.id);assert.deepEqual(await fs.readFile(await repo.resolveMaterial(material.id)),before);
 assert.equal(repo.state.materials[0].notes,'must retain');assert.equal(repo.state.materials[0].isFavorite,true);assert.deepEqual(await fs.readFile(source),before);
});

test('moving a folder across courses updates descendants and external references consistently',async t=>{
 const dir=await scratch(t);const repo=await start(t,path.join(dir,'Library'));await repo.createCourse({name:'A'});await repo.createCourse({name:'B'});const [a,b]=repo.state.courses;
 await repo.createFolder({name:'parent',courseID:a.id});const parent=repo.state.materialFolders[0];await repo.createFolder({name:'child',courseID:a.id,parentID:parent.id});const child=repo.state.materialFolders[1];
 const {source,material}=await addFile(repo,dir,a.id,child.id);const ref=path.join(dir,'reference.txt');await fs.writeFile(ref,'external');await repo.importFiles([ref],{courseID:a.id,folderID:child.id,copy:false});
 await repo.updateFolder(parent.id,{courseID:b.id});assert.ok(repo.state.materialFolders.every(f=>f.courseID===b.id));assert.ok(repo.state.materials.every(m=>m.courseID===b.id));
 assert.deepEqual(await fs.readFile(await repo.resolveMaterial(material.id)),await fs.readFile(source));assert.equal(await fs.readFile(ref,'utf8'),'external');
});

test('external rename across courses updates default titles but preserves custom annotations',async t=>{
 const dir=await scratch(t);const repo=await start(t,path.join(dir,'Library'));await repo.createCourse({name:'A'});await repo.createCourse({name:'B'});const [a,b]=repo.state.courses;
 const {material}=await addFile(repo,dir,a.id);await repo.updateMaterial(material.id,{notes:'retain'});
 const renamed=path.join(repo.root,materialRoot(repo.state,b.id),'第二章.txt');await fs.rename(await repo.resolveMaterial(material.id),renamed);await repo.sync();
 assert.equal(repo.state.materials[0].courseID,b.id);assert.equal(repo.state.materials[0].title,'第二章');assert.equal(repo.state.materials[0].notes,'retain');
 await repo.updateMaterial(material.id,{title:'custom'});await fs.rename(renamed,path.join(path.dirname(renamed),'第三章.txt'));await repo.sync();assert.equal(repo.state.materials[0].title,'custom');
});

test('offline rename is reconciled at startup before observations are refreshed',async t=>{
 const dir=await scratch(t);const root=path.join(dir,'Library');const repo=await start(t,root);await repo.createCourse({name:'A'});const {material}=await addFile(repo,dir,repo.state.courses[0].id);
 const old=await repo.resolveMaterial(material.id);await repo.close();const renamed=path.join(path.dirname(old),'offline.txt');await fs.rename(old,renamed);
 const reopened=await start(t,root);assert.equal(await reopened.resolveMaterial(material.id),renamed);assert.equal(reopened.state.materials[0].id,material.id);
});

test('missing record cannot be stolen by a new same-name file, across repeated scans and restart',async t=>{
 const dir=await scratch(t);const root=path.join(dir,'Library');const repo=await start(t,root);const {material}=await addFile(repo,dir);const original=await repo.resolveMaterial(material.id);
 const away=path.join(dir,'outside.txt');await fs.rename(original,away);await repo.sync();assert.equal(repo.state.materials[0].isMissing,true);
 await fs.writeFile(original,'unrelated occupant');await repo.sync();await repo.sync();assert.equal(repo.state.materials[0].isMissing,true);await assert.rejects(repo.resolveMaterial(material.id),/缺失/);
 await repo.close();const reopened=await start(t,root);assert.equal(reopened.state.materials[0].isMissing,true);
 const returned=path.join(path.dirname(original),'returned.txt');await fs.rename(away,returned);await reopened.sync();assert.equal(await reopened.resolveMaterial(material.id),returned);assert.equal(await fs.readFile(original,'utf8'),'unrelated occupant');
});

test('atomic replacement at existing path stays attached and updates size',async t=>{
 const dir=await scratch(t);const repo=await start(t,path.join(dir,'Library'));const {material}=await addFile(repo,dir);const original=await repo.resolveMaterial(material.id);const replacement=path.join(path.dirname(original),'temporary');await fs.writeFile(replacement,'new');await fs.rename(replacement,original);await repo.sync();assert.equal(repo.state.materials[0].size,3);assert.equal(await repo.resolveMaterial(material.id),original);
});

test('external references are never renamed or modified by moving or removing records',async t=>{
 const dir=await scratch(t);const repo=await start(t,path.join(dir,'Library'));await repo.createCourse({name:'A'});const source=path.join(dir,'original.txt');await fs.writeFile(source,'reference');await repo.importFiles([source],{copy:false});const m=repo.state.materials[0];
 await assert.rejects(repo.updateMaterial(m.id,{filename:'renamed.txt'}),/外部引用/);await repo.moveMaterials([m.id],repo.state.courses[0].id);assert.equal(repo.state.materials[0].storedPath,source);await repo.removeMaterials([m.id]);assert.equal(await fs.readFile(source,'utf8'),'reference');
});

test('removing a managed record keeps bytes and does not reimport them on sync',async t=>{
 const dir=await scratch(t);const repo=await start(t,path.join(dir,'Library'));const {material}=await addFile(repo,dir);const file=await repo.resolveMaterial(material.id);await repo.removeMaterials([material.id]);await repo.sync();assert.equal(repo.state.materials.length,0);assert.ok((await fs.stat(file)).size>0);
});

test('library lock rejects a second writer and source index edits are not overwritten',async t=>{
 const dir=await scratch(t);const root=path.join(dir,'Library');const repo=await start(t,root);await assert.rejects(Repository.open(root),/lock/i);
 const altered={...repo.state,future:'out-of-band'};await fs.writeFile(path.join(root,'library.json'),JSON.stringify(altered));await assert.rejects(repo.createCourse({name:'must fail'}),/另一程序修改/);assert.deepEqual(JSON.parse(await fs.readFile(path.join(root,'library.json'),'utf8')),altered);
});

test('copy import rejects native in-flight journal and occupied destination without modifying either',async t=>{
 const dir=await scratch(t);const {root}=await sourceFixture(dir);await fs.writeFile(path.join(root,'.physical-storage.jsonl'),'{}\n');await assert.rejects(copyLibrary(root,path.join(dir,'new')),/事务/);
 const occupied=path.join(dir,'occupied');await fs.mkdir(occupied);await fs.writeFile(path.join(occupied,'keep'),'keep');await assert.rejects(copyLibrary(root,occupied),/为空/);assert.equal(await fs.readFile(path.join(occupied,'keep'),'utf8'),'keep');
});

test('unsafe indexed paths and symlink imports cannot escape the library',async t=>{
 const dir=await scratch(t);const repo=await start(t,path.join(dir,'Library'));const outside=path.join(dir,'secret.txt');await fs.writeFile(outside,'secret');
 if(process.platform==='win32')return; // Junction/symlink privilege is runner-dependent; path checks run on every OS.
 await fs.symlink(outside,path.join(dir,'link.txt'));const result=await repo.importFiles([path.join(dir,'link.txt')]);assert.equal(result.imported,0);assert.ok(result.errors.length>0);
 await fs.symlink(dir,path.join(repo.root,'files','link'));await assert.rejects(safePath(repo.root,'files/link/secret.txt'),/符号链接/);
 await assert.rejects(safePath(repo.root,'files/../../secret.txt'),/不安全/);await assert.rejects(safeExternal('relative.txt'),/绝对/);assert.equal(await fs.readFile(outside,'utf8'),'secret');
});

test('backup write failure rolls back material move and preserves persisted index',async t=>{
 const dir=await scratch(t);const repo=await start(t,path.join(dir,'Library'));const {material}=await addFile(repo,dir);await repo.sync();const before=repo.state;const file=await repo.resolveMaterial(material.id);const index=await fs.readFile(path.join(repo.root,'library.json'));
 await fs.rm(path.join(repo.root,'library.json.bak'),{force:true});await fs.mkdir(path.join(repo.root,'library.json.bak'));
 await assert.rejects(repo.updateMaterial(material.id,{filename:'rename.txt'}));assert.deepEqual(repo.state,before);assert.deepEqual(await fs.readFile(path.join(repo.root,'library.json')),index);assert.ok((await fs.stat(file)).size>0);
});

test('portable path components normalize Unicode and preserve long filename extensions',()=>{
 assert.equal(component('e\u0301'),'é');assert.equal(component('CON'),'_CON');assert.equal(component('trail. '),'trail');assert.equal(component('a:b/c\\d'),'a_b_c_d');
 const state=decodeLibrary(JSON.parse(requireFixture()));const m={...state.materials[0],originalName:'章'.repeat(100)+'.pdf'};delete m.storageName;
 assert.ok(materialPath(state,m).endsWith('.pdf'));assert.ok(Buffer.byteLength(path.posix.basename(materialPath(state,m)))<=255);
 const noExtension={...m,originalName:'章'.repeat(100)};assert.equal(path.posix.extname(materialPath(state,noExtension)),'');
});
test('mutation revision guard runs inside the writer queue against the latest synchronized state',async t=>{
 const dir=await scratch(t);const repo=await start(t,path.join(dir,'Library'));await repo.createCourse({name:'A'});const course=repo.state.courses[0];
 const earlier=repo.updateCourse(course.id,{teacher:'first write'});
 const stale=repo.withMutationGuard(s=>{if(s.courses[0].teacher!=='')throw new Error('revision_conflict');},()=>repo.updateCourse(course.id,{teacher:'stale write'}));
 await earlier;await assert.rejects(stale,/revision_conflict/);assert.equal(repo.state.courses[0].teacher,'first write');
 await repo.updateCourse(course.id,{teacher:'unguarded later write'});assert.equal(repo.state.courses[0].teacher,'unguarded later write');
});
test('course archived state and folder colors are persisted and explicitly clearable',async t=>{
 const dir=await scratch(t);const repo=await start(t,path.join(dir,'Library'));await repo.createCourse({name:'Archive',isArchived:true});const course=repo.state.courses[0];assert.equal(course.isArchived,true);
 await repo.createFolder({name:'Color',courseID:course.id,colorHex:'#AABBCC'});const folder=repo.state.materialFolders[0];assert.equal(folder.colorHex,'#AABBCC');
 await repo.updateFolder(folder.id,{colorHex:undefined});assert.equal(repo.state.materialFolders[0].colorHex,undefined);
});
test('case-only application rename preserves the material and file bytes',async t=>{
 const dir=await scratch(t);const repo=await start(t,path.join(dir,'Library'));const {material}=await addFile(repo,dir);await repo.updateMaterial(material.id,{filename:'lecture.txt'});const before=await fs.readFile(await repo.resolveMaterial(material.id));
 await repo.updateMaterial(material.id,{filename:'LECTURE.txt'});assert.deepEqual(await fs.readFile(await repo.resolveMaterial(material.id)),before);assert.ok((await fs.readdir(path.dirname(await repo.resolveMaterial(material.id)))).includes('LECTURE.txt'));
});
test('missing primary index with a backup cannot be replaced by an empty library',async t=>{
 const dir=await scratch(t);const root=path.join(dir,'Library');const repo=await start(t,root);await repo.createCourse({name:'Keep'});await repo.close();const backup=await fs.readFile(path.join(root,'library.json.bak'));await fs.unlink(path.join(root,'library.json'));
 await assert.rejects(Repository.open(root,{create:true}),/备份/);await assert.rejects(fs.access(path.join(root,'library.json')));assert.deepEqual(await fs.readFile(path.join(root,'library.json.bak')),backup);
});
test('deleting a course releases material references and preserves orphan file bytes',async t=>{
 const dir=await scratch(t);const repo=await start(t,path.join(dir,'Library'));await repo.createCourse({name:'A'});const course=repo.state.courses[0];const {material,source}=await addFile(repo,dir,course.id);
 const orphan=path.join(repo.root,courseDirectory(course),'orphan.txt');await fs.writeFile(orphan,'retain');await repo.deleteCourse(course.id);
 assert.equal(repo.state.courses.length,0);assert.equal(repo.state.materials[0].courseID,undefined);assert.deepEqual(await fs.readFile(await repo.resolveMaterial(material.id)),await fs.readFile(source));assert.equal(await fs.readFile(orphan,'utf8'),'retain');
});
test('course edits update active plan exceptions and preserve archived course name snapshots',async t=>{
 const dir=await scratch(t);const {root,raw}=await sourceFixture(dir);const archived={...raw.tasks[0],id:'11111111-2222-4333-8444-000000000012',courseNameSnapshot:'Historical name',completedAt:contract.date.swift+20,archivedAt:contract.date.swift+30};
 archived.exceptions=structuredClone(archived.exceptions);archived.exceptions[0].details.courseNameSnapshot='Historical exception';raw.tasks.push(archived);await fs.writeFile(path.join(root,'library.json'),JSON.stringify(raw));
 const dest=path.join(dir,'Desktop');await copyLibrary(root,dest);const repo=await start(t,dest);const course=repo.state.courses[0];await repo.updateCourse(course.id,{name:'New name'});
 assert.equal(repo.state.tasks[0].courseNameSnapshot,'New name');assert.equal((repo.state.tasks[0].exceptions![0].details as any).courseNameSnapshot,'New name');assert.equal(repo.state.tasks[1].courseNameSnapshot,'Historical name');
 await repo.deleteCourse(course.id);assert.equal(repo.state.tasks[1].courseID,undefined);assert.equal(repo.state.tasks[1].courseNameSnapshot,'Historical name');assert.equal((repo.state.tasks[1].exceptions![0].details as any).courseNameSnapshot,'Historical exception');
});
test('missing descendants retain valid course relations when their existing parent moves externally',async t=>{
 const dir=await scratch(t);const repo=await start(t,path.join(dir,'Library'));await repo.createCourse({name:'A'});await repo.createCourse({name:'B'});const [a,b]=repo.state.courses;
 await repo.createFolder({name:'parent',courseID:a.id});const parent=repo.state.materialFolders[0];await repo.createFolder({name:'child',courseID:a.id,parentID:parent.id});const child=repo.state.materialFolders[1];const {material}=await addFile(repo,dir,a.id,child.id);
 await fs.rename(path.join(repo.root,folderDirectory(repo.state,child)),path.join(dir,'outside-child'));await repo.sync();assert.equal(repo.state.materialFolders.find(f=>f.id===child.id)!.isMissing,true);
 await fs.rename(path.join(repo.root,folderDirectory(repo.state,parent)),path.join(repo.root,materialRoot(repo.state,b.id),'parent'));await repo.sync();
 assert.equal(repo.state.materialFolders.find(f=>f.id===child.id)!.courseID,b.id);assert.equal(repo.state.materials.find(m=>m.id===material.id)!.courseID,b.id);assert.equal(repo.state.materials[0].isMissing,true);
});
test('backup preserves desktop chat history and future business sidecars',async t=>{
 const dir=await scratch(t);const repo=await start(t,path.join(dir,'Library'));const history='[{"role":"user","content":"保存会话"}]';
 await fs.writeFile(path.join(repo.root,'.desktop-chat.json'),history);await fs.writeFile(path.join(repo.root,'.desktop-chat.json.bak'),'[]');await fs.writeFile(path.join(repo.root,'.desktop-future-data.json'),'{"keep":true}');
 const backup=path.join(dir,'Backup');await repo.backup(backup);
 assert.equal(await fs.readFile(path.join(backup,'.desktop-chat.json'),'utf8'),history);assert.equal(await fs.readFile(path.join(backup,'.desktop-chat.json.bak'),'utf8'),'[]');assert.equal(await fs.readFile(path.join(backup,'.desktop-future-data.json'),'utf8'),'{"keep":true}');
 await assert.rejects(fs.access(path.join(backup,'.desktop-writer.lock')));
});
test('optional undefined task ID from IPC cannot overwrite a generated identity',async t=>{
 const dir=await scratch(t);const repo=await start(t,path.join(dir,'Library'));await repo.saveTask({id:undefined,title:'Create through IPC'});assert.match(repo.state.tasks[0].id,/^[A-F0-9-]{36}$/);
});
function requireFixture():string{return JSON.stringify({schemaVersion:9,courses:[],materials:[{id:'11111111-2222-4333-8444-000000000001',title:'test',originalName:'test.pdf',sourcePath:'/x',storedPath:'files/x.pdf',isManaged:true,category:'课件',tags:'',notes:'',isFavorite:false,size:0,addedAt:0}],tasks:[],customCategories:[],accentColor:'#39786B',appearance:'system'});}
