import {app,BrowserWindow,ipcMain,dialog,Menu,shell,protocol,net,nativeTheme,session,clipboard} from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import chokidar from 'chokidar';
import {z} from 'zod';
import {Repository,copyLibrary} from '../services/storage/repository.ts';
import {SettingsService} from '../services/storage/settings.ts';
import {WebsiteBrowser} from '../services/website/browser.ts';
import {ChatService} from '../services/ai/chat.ts';
import {MCPServer} from '../services/mcp/server.ts';
import type {ToolProvider} from '../services/mcp/tools.ts';
import {createRepositoryTools} from '../services/mcp/repository-tools.ts';
import {courseInput,coursePatch,materialPatch,folderInput,folderPatch,importInput,taskInput,settingsInput,schemas,trustedSender} from './validation.ts';
import {teachingPage,downloadFile} from '../services/website/download.ts';
import {digest} from '../services/storage/atomic.ts';
import {component,safePath,exists} from '../services/filesystem/paths.ts';
import type {WebsiteResult} from '../../shared/api.ts';
import {HomeworkService} from '../services/resource/homework.ts';
import {canOpenDocument} from '../services/resource/openable.ts';
import {swiftNow} from '../../shared/model.ts';
const testRoot=process.env.TEACHSHELF_TEST_ROOT;
if(testRoot)app.setPath('userData',path.join(testRoot,'app-data'));
protocol.registerSchemesAsPrivileged([{scheme:'shelf-preview',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true}}]);
let mainWindow:BrowserWindow;let repository:Repository;let settings:SettingsService;let website:WebsiteBrowser;let chat:ChatService;let server:MCPServer;let toolProvider:ToolProvider;let watcher:ReturnType<typeof chokidar.watch>|undefined;let timer:ReturnType<typeof setTimeout>|undefined;let quitting=false;let switching=false;let rendererURL='';
const proposals=new Map<string,{result:WebsiteResult;root:string;revision:string;created:number}>();
const previews=new Map<string,{id:string;root:string;mime:string}>();
const mimeTypes:Record<string,string>={'.pdf':'application/pdf','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.mp4':'video/mp4','.webm':'video/webm','.mov':'video/quicktime','.mp3':'audio/mpeg','.wav':'audio/wav','.m4a':'audio/mp4','.txt':'text/plain','.md':'text/plain','.csv':'text/plain'};
const post=(name:string,value:unknown)=>{if(mainWindow&&!mainWindow.isDestroyed())mainWindow.webContents.send('teachshelf:'+name,value);};
async function startMCP(){await server?.stop();const config=settings.view().mcp;if(config.enabled){server=new MCPServer({port:config.port,token:config.token!,tools:toolProvider});await server.start();}}
function setupChat(){chat?.cancel();const active=repository;toolProvider=createRepositoryTools(()=>active);const instance=new ChatService({root:active.root,config:()=>settings.ai(),tools:toolProvider,onEvent:event=>{if(repository===active&&chat===instance)post('chat',event);}});chat=instance;}
async function watch(){await watcher?.close();if(timer)clearTimeout(timer);watcher=chokidar.watch(path.join(repository.root,'files'),{ignoreInitial:true,followSymlinks:false,awaitWriteFinish:{stabilityThreshold:350,pollInterval:100},ignored:p=>path.basename(p).startsWith('.')});watcher.on('all',()=>{if(timer)clearTimeout(timer);timer=setTimeout(()=>{repository.sync().catch(error=>{repository.warnings=[String(error)];post('changed',repository.snapshot());});},500);});watcher.on('error',error=>{repository.warnings=[String(error)];post('changed',repository.snapshot());});}
async function switchLibrary(root:string){
 if(switching)throw new Error('资料库正在切换，请稍候');if(await fs.realpath(root)===repository.root)return repository.snapshot();switching=true;
 const previous=repository;let next:Repository|undefined;let saved=false;
 try{next=await Repository.open(root);await settings.setLibraryPath(next.root);saved=true;chat?.cancel();await server?.stop();await watcher?.close();if(timer)clearTimeout(timer);await previous.close();repository=next;
  previews.clear();proposals.clear();website.close();website=new WebsiteBrowser(path.join(__dirname,'website-scripts'),digest(repository.root).slice(0,16));repository.onChanged=snapshot=>post('changed',snapshot);setupChat();
  try{await watch();await startMCP();}catch(e){repository.warnings.push('资料库已打开，但后台服务启动失败：'+String(e));}
  post('changed',repository.snapshot());return repository.snapshot();
 }catch(error){if(repository===previous){await next?.close();if(saved)await settings.setLibraryPath(previous.root);}throw error;}finally{switching=false;}
}
async function chooseDirectory(title:string){const result=await dialog.showOpenDialog(mainWindow,{title,properties:['openDirectory','createDirectory']});return result.canceled?null:result.filePaths[0];}
function installIPC(){
 const handle=(name:string,args:z.ZodType,fn:(...args:any[])=>unknown)=>ipcMain.handle('teachshelf:'+name,async(event,...input)=>{if(!trustedSender(event.sender.id,event.senderFrame?.url,event.senderFrame===event.sender.mainFrame,mainWindow.webContents.id,rendererURL))throw new Error('拒绝不可信页面调用');if(switching)throw new Error('资料库正在切换，请稍候');const parsed=args.parse(input) as unknown[];return fn(...parsed);});
 const none=z.tuple([]);const oneID=z.tuple([schemas.id]);const optionalID=schemas.id.nullish().transform(v=>v??undefined);

 const homework=new HomeworkService(()=>repository);const homeworkPath=z.string().max(32768);
 handle('listHomework',z.tuple([optionalID,homeworkPath.optional()]),(cid,relative)=>homework.list(cid,relative));
 handle('createHomeworkFolder',z.tuple([optionalID,homeworkPath,z.string().min(1).max(255)]),(cid,relative,name)=>homework.createFolder(cid,relative,name));
 handle('renameHomework',z.tuple([optionalID,homeworkPath,z.string().min(1).max(255)]),(cid,relative,name)=>homework.rename(cid,relative,name));
 handle('importHomework',z.tuple([optionalID,homeworkPath.optional()]),async(cid,relative)=>{const repo=repository;const chosen=await dialog.showOpenDialog(mainWindow,{title:'复制文件到作业目录',properties:['openFile','multiSelections']});if(chosen.canceled)return {imported:0,skipped:0,errors:[]};if(repo!==repository)throw new Error('资料库已切换，请重试');return homework.importFiles(cid,relative??'',chosen.filePaths);});
 handle('openHomework',z.tuple([optionalID,homeworkPath]),async(cid,relative)=>{const file=await homework.resolve(cid,relative);if(!canOpenDocument(file))throw new Error('该文件类型请在文件管理器中打开');const error=await shell.openPath(file);if(error)throw new Error(error);});
 handle('revealHomework',z.tuple([optionalID,homeworkPath]),async(cid,relative)=>{const file=await homework.resolve(cid,relative);shell.showItemInFolder(file);});
 handle('mountHomework',z.tuple([schemas.id,z.boolean().optional()]),async(cid,reset)=>{const repo=repository;if(reset)return repo.setHomeworkFolder(cid);const selected=await chooseDirectory('选择课程作业目录');if(!selected)return null;if(repo!==repository)throw new Error('资料库已切换，请重试');return repo.setHomeworkFolder(cid,selected);});
 handle('snapshot',none,()=>repository.snapshot());handle('createCourse',z.tuple([courseInput]),input=>repository.createCourse(input));handle('updateCourse',z.tuple([schemas.id,coursePatch]),(id,patch)=>repository.updateCourse(id,patch));handle('deleteCourse',oneID,id=>repository.deleteCourse(id));
 handle('importFiles',z.tuple([importInput]),async input=>{const result=await dialog.showOpenDialog(mainWindow,{title:'导入资料',properties:process.platform==='darwin'?['openFile','openDirectory','multiSelections']:['openFile','multiSelections']});if(result.canceled)return {imported:0,skipped:0,errors:[]};return repository.importFiles(result.filePaths,input);});
 handle('importDropped',z.tuple([z.array(z.string().min(1).max(32768)).max(5000),importInput]),(paths,input)=>repository.importFiles(paths,input));
 handle('updateMaterial',z.tuple([schemas.id,materialPatch,materialPatch.optional()]),(id,patch,expected)=>repository.withMutationGuard(state=>{const current=state.materials.find(m=>m.id===id);if(!current)throw new Error('资料不存在');for(const [key,value] of Object.entries(expected??{})){const actual=key==='filename'?current.originalName:current[key];if(actual!==value)throw new Error('资料已被其他操作更新，请还原并重新编辑');}},()=>repository.updateMaterial(id,patch)));handle('moveMaterials',z.tuple([schemas.ids,optionalID,optionalID]),(ids,courseID,folderID)=>repository.moveMaterials(ids,courseID,folderID));handle('removeMaterials',z.tuple([schemas.ids]),ids=>repository.removeMaterials(ids));
 handle('createFolder',z.tuple([folderInput]),input=>repository.createFolder(input));handle('updateFolder',z.tuple([schemas.id,folderPatch]),(id,patch)=>repository.updateFolder(id,patch));handle('dissolveFolder',oneID,id=>repository.dissolveFolder(id));
 handle('openMaterial',oneID,async id=>{const file=await repository.resolveMaterial(id);if(!canOpenDocument(file))throw new Error('不从资料管理器执行程序或脚本，请使用“显示文件位置”');const error=await shell.openPath(file);if(error)throw new Error(error);await repository.updateMaterial(id,{lastOpenedAt:swiftNow()});});
 handle('revealMaterial',oneID,async id=>shell.showItemInFolder(await repository.resolveMaterial(id)));
 handle('previewMaterial',oneID,async id=>{const file=await repository.resolveMaterial(id);const mime=mimeTypes[path.extname(file).toLowerCase()];if(!mime)throw new Error('该格式请使用系统应用打开');const token=randomUUID();if(previews.size>100)previews.clear();previews.set(token,{id,root:repository.root,mime});return {url:'shelf-preview://'+token+'/content',mime,name:repository.state.materials.find(m=>m.id===id)!.originalName};});
 handle('sync',none,()=>repository.sync());
 handle('importLibrary',none,async()=>{const source=await chooseDirectory('选择原版资料库（含 library.json 的文件夹）');if(!source)return null;const result=await dialog.showSaveDialog(mainWindow,{title:'选择副本资料库保存位置',defaultPath:path.join(app.getPath('documents'),'课屿跨平台资料库')});if(result.canceled||!result.filePath)return null;await copyLibrary(source,result.filePath);return switchLibrary(result.filePath);});
 handle('openLibrary',none,async()=>{const root=await chooseDirectory('打开跨平台资料库');return root?switchLibrary(root):null;});
 handle('backupLibrary',none,async()=>{const result=await dialog.showSaveDialog(mainWindow,{title:'备份完整资料库',defaultPath:path.join(app.getPath('documents'),'课屿备份-'+new Date().toISOString().slice(0,10))});return result.canceled||!result.filePath?null:repository.backup(result.filePath);});

 handle('importTimetable',z.tuple([z.string().uuid().optional()]),async proposalID=>{
  const repo=repository;let data:unknown;
  if(proposalID){const proposal=proposals.get(proposalID);if(!proposal||proposal.root!==repo.root||Date.now()-proposal.created>15*60000)throw new Error('课表预览已过期');data=proposal.result.data;}
  else {const chosen=await dialog.showOpenDialog(mainWindow,{title:'导入本科课表 JSON',properties:['openFile'],filters:[{name:'课表 JSON',extensions:['json']}]});if(chosen.canceled)return null;const p=chosen.filePaths[0];if((await fs.stat(p)).size>2*1024*1024)throw new Error('课表JSON过大');data=JSON.parse(await fs.readFile(p,'utf8'));}
  if(repo!==repository)throw new Error('资料库已切换，请重试');return repo.importTimetable(data);
 });
 const scheduleDate=z.union([z.number().finite(),z.string().datetime({offset:true})]);
 handle('saveTimetableSettings',z.tuple([schemas.id,z.object({name:z.string().min(1).max(500).optional(),weekOneMonday:scheduleDate.nullish(),weekCount:z.number().int().min(1).max(60).optional(),endDate:scheduleDate.nullish(),sectionTimes:z.array(z.object({section:z.number().int().min(1).max(30),startMinute:z.number().int().min(0).max(1439),endMinute:z.number().int().min(1).max(1440)}).strict()).max(30).optional()}).strict()]),(id,input)=>repository.saveTimetableSettings(id,input));
 handle('cancelTimetableClass',z.tuple([schemas.id,schemas.id,scheduleDate,z.string().max(2000).optional()]),(id,mid,date,reason)=>repository.cancelTimetableClass(id,mid,date,reason));
 handle('restoreTimetableClass',z.tuple([schemas.id,schemas.id]),(id,cid)=>repository.restoreTimetableClass(id,cid));
 handle('rescheduleTimetableClass',z.tuple([schemas.id,schemas.id,scheduleDate,z.object({date:scheduleDate,startSection:z.number().int().min(1).max(30),sectionCount:z.number().int().min(1).max(30),classroom:z.string().max(10000),startMinute:z.number().int().min(0).max(1439).optional(),endMinute:z.number().int().min(1).max(1440).optional()}).strict()]),(id,mid,date,input)=>repository.rescheduleTimetableClass(id,mid,date,input));
 handle('restoreTimetableMove',z.tuple([schemas.id,schemas.id]),(id,rid)=>repository.restoreTimetableMove(id,rid));

 const planScope=z.enum(['all','thisOccurrence','thisAndFuture']);
 const advancedInput=taskInput.omit({completedAt:true,archivedAt:true,cancelledAt:true}).extend({courseID:schemas.id.nullish(),endsAt:scheduleDate.nullish(),deadline:scheduleDate.nullish(),colorHex:z.string().regex(/^#[0-9a-fA-F]{6}$/).nullish(),repeatRule:z.object({frequency:z.enum(['daily','weekly','monthly']),interval:z.number().int().min(1).max(366),until:scheduleDate.optional()}).strict().nullish()}).strict();
 handle('savePlan',z.tuple([advancedInput,planScope.optional(),scheduleDate.optional()]),(input,scope,date)=>repository.savePlan(input,scope,date));
 handle('setPlanStatus',z.tuple([schemas.id,z.enum(['complete','reopen','cancel','restore','archive','unarchive','resetOccurrence']),planScope.optional(),scheduleDate.optional()]),(id,action,scope,date)=>repository.setPlanStatus(id,action,scope,date));
 handle('deletePlan',z.tuple([schemas.id,planScope.optional(),scheduleDate.optional()]),(id,scope,date)=>repository.deletePlan(id,scope,date));
 handle('saveTask',z.tuple([taskInput]),task=>repository.saveTask(task));handle('deleteTasks',z.tuple([schemas.ids]),ids=>repository.deleteTasks(ids));
 handle('copyMCPConfiguration',z.tuple([z.enum(['http','stdio']).optional()]),mode=>{const mcp=settings.view().mcp;const config=mode==='stdio'?{command:app.getPath('exe'),args:[path.join(app.isPackaged?process.resourcesPath:__dirname,'mcp-stdio.cjs'),'--config',path.join(app.getPath('userData'),'desktop-settings.json')],env:{ELECTRON_RUN_AS_NODE:'1'}}:{url:`http://127.0.0.1:${mcp.port}/mcp`,headers:{Authorization:`Bearer ${mcp.token}`}};clipboard.writeText(JSON.stringify({mcpServers:{teachshelf:config}},null,2));});handle('settings',none,()=>settings.view());handle('saveSettings',z.tuple([settingsInput]),async input=>{const previous=settings.view();const result=await settings.update(input);nativeTheme.themeSource=result.theme as 'system'|'light'|'dark';try{await startMCP();}catch(e){await settings.update({mcpEnabled:previous.mcp.enabled,mcpPort:previous.mcp.port});await startMCP();throw new Error('MCP启动失败，已恢复原设置：'+String(e));}return result;});
 handle('chatHistory',none,()=>chat.history());handle('sendChat',z.tuple([z.string().min(1).max(20000)]),text=>chat.send(text));handle('cancelChat',none,()=>chat.cancel());handle('confirmTool',z.tuple([z.string().uuid(),z.boolean()]),(id,approved)=>chat.confirm(id,approved));handle('clearChat',none,()=>chat.clear());
 handle('openWebsite',z.tuple([z.string().url().max(3000),z.enum(['teaching','timetable'])]),(url,kind)=>website.open(url,kind));handle('inspectWebsite',z.tuple([z.enum(['teaching','timetable'])]),async kind=>{const result=await website.inspect(kind);const proposalID=randomUUID();proposals.clear();proposals.set(proposalID,{result,root:repository.root,revision:repository.snapshot().revision,created:Date.now()});return {...result,proposalID};});
 handle('importWebsite',z.tuple([z.object({proposalID:z.string().uuid(),courseID:optionalID,fileKeys:z.array(z.string().max(4000)).min(1).max(500)}).strict()]),async input=>{
  const proposal=proposals.get(input.proposalID);if(!proposal||proposal.root!==repository.root||Date.now()-proposal.created>15*60000)throw new Error('网站导入预览已过期，请重新读取');
  const page=teachingPage.parse(proposal.result.data);if(page.kind==='course')throw new Error('请进入资料页面后选择文件');
  const check=async()=>{const current=teachingPage.parse((await website.inspect('teaching')).data);if(current.accountID!==page.accountID||current.courseID!==page.courseID||JSON.stringify(current.files)!==JSON.stringify(page.files))throw new Error('网站账号或资料列表已变化，请重新读取');};
  await check();const repo=repository;await repo.sync();if(repo.snapshot().revision!==proposal.revision)throw new Error('资料库已变化，请重新读取预览');
  const files=input.fileKeys.map((key:string)=>{const file=page.files.find(f=>f.key===key);if(!file)throw new Error('预览不包含此文件');return file;});
  const cache=path.join(app.getPath('userData'),'WebsiteDownloads');await fs.mkdir(cache,{recursive:true});const canonicalCache=await fs.realpath(cache);const paths:string[]=[];
  for(const file of files){const bucket=await safePath(canonicalCache,digest(page.accountID+':'+page.courseID+':'+file.key),true);await fs.mkdir(bucket,{recursive:true});const target=await safePath(bucket,component(file.name,218),true);const temp=await safePath(bucket,randomUUID()+'.download',true);try{await downloadFile(website.fetch as typeof fetch,file.url,temp,file.name);if(await exists(target))await fs.unlink(target);await fs.rename(temp,target);paths.push(target);}finally{await fs.rm(temp,{force:true});}}
  await check();if(repo!==repository)throw new Error('资料库已切换，请重新读取');
  return repo.withMutationGuard(()=>{if(repo.snapshot().revision!==proposal.revision)throw new Error('资料库已变化，请重新读取');},()=>repo.importFiles(paths,{courseID:input.courseID,category:'课件',copy:true}));
 });
}
function menu(){const action=(value:string)=>()=>post('menu',value);const template:Electron.MenuItemConstructorOptions[]=[...(process.platform==='darwin'?[{role:'appMenu' as const}]:[]),{label:'文件',submenu:[{label:'新建课程',accelerator:'CmdOrCtrl+N',click:action('create-course')},{label:'导入资料',accelerator:'CmdOrCtrl+O',click:action('import')},{label:'复制导入资料库',click:action('import-library')},{type:'separator'},{role:'close'}]},{role:'editMenu'},{label:'视图',submenu:[{label:'全部资料',accelerator:'CmdOrCtrl+1',click:action('all')},{label:'计划',accelerator:'CmdOrCtrl+2',click:action('plans')},{label:'AI 助手',accelerator:'CmdOrCtrl+3',click:action('ai')},{label:'设置',accelerator:'CmdOrCtrl+,',click:action('settings')},{label:'同步文件',accelerator:'CmdOrCtrl+R',click:()=>void repository.sync().catch(e=>dialog.showErrorBox('同步失败',String(e)))},{type:'separator'},{role:'togglefullscreen'}]},{role:'windowMenu'}];Menu.setApplicationMenu(Menu.buildFromTemplate(template));}
async function start(){
 settings=await new SettingsService(app.getPath('userData')).load();repository=await Repository.open(testRoot?path.join(testRoot,'library'):settings.libraryPath??path.join(app.getPath('userData'),'Library'),{create:true});repository.onChanged=snapshot=>post('changed',snapshot);
 if(settings.warning)repository.warnings.push(settings.warning);
 website=new WebsiteBrowser(path.join(__dirname,'website-scripts'),digest(repository.root).slice(0,16));setupChat();
 protocol.handle('shelf-preview',async request=>{try{const url=new URL(request.url);const item=previews.get(url.hostname);if(!item||item.root!==repository.root||url.pathname!=='/content')return new Response('Not found',{status:404});const file=await repository.resolveMaterial(item.id);const response=await net.fetch(pathToFileURL(file).href,{headers:request.headers});const headers=new Headers(response.headers);headers.set('Content-Type',item.mime==='text/plain'?'text/plain; charset=utf-8':item.mime);headers.set('Content-Security-Policy',"default-src 'none'; sandbox");headers.set('X-Content-Type-Options','nosniff');return new Response(response.body,{status:response.status,headers});}catch{return new Response('File unavailable',{status:404});}});
 mainWindow=new BrowserWindow({width:1260,height:800,minWidth:1020,minHeight:680,title:'课屿 Desktop',show:false,backgroundColor:'#f5f6f5',titleBarStyle:process.platform==='darwin'?'hiddenInset':'default',webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true,allowRunningInsecureContent:false}});
 mainWindow.webContents.session.setPermissionRequestHandler((_web,_permission,callback)=>callback(false));mainWindow.webContents.session.setPermissionCheckHandler(()=>false);mainWindow.webContents.setWindowOpenHandler(()=>({action:'deny'}));mainWindow.webContents.on('will-navigate',e=>e.preventDefault());mainWindow.webContents.on('will-attach-webview',e=>e.preventDefault());
 rendererURL=!app.isPackaged&&process.env.TEACHSHELF_DEV_URL==='http://127.0.0.1:5173'?'http://127.0.0.1:5173/':pathToFileURL(path.join(__dirname,'../dist/index.html')).href;installIPC();menu();await mainWindow.loadURL(rendererURL);mainWindow.show();await watch();try{await startMCP();}catch(e){repository.warnings.push('MCP 启动失败：'+String(e));post('changed',repository.snapshot());}
}
if(!app.requestSingleInstanceLock())app.quit();else{app.on('second-instance',()=>{mainWindow?.show();mainWindow?.focus();});app.whenReady().then(start).catch(e=>{dialog.showErrorBox('课屿启动失败',String(e));app.quit();});}
app.on('window-all-closed',()=>app.quit());app.on('before-quit',event=>{if(quitting)return;event.preventDefault();quitting=true;chat?.cancel();if(timer)clearTimeout(timer);website?.close();Promise.allSettled([watcher?.close(),server?.stop(),repository?.close()]).finally(()=>app.quit());});
