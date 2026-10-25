import type {TimetableSettingsInput,TimetableImportSummary} from './timetable';
import type {Course,LibraryState,Material,MaterialFolder,StudyTask} from './model';
export interface Snapshot {root:string;state:LibraryState;revision:string;warnings:string[]}
export interface ImportResult {imported:number;skipped:number;errors:string[]}
export interface Settings {ai:{baseURL:string;model:string;hasKey:boolean};mcp:{enabled:boolean;port:number;token?:string};theme:string}
export interface ChatMessage {id:string;role:'user'|'assistant'|'tool';content:string;createdAt:number;toolName?:string}
export interface ChatEvent {type:'delta'|'done'|'error'|'confirmation';text?:string;requestID?:string;toolName?:string;arguments?:unknown}
export interface WebsiteResult {proposalID?:string;url:string;title:string;data:unknown}
export interface DesktopAPI {
 snapshot():Promise<Snapshot>;
 createCourse(input:{name:string;semester?:string;teacher?:string;colorHex?:string}):Promise<Snapshot>;
 updateCourse(id:string,patch:Partial<Course>):Promise<Snapshot>;
 deleteCourse(id:string):Promise<Snapshot>;
 importFiles(input:{courseID?:string;folderID?:string;category?:string;copy?:boolean}):Promise<ImportResult>;
 importDropped(files:File[],input:{courseID?:string;folderID?:string;category?:string;copy?:boolean}):Promise<ImportResult>;
 updateMaterial(id:string,patch:Partial<Material>&{filename?:string},expected?:Partial<Material>&{filename?:string}):Promise<Snapshot>;
 moveMaterials(ids:string[],courseID?:string,folderID?:string):Promise<Snapshot>;
 removeMaterials(ids:string[]):Promise<Snapshot>;
 createFolder(input:{name:string;courseID?:string;parentID?:string}):Promise<Snapshot>;
 updateFolder(id:string,patch:Partial<MaterialFolder>):Promise<Snapshot>;
 dissolveFolder(id:string):Promise<Snapshot>;
 openMaterial(id:string):Promise<void>;
 revealMaterial(id:string):Promise<void>;
 previewMaterial(id:string):Promise<{url:string;mime:string;name:string}>;
 sync():Promise<Snapshot>;
 importLibrary():Promise<Snapshot|null>;
 openLibrary():Promise<Snapshot|null>;
 backupLibrary():Promise<string|null>;
 importTimetable(proposalID?:string):Promise<{snapshot:Snapshot;summary:TimetableImportSummary}|null>;
 saveTimetableSettings(termID:string,input:TimetableSettingsInput):Promise<Snapshot>;
 cancelTimetableClass(termID:string,meetingID:string,date:number|string,reason?:string):Promise<Snapshot>;
 restoreTimetableClass(termID:string,cancellationID:string):Promise<Snapshot>;
 saveTask(task:Partial<StudyTask>&{title:string}):Promise<Snapshot>;
 deleteTasks(ids:string[]):Promise<Snapshot>;
 copyMCPConfiguration():Promise<void>;
 settings():Promise<Settings>;
 saveSettings(input:{baseURL?:string;model?:string;apiKey?:string;mcpEnabled?:boolean;mcpPort?:number;theme?:string}):Promise<Settings>;
 chatHistory():Promise<ChatMessage[]>;
 sendChat(text:string):Promise<void>;
 cancelChat():Promise<void>;
 confirmTool(requestID:string,approved:boolean):Promise<void>;
 clearChat():Promise<void>;
 openWebsite(url:string,kind:'teaching'|'timetable'):Promise<void>;
 importWebsite(input:{proposalID:string;courseID?:string;fileKeys:string[]}):Promise<ImportResult>;
 inspectWebsite(kind:'teaching'|'timetable'):Promise<WebsiteResult>;
 onChanged(callback:(snapshot:Snapshot)=>void):()=>void;
 onChat(callback:(event:ChatEvent)=>void):()=>void;
 onMenu(callback:(action:string)=>void):()=>void;
}
declare global {interface Window {teachshelf:DesktopAPI}}
