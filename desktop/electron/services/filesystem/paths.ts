import path from 'node:path';
import fs from 'node:fs/promises';
import type {Course,LibraryState,Material,MaterialFolder} from '../../../shared/model.ts';
import {relativePath,requiredText} from '../../../shared/model.ts';
export function component(text:string,limit=120):string {
 const clean=text.normalize('NFC').replace(/[\x00-\x1f\x7f/\\:<>"|?*]/g,'_');let result='';
 for(const {segment} of new Intl.Segmenter('zh',{granularity:'grapheme'}).segment(clean)){if(Buffer.byteLength(result+segment)>limit)break;result+=segment;}
 result=result.trim().replace(/^[. ]+|[. ]+$/g,'')||'未命名';
 if(/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(result))result='_'+result;
 return result;
}
export function fileName(text:string):string {requiredText(text,255);if(text!==component(text,255)||text==='.'||text==='..')throw new Error('文件名含有跨平台不支持的字符、保留名称或过长');return text;}
export function courseDirectory(course?:Course):string {return course?.storageDirectory??(course?`files/${component(course.name)} [${course.id}]`:'files/未分类');}
export function materialRoot(state:LibraryState,courseID?:string):string {const c=state.courses.find(c=>c.id===courseID);return `${courseDirectory(c)}/${c?.materialRootName??'资料'}`;}
export function folderDirectory(state:LibraryState,folder:MaterialFolder):string {if(folder.storageDirectory)return folder.storageDirectory;const p=state.materialFolders.find(f=>f.id===folder.parentID);return `${p?folderDirectory(state,p):materialRoot(state,folder.courseID)}/${folder.name}`;}
export function materialDirectory(state:LibraryState,m:Pick<Material,'courseID'|'folderID'|'storageDirectory'>):string {const f=state.materialFolders.find(f=>f.id===m.folderID);return m.storageDirectory??(f?folderDirectory(state,f):materialRoot(state,m.courseID));}
export function materialPath(state:LibraryState,m:Material):string {let name=component(m.originalName,218);const ext=path.extname(m.originalName);if(Buffer.byteLength(m.originalName)>218&&ext.length>1&&Buffer.byteLength(ext)<=33)name=component(path.basename(m.originalName,ext),218-Buffer.byteLength(ext))+'.'+component(ext.slice(1),32);return `${materialDirectory(state,m)}/${m.storageName??`${m.id}-${name}`}`;}
export async function exists(file:string):Promise<boolean>{try{await fs.lstat(file);return true;}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return false;throw e;}}
/** Never resolve a symlink supplied by an imported index, dragged file, or recovery log. */
export async function safePath(root:string,relative:string,allowMetadata=false):Promise<string>{
 if(!allowMetadata)relativePath(relative);
 if(path.isAbsolute(relative)||relative.includes('\\')||relative.split('/').some(s=>s==='..'||s==='.'||!s))throw new Error('不安全的路径');
 const absolute=path.resolve(root,relative);if(!absolute.startsWith(root+path.sep))throw new Error('路径超出资料库');
 let cursor=root;for(const part of relative.split('/')){cursor=path.join(cursor,part);try{const stat=await fs.lstat(cursor);if(stat.isSymbolicLink())throw new Error('资料库不允许符号链接：'+relative);}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}}
 return absolute;
}
export async function safeExternal(file:string):Promise<string>{const absolute=path.resolve(file);if(!path.isAbsolute(file))throw new Error('必须选择绝对文件路径');const parsed=path.parse(absolute);let cursor=parsed.root;for(const part of absolute.slice(parsed.root.length).split(path.sep)){cursor=path.join(cursor,part);const stat=await fs.lstat(cursor);if(stat.isSymbolicLink())throw new Error('不支持导入符号链接：'+file);}return absolute;}
export const identity=(s:{dev:number;ino:number;birthtimeMs:number})=>`${s.dev}:${s.ino}:${s.birthtimeMs}`;
