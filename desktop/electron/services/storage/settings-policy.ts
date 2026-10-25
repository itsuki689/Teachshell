import {completionURL} from '../ai/stream.ts';

export interface EndpointSettings {baseURL:string;encryptedKey?:string;keyEndpoint?:string}
/** A credential belongs to one completion endpoint, including its path. */
export function applyAIEndpoint<T extends EndpointSettings>(current:T,apiKey:string,requested?:string):{value:T;apiKey:string}{
 const value={...current};
 if(requested!==undefined){
  const url=new URL(requested);
  if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname)))throw new Error('远程API必须使用HTTPS，本地模型允许HTTP');
  if(url.username||url.password||url.search||url.hash)throw new Error('API地址不能含账号、查询或片段');
  value.baseURL=url.href.replace(/\/$/,'');
 }
 const endpoint=completionURL(value.baseURL);
 if(endpoint!==completionURL(current.baseURL)||(current.keyEndpoint!==undefined&&current.keyEndpoint!==endpoint)){
  delete value.encryptedKey;delete value.keyEndpoint;apiKey='';
 }
 return{value,apiKey};
}
