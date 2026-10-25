import {test} from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {MCPServer,newMCPToken,rpcResponse} from '../electron/services/mcp/server.ts';
import {selectTools,swiftToolCatalog,validateArguments} from '../electron/services/mcp/tools.ts';
const definition=selectTools(['teachshelf_list_courses']);
const tools={definitions:definition,execute:()=>({courses:[],library_id:'local',library_revision:'revision'})};
const request=(method:string,params?:unknown,id:unknown=1)=>({jsonrpc:'2.0',id,method,...(params===undefined?{}:{params})});
async function running(){const server=new MCPServer(),token=newMCPToken(),port=await server.start({port:0,token,tools});return{server,token,port,url:`http://127.0.0.1:${port}/mcp`};}
async function raw(port:number,body:string):Promise<string>{return new Promise((resolve,reject)=>{const socket=net.createConnection(port,'127.0.0.1');let result='';socket.setTimeout(3000,()=>socket.destroy(new Error('timeout')));socket.on('connect',()=>socket.end(body));socket.on('data',chunk=>result+=chunk);socket.on('end',()=>resolve(result));socket.on('error',reject);});}

test('Swift catalog has exactly 25 unique tools and 14 guarded writes',()=>{assert.equal(swiftToolCatalog.length,25);assert.equal(new Set(swiftToolCatalog.map(t=>t.name)).size,25);assert.equal(swiftToolCatalog.filter(t=>!t.annotations?.readOnlyHint).length,14);assert.throws(()=>selectTools(['execute_shell']));assert.throws(()=>selectTools(['teachshelf_context','teachshelf_context']));});
test('schema validates types, limits and unknown fields without implicit HTTP coercion',()=>{
 const schema=definition[0].inputSchema;assert.doesNotThrow(()=>validateArguments({limit:20,archived:false},schema));
 for(const value of [{limit:true},{limit:'20'},{limit:101},{offset:-1},{archived:'false'},{unknown:1},[]])assert.throws(()=>validateArguments(value,schema));
});
test('protocol negotiates versions, limits capabilities and never executes notifications',async()=>{
 const initialized:any=await rpcResponse(request('initialize',{protocolVersion:'unknown',capabilities:{},clientInfo:{name:'test'}}),tools);assert.equal(initialized.result.protocolVersion,'2025-11-25');
 const list:any=await rpcResponse(request('tools/list'),tools);assert.deepEqual(list.result.tools.map((t:any)=>t.name),['teachshelf_list_courses']);
 let called=false;assert.equal(await rpcResponse({jsonrpc:'2.0',method:'tools/call',params:{name:'teachshelf_list_courses'}},{...tools,execute:()=>{called=true;return{};}}),undefined);assert.equal(called,false);
 assert.equal(((await rpcResponse(request('tools/call',{name:'teachshelf_delete_course'}),tools))as any).error.code,-32602);
 assert.equal(((await rpcResponse(request('ping',undefined,true),tools))as any).error.code,-32600);
 assert.equal(((await rpcResponse([],tools))as any).error.code,-32600);
 assert.equal(((await rpcResponse(request('tools/list',{cursor:'bad'}),tools))as any).error.code,-32602);
 assert.equal(((await rpcResponse(request('unknown'),tools))as any).error.code,-32601);
});
test('tool errors are JSON-RPC results and strict validation prevents execution',async()=>{
 let called=0;const strict={...tools,execute:()=>{called++;return{}}};
 const bad:any=await rpcResponse(request('tools/call',{name:'teachshelf_list_courses',arguments:{limit:'10'}}),strict);assert.equal(bad.result.isError,true);assert.equal(called,0);
 const good:any=await rpcResponse(request('tools/call',{name:'teachshelf_list_courses',arguments:{limit:10}}),strict);assert.equal(good.result.isError,false);assert.equal(called,1);
 const stopped:any=await rpcResponse(request('tools/call',{name:'teachshelf_list_courses'}),strict,()=>false);assert.equal(stopped.result.isError,true);assert.equal(called,1);
});
test('real HTTP enforces authorization, origin, host, path, method and version',async()=>{
 const {server,token,port,url}=await running();const headers={'Content-Type':'application/json',Authorization:`Bearer ${token}`},body=JSON.stringify(request('ping'));
 try{
  assert.equal((await fetch(url,{method:'POST',body,headers:{'Content-Type':'application/json'}})).status,401);
  assert.equal((await fetch(url,{method:'POST',body,headers})).status,200);
  assert.equal((await fetch(url,{method:'POST',body,headers:{...headers,Origin:'https://attacker.invalid'}})).status,403);
  assert.equal((await fetch(url,{method:'POST',body,headers:{...headers,Origin:`http://127.0.0.1:${port}`}})).status,200);
  assert.match(await raw(port,`POST /mcp HTTP/1.1\r\nHost: attacker.invalid\r\nAuthorization: Bearer ${token}\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`),/403/);
  assert.equal((await fetch(url,{method:'POST',body,headers:{...headers,'MCP-Protocol-Version':'2099-01-01'}})).status,400);
  assert.equal((await fetch(url,{headers})).status,405);
  assert.equal((await fetch(url+'/bad',{method:'POST',body,headers})).status,404);
  assert.equal((await fetch(url,{method:'POST',body,headers:{...headers,'Content-Type':'text/plain'}})).status,415);
  const notification=await fetch(url,{method:'POST',body:JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'}),headers});assert.equal(notification.status,202);assert.equal(await notification.text(),'');
  const parse=await fetch(url,{method:'POST',body:'{broken',headers});assert.equal((await parse.json()).error.code,-32700);
 }finally{await server.stop();}assert.equal(server.port,undefined);
});
test('HTTP rejects oversized, duplicate and chunked request framing',async()=>{
 const {server,port,token}=await running();
 try{
  const base=`POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nAuthorization: Bearer ${token}\r\nContent-Type: application/json\r\n`;
  assert.match(await raw(port,base+'Content-Length: 1048577\r\n\r\n'),/413/);
  assert.match(await raw(port,base+'Content-Length: 2\r\nContent-Length: 2\r\n\r\n{}'),/400/);
  assert.match(await raw(port,base+'Transfer-Encoding: chunked\r\n\r\n0\r\n\r\n'),/400/);
  assert.match(await raw(port,base+'X-Test: a\r\nX-Test: b\r\nContent-Length: 2\r\n\r\n{}'),/400/);
 }finally{await server.stop();}
});
test('stop drains active tool mutations before returning and permits restart',async()=>{
 const server=new MCPServer(),token=newMCPToken();let release:()=>void=()=>{},started=false,completed=false;
 const port=await server.start({port:0,token,tools:{definitions:definition,execute:async()=>{started=true;await new Promise<void>(r=>release=r);completed=true;return{};}}});
 const call=fetch(`http://127.0.0.1:${port}/mcp`,{method:'POST',body:JSON.stringify(request('tools/call',{name:'teachshelf_list_courses'})),headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'}}).catch(()=>{});
 for(let i=0;i<200&&!started;i++)await new Promise(r=>setTimeout(r,5));assert.equal(started,true);
 let stopped=false;const stop=server.stop().then(()=>stopped=true);await new Promise(r=>setTimeout(r,10));assert.equal(stopped,false);release();await stop;await call;assert.equal(completed,true);
 await server.start({port:0,token,tools});await server.stop();
});

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {Repository} from '../electron/services/storage/repository.ts';
import {createRepositoryTools,libraryRevision,planRevision} from '../electron/services/mcp/repository-tools.ts';
const identifier=()=>randomUUID().toUpperCase();
async function fixture(){const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'teachshelf-tools-'))),repo=await Repository.open(path.join(root,'Library'),{create:true}),provider=createRepositoryTools(()=>repo);return{root,repo,provider,cleanup:async()=>{await repo.close();await fs.rm(root,{recursive:true,force:true});}};}
async function context(provider:ReturnType<typeof createRepositoryTools>){return await provider.execute('teachshelf_context',{})as any;}
async function write(provider:ReturnType<typeof createRepositoryTools>,name:string,args:Record<string,unknown>){const c=await context(provider);return await provider.execute('teachshelf_'+name,{library_id:c.library_id,expected_library_revision:c.library_revision,...args})as any;}

test('repository catalog narrows unsupported occurrence behavior and exposes actual supported tools',async()=>{
 const f=await fixture();try{assert.equal(f.provider.definitions.length,24);assert.ok(!f.provider.definitions.some(t=>t.name==='teachshelf_list_occurrences'));assert.deepEqual(f.provider.definitions.find(t=>t.name==='teachshelf_update_plan')!.inputSchema.properties!.scope.enum,['all']);assert.equal(f.provider.definitions.find(t=>t.name==='teachshelf_get_plan')!.inputSchema.properties!.original_date,undefined);}finally{await f.cleanup();}
});
test('course/material/folder tools roundtrip metadata and physical operations without path disclosure',async()=>{
 const f=await fixture();try{
  const courseID=identifier(),folderID=identifier();await write(f.provider,'create_course',{request_id:courseID,fields:{name:'计算机',teacher:'陈老师',archived:true,color_hex:'#123456'}});assert.equal(f.repo.state.courses[0].isArchived,true);
  await write(f.provider,'create_material_folder',{request_id:folderID,name:'第一章',course_id:courseID,color_hex:'#112233'});assert.equal(f.repo.state.materialFolders[0].colorHex,'#112233');
  const source=path.join(f.root,'讲义.txt');await fs.writeFile(source,'课程资料');await f.repo.importFiles([source],{courseID,folderID});const materialID=f.repo.state.materials[0].id;
  await write(f.provider,'update_material',{id:materialID,patch:{title:'复习资料',filename:'新的讲义.txt',notes:'重点',favorite:true}});
  const detail:any=await f.provider.execute('teachshelf_get_material',{id:materialID});assert.equal(detail.material.filename,'新的讲义.txt');assert.equal(detail.material.notes,'重点');assert.ok(!JSON.stringify(detail).includes(f.root));assert.equal(await fs.readFile(await f.repo.resolveMaterial(materialID),'utf8'),'课程资料');
  await write(f.provider,'update_material_folder',{id:folderID,patch:{name:'考试复习',color_hex:null}});assert.equal(f.repo.state.materialFolders[0].colorHex,undefined);
  await write(f.provider,'move_materials',{ids:[materialID],course_id:null,folder_id:null});assert.equal(f.repo.state.materials[0].courseID,undefined);const retained=await f.repo.resolveMaterial(materialID);
  await write(f.provider,'remove_materials',{ids:[materialID]});assert.equal(f.repo.state.materials.length,0);assert.equal(await fs.readFile(retained,'utf8'),'课程资料');
  await write(f.provider,'delete_course',{id:courseID});assert.equal(f.repo.state.courses.length,0);assert.equal(await fs.readFile(source,'utf8'),'课程资料');
 }finally{await f.cleanup();}
});
test('stale revisions, wrong library and repeated identifiers never mutate',async()=>{
 const f=await fixture();try{
  const before=await context(f.provider),id=identifier();await write(f.provider,'create_course',{request_id:id,fields:{name:'数学'}});
  await assert.rejects(f.provider.execute('teachshelf_update_course',{library_id:before.library_id,expected_library_revision:before.library_revision,id,patch:{name:'过期编辑'}}),/revision_conflict/);
  await assert.rejects(write(f.provider,'create_course',{request_id:id,fields:{name:'重复'}}),/request_id/);
  const c=await context(f.provider);await assert.rejects(f.provider.execute('teachshelf_delete_course',{library_id:'wrong',expected_library_revision:c.library_revision,id}),/资料库/);assert.equal(f.repo.state.courses[0].name,'数学');
 }finally{await f.cleanup();}
});
test('library revisions ignore last-opened and UI preferences but retain notes and plan changes',async()=>{
 const f=await fixture();try{const id=identifier();await f.repo.createCourse({id,name:'课程'});const source=path.join(f.root,'a.txt');await fs.writeFile(source,'a');await f.repo.importFiles([source],{courseID:id});const original=f.repo.state,first=libraryRevision(original);const ui=structuredClone(original);ui.appearance='dark';ui.materials[0].lastOpenedAt=42;assert.equal(libraryRevision(ui),first);ui.materials[0].notes='changed';assert.notEqual(libraryRevision(ui),first);}finally{await f.cleanup();}
});
test('ordinary plans support RFC3339 edits, statuses, conflict-safe undo and restart persistence',async()=>{
 const f=await fixture();try{
  const lib=(await context(f.provider)).library_id,id=identifier();
  const created:any=await f.provider.execute('teachshelf_create_plan',{library_id:lib,request_id:id,fields:{title:'复习',deadline:'2026-10-25T20:00:00+08:00'}});assert.equal(created.changed,true);assert.equal(f.repo.state.tasks[0].hasExecutionTime,false);assert.equal(new Date((f.repo.state.tasks[0].deadline as number)*1000+978307200000).toISOString(),'2026-10-25T12:00:00.000Z');
  const first:any=await f.provider.execute('teachshelf_get_plan',{id});const edited:any=await f.provider.execute('teachshelf_update_plan',{library_id:lib,id,expected_revision:first.plan.revision,patch:{content:'完成习题',starts_at:'2026-10-25T18:00:00+08:00',ends_at:'2026-10-25T19:00:00+08:00'}});assert.equal(f.repo.state.tasks[0].hasExecutionTime,true);assert.ok(edited.change_id);
  await assert.rejects(f.provider.execute('teachshelf_update_plan',{library_id:lib,id,expected_revision:first.plan.revision,patch:{title:'旧内容'}}),/revision_conflict/);
  await f.provider.execute('teachshelf_undo_change',{library_id:lib,change_id:edited.change_id});assert.equal(f.repo.state.tasks[0].hasExecutionTime,false);assert.equal(f.repo.state.tasks[0].endsAt,undefined);
  const completed:any=await f.provider.execute('teachshelf_set_plan_status',{library_id:lib,id,expected_revision:planRevision(f.repo.state.tasks[0]),action:'complete'});assert.ok(f.repo.state.tasks[0].completedAt);await f.provider.execute('teachshelf_undo_change',{library_id:lib,change_id:completed.change_id});assert.equal(f.repo.state.tasks[0].completedAt,undefined);
  const removed:any=await f.provider.execute('teachshelf_delete_plan',{library_id:lib,id,expected_revision:planRevision(f.repo.state.tasks[0])});assert.equal(f.repo.state.tasks.length,0);await f.provider.execute('teachshelf_undo_change',{library_id:lib,change_id:removed.change_id});assert.equal(f.repo.state.tasks[0].title,'复习');
  await assert.rejects(f.provider.execute('teachshelf_create_plan',{library_id:lib,request_id:identifier(),fields:{title:'坏日期',starts_at:'2026-02-31T10:00:00+08:00'}}),/无效日期/);
  await assert.rejects(f.provider.execute('teachshelf_create_plan',{library_id:lib,request_id:identifier(),fields:{title:'重复',repeat_rule:{frequency:'daily'}}}),/不符合/);
  assert.equal(f.repo.state.tasks.length,1);
  const persisted=f.repo.state.tasks[0];await f.repo.close();const reopened=await Repository.open(f.repo.root);
  try{assert.deepEqual(reopened.state.tasks[0],JSON.parse(JSON.stringify(persisted)));const freshProvider=createRepositoryTools(()=>reopened),detail:any=await freshProvider.execute('teachshelf_get_plan',{id});assert.equal(detail.plan.title,'复习');assert.equal(detail.plan.revision,planRevision(persisted));await assert.rejects(freshProvider.execute('teachshelf_undo_change',{library_id:lib,change_id:removed.change_id}),/过期/);}finally{await reopened.close();}
 }finally{await f.cleanup();}
});
test('undo refuses later UI edits and fixed/repeating plans reject writes',async()=>{
 const f=await fixture();try{
  const lib=(await context(f.provider)).library_id,id=identifier();const created:any=await f.provider.execute('teachshelf_create_plan',{library_id:lib,request_id:id,fields:{title:'原计划'}});await f.repo.saveTask({id,title:'界面改过'});await assert.rejects(f.provider.execute('teachshelf_undo_change',{library_id:lib,change_id:created.change_id}),/不能撤销/);
  const fixedID=identifier();await f.repo.saveTask({id:fixedID,title:'固定计划',origin:'fixed'});await assert.rejects(f.provider.execute('teachshelf_delete_plan',{library_id:lib,id:fixedID,expected_revision:planRevision(f.repo.state.tasks.find(p=>p.id===fixedID)!)}),/普通非重复/);
 }finally{await f.cleanup();}
});
