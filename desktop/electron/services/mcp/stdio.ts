import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {protocolVersions} from './server.ts';
export interface BridgeConfig {enabled:boolean;port:number;token:string}
export async function loadBridgeConfig(file:string):Promise<BridgeConfig>{
 if(!path.isAbsolute(file))throw new Error('配置路径必须为绝对路径');const st=await fs.lstat(file);if(!st.isFile()||st.isSymbolicLink()||st.size>1000000)throw new Error('配置文件不安全或过大');
 if(process.platform!=='win32'&&(st.uid!==process.getuid?.()||(st.mode&0o077)!==0))throw new Error('配置必须由当前用户拥有且权限为0600');
 const value=JSON.parse(await fs.readFile(file,'utf8'));const config={enabled:value.mcpEnabled??value.enabled,port:value.mcpPort??value.port,token:value.mcpToken??value.token};
 if(typeof config.enabled!=='boolean'||!Number.isInteger(config.port)||config.port<1024||config.port>65535||typeof config.token!=='string'||!/^[a-f\d]{64}$/i.test(config.token))throw new Error('MCP配置无效');return config;
}
export async function forwardLine(data:Buffer,config:BridgeConfig,version:string):Promise<unknown|undefined>{
 if(!config.enabled)throw new Error('请先在课屿 Desktop 设置中启用 MCP');
 return new Promise((resolve,reject)=>{const request=http.request({host:'127.0.0.1',port:config.port,path:'/mcp',method:'POST',headers:{Authorization:'Bearer '+config.token,'Content-Type':'application/json','Content-Length':data.length,Accept:'application/json','MCP-Protocol-Version':version}},response=>{
  if(![200,202].includes(response.statusCode??0)){response.resume();reject(new Error('MCP连接被拒绝，请核对应用、端口和密钥'));return;}
  const chunks:Buffer[]=[];let size=0;response.on('data',chunk=>{size+=chunk.length;if(size>1_048_576){request.destroy(new Error('MCP响应过大'));return;}chunks.push(chunk);});response.on('error',reject);response.on('end',()=>{if(response.statusCode===202)return resolve(undefined);try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch{reject(new Error('MCP响应无效'));}});
 });request.setTimeout(25000,()=>request.destroy(new Error('MCP连接超时')));request.on('error',reject);request.end(data);});
}
export async function runBridge(file:string,input:AsyncIterable<Buffer>,output:(line:string)=>void,errors:(line:string)=>void){
 let pending=Buffer.alloc(0),version:string=protocolVersions[0];
 const send=async(line:Buffer)=>{if(!line.length)return;if(line.length>1_048_576)throw new Error('MCP请求超过1MiB');let message:Record<string,unknown>|undefined;try{message=JSON.parse(line.toString('utf8'));const result=await forwardLine(line,await loadBridgeConfig(file),version);if(result!==undefined){const negotiated=(result as {result?:{protocolVersion?:string}}).result?.protocolVersion;if(negotiated&&protocolVersions.includes(negotiated as typeof protocolVersions[number]))version=negotiated;output(JSON.stringify(result)+'\n');}}catch{const error='无法连接课屿 Desktop，请确认应用已打开、MCP已启用且配置正确';if(message&&Object.hasOwn(message,'id'))output(JSON.stringify({jsonrpc:'2.0',id:message.id,error:{code:-32000,message:error}})+'\n');else errors(error+'\n');}};
 for await(const chunk of input){pending=Buffer.concat([pending,chunk]);let newline:number;while((newline=pending.indexOf(10))!==-1){const line=pending.subarray(0,newline);pending=pending.subarray(newline+1);await send(line);}if(pending.length>1_048_576)throw new Error('MCP请求超过1MiB');}if(pending.length)await send(pending);
}
