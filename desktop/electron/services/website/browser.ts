import {BrowserWindow,session} from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import type {WebsiteResult} from '../../../shared/api.ts';
export type WebsiteKind='teaching'|'timetable';
export function websiteURL(raw:string,kind:WebsiteKind):URL {const url=new URL(raw);const hosts=kind==='teaching'?['selearning.nju.edu.cn','authserver.nju.edu.cn']:['ehallapp.nju.edu.cn','authserver.nju.edu.cn','ehall.nju.edu.cn'];if(url.protocol!=='https:'||url.username||url.password||(url.port&&url.port!=='443')||!hosts.includes(url.hostname))throw new Error('只允许学校官方 HTTPS 教学与登录页面');return url;}
export class WebsiteBrowser{
 private windows=new Map<WebsiteKind,BrowserWindow>();private scripts:string;private scope:string;
 constructor(scripts:string,scope:string){this.scripts=scripts;this.scope=scope;}
 partition(kind:WebsiteKind){return 'persist:teachshelf-'+this.scope+'-'+kind;}
 fetch= (url:string,init?:RequestInit)=>session.fromPartition(this.partition('teaching')).fetch(url,init);
 async open(url:string,kind:WebsiteKind){websiteURL(url,kind);let win=this.windows.get(kind);if(win&&!win.isDestroyed()){await win.loadURL(url);win.show();return;}
  const partition=this.partition(kind);const isolated=session.fromPartition(partition);isolated.setPermissionRequestHandler((_web,_permission,callback)=>callback(false));isolated.setPermissionCheckHandler(()=>false);
  win=new BrowserWindow({width:1120,height:800,title:kind==='teaching'?'教学网站':'本科课表',webPreferences:{partition,nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,allowRunningInsecureContent:false}});this.windows.set(kind,win);
  win.webContents.setWindowOpenHandler(({url})=>{try{websiteURL(url,kind);void win!.loadURL(url);}catch{}return {action:'deny'};});
  win.webContents.on('will-navigate',(e,url)=>{try{websiteURL(url,kind);}catch{e.preventDefault();}});
  win.webContents.on('will-redirect',(e,url)=>{try{websiteURL(url,kind);}catch{e.preventDefault();}});
  isolated.on('will-download',(event)=>event.preventDefault());
  win.on('closed',()=>this.windows.delete(kind));await win.loadURL(url);
 }
 async inspect(kind:WebsiteKind):Promise<WebsiteResult>{const win=this.windows.get(kind);if(!win||win.isDestroyed())throw new Error('请先打开网站并登录，进入课程或课表页面');const url=win.webContents.getURL();websiteURL(url,kind);const script=await fs.readFile(path.join(this.scripts,kind==='teaching'?'teaching.js':'timetable.js'),'utf8');const source=kind==='teaching'?`(${script})(document, location.href)`:script;const raw=await win.webContents.executeJavaScriptInIsolatedWorld(999,[{code:source}]);if(typeof raw!=='string'||raw.length>2*1024*1024)throw new Error('网站解析返回的数据无效或过大');const data=JSON.parse(kind==='teaching'?raw:decodeURIComponent(raw));return {url,title:win.webContents.getTitle(),data};}
 close(){for(const win of this.windows.values())win.close();this.windows.clear();}
}
