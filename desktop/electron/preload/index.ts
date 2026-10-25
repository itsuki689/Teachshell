import {contextBridge,ipcRenderer,webUtils} from 'electron';
import type {DesktopAPI} from '../../shared/api';
const invoke=(method:string,...args:unknown[])=>ipcRenderer.invoke('teachshelf:'+method,...args);
const subscribe=(channel:string,callback:(value:any)=>void)=>{const handler=(_event:Electron.IpcRendererEvent,value:unknown)=>callback(value);ipcRenderer.on(channel,handler);return()=>ipcRenderer.removeListener(channel,handler);};
const api:DesktopAPI={
 snapshot:()=>invoke('snapshot'),createCourse:input=>invoke('createCourse',input),updateCourse:(id,patch)=>invoke('updateCourse',id,patch),deleteCourse:id=>invoke('deleteCourse',id),
 importFiles:input=>invoke('importFiles',input),importDropped:(files,input)=>invoke('importDropped',files.map(file=>webUtils.getPathForFile(file)).filter(Boolean),input),
 updateMaterial:(id,patch,expected)=>invoke('updateMaterial',id,patch,expected),moveMaterials:(ids,courseID,folderID)=>invoke('moveMaterials',ids,courseID,folderID),removeMaterials:ids=>invoke('removeMaterials',ids),
 createFolder:input=>invoke('createFolder',input),updateFolder:(id,patch)=>invoke('updateFolder',id,patch),dissolveFolder:id=>invoke('dissolveFolder',id),
 openMaterial:id=>invoke('openMaterial',id),revealMaterial:id=>invoke('revealMaterial',id),previewMaterial:id=>invoke('previewMaterial',id),sync:()=>invoke('sync'),
 importLibrary:()=>invoke('importLibrary'),openLibrary:()=>invoke('openLibrary'),backupLibrary:()=>invoke('backupLibrary'),importTimetable:proposalID=>invoke('importTimetable',proposalID),saveTimetableSettings:(id,input)=>invoke('saveTimetableSettings',id,input),cancelTimetableClass:(id,mid,date,reason)=>invoke('cancelTimetableClass',id,mid,date,reason),restoreTimetableClass:(id,cid)=>invoke('restoreTimetableClass',id,cid),saveTask:task=>invoke('saveTask',task),deleteTasks:ids=>invoke('deleteTasks',ids),
 copyMCPConfiguration:()=>invoke('copyMCPConfiguration'),settings:()=>invoke('settings'),saveSettings:input=>invoke('saveSettings',input),chatHistory:()=>invoke('chatHistory'),sendChat:text=>invoke('sendChat',text),cancelChat:()=>invoke('cancelChat'),confirmTool:(id,approved)=>invoke('confirmTool',id,approved),clearChat:()=>invoke('clearChat'),
 openWebsite:(url,kind)=>invoke('openWebsite',url,kind),importWebsite:input=>invoke('importWebsite',input),inspectWebsite:kind=>invoke('inspectWebsite',kind),onChanged:callback=>subscribe('teachshelf:changed',callback),onChat:callback=>subscribe('teachshelf:chat',callback),onMenu:callback=>subscribe('teachshelf:menu',callback)
};
contextBridge.exposeInMainWorld('teachshelf',api);
