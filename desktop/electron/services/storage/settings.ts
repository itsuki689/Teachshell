import {safeStorage} from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {atomicWrite} from './atomic.ts';
import {safePath,exists} from '../filesystem/paths.ts';
import type {Settings} from '../../../shared/api.ts';
interface Stored {baseURL:string;model:string;encryptedKey?:string;mcpEnabled:boolean;mcpPort:number;mcpToken:string;theme:string;libraryPath?:string}
export class SettingsService{
 warning='';private root:string;private value:Stored={baseURL:'https://api.openai.com/v1',model:'',mcpEnabled:false,mcpPort:53142,mcpToken:randomBytes(32).toString('hex'),theme:'system'};private key='';
 constructor(root:string){this.root=root;}
 async load(){await fs.mkdir(this.root,{recursive:true});const p=await safePath(this.root,'desktop-settings.json',true);if(await exists(p)){this.value={...this.value,...JSON.parse(await fs.readFile(p,'utf8'))};if(this.value.encryptedKey){try{const result=await safeStorage.decryptStringAsync(Buffer.from(this.value.encryptedKey,'base64'));this.key=result.result;}catch{this.warning='系统密钥存储无法解密 API Key；配置已保留，请检查钥匙串或密钥环。离线资料管理仍可使用。';}}}return this;}
 view():Settings{return {ai:{baseURL:this.value.baseURL,model:this.value.model,hasKey:!!this.key},mcp:{enabled:this.value.mcpEnabled,port:this.value.mcpPort,token:this.value.mcpToken},theme:this.value.theme};}
 ai(){return {baseURL:this.value.baseURL,model:this.value.model,apiKey:this.key};}
 get libraryPath(){return this.value.libraryPath;}
 async setLibraryPath(libraryPath:string){await this.save({...this.value,libraryPath});}
 private async save(value:Stored){await atomicWrite(this.root,'desktop-settings.json',JSON.stringify(value,null,2)+'\n',true);this.value=value;}
 async update(input:{baseURL?:string;model?:string;apiKey?:string;mcpEnabled?:boolean;mcpPort?:number;theme?:string}){
  const next={...this.value};if(input.baseURL!==undefined){const u=new URL(input.baseURL);if(u.protocol!=='https:'&&!(u.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(u.hostname)))throw new Error('远程API必须使用HTTPS，本地模型允许HTTP');if(u.username||u.password||u.search||u.hash)throw new Error('API地址不能含账号、查询或片段');next.baseURL=u.href.replace(/\/$/,'');}
  if(input.model!==undefined)next.model=input.model;if(input.mcpEnabled!==undefined)next.mcpEnabled=input.mcpEnabled;if(input.mcpPort!==undefined)next.mcpPort=input.mcpPort;if(input.theme!==undefined)next.theme=input.theme;
  if(input.apiKey!==undefined){if(input.apiKey){if(!await safeStorage.isAsyncEncryptionAvailable()||(process.platform==='linux'&&safeStorage.getSelectedStorageBackend()==='basic_text'))throw new Error('系统安全密钥存储不可用，请启用系统密钥环后保存；不会以明文保存');next.encryptedKey=(await safeStorage.encryptStringAsync(input.apiKey)).toString('base64');}else delete next.encryptedKey;}
  await this.save(next);if(input.apiKey!==undefined)this.key=input.apiKey;return this.view();
 }
}
