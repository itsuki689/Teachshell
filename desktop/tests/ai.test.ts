import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {once} from 'node:events';
import {ChatService} from '../electron/services/ai/chat.ts';
import {completionURL,readCompletion} from '../electron/services/ai/stream.ts';
import {selectTools,decodeToolArguments} from '../electron/services/mcp/tools.ts';
import type {ChatEvent} from '../shared/api.ts';
const event=(delta:unknown,finish:string|null=null)=>`data: ${JSON.stringify({choices:[{index:0,delta,finish_reason:finish}]})}\r\n\r\n`;
const textStream=(text:string)=>event({role:'assistant',content:text})+event({},'stop')+'data: [DONE]\r\n\r\n';
function response(source:string,bytewise=false){const data=Buffer.from(source);return new Response(new ReadableStream({start(c){if(bytewise)for(const byte of data)c.enqueue(new Uint8Array([byte]));else c.enqueue(data);c.close();}}),{headers:{'Content-Type':'text/event-stream'}});}
async function temp(){return fs.mkdtemp(path.join(os.tmpdir(),'teachshelf-ai-'));}
const config=()=>({baseURL:'http://127.0.0.1:12345/v1',model:'test-model',apiKey:'secret-fixture-key'});
async function until(condition:()=>boolean){for(let i=0;i<200;i++){if(condition())return;await new Promise(r=>setTimeout(r,5));}throw new Error('condition timeout');}

test('completion endpoint rejects credentials and normalizes paths',()=>{
 assert.equal(completionURL(' https://model.example/v1/ '),'https://model.example/v1/chat/completions');
 assert.equal(completionURL('http://localhost:1234/v1/chat/completions'),'http://localhost:1234/v1/chat/completions');
 for(const url of ['file:///etc/passwd','https://key@host/v1','https://host/v1?k=secret','https://host/v1#secret','not-url'])assert.throws(()=>completionURL(url));
});
test('SSE decodes split UTF-8, CRLF, content and fragmented tools',async()=>{
 const source=': keepalive\r\n\r\n'+event({role:'assistant',content:'中文📚'})+event({tool_calls:[{index:0,id:'call-',type:'function',function:{name:'teachshelf_',arguments:'{"ok":'}}]})+event({tool_calls:[{index:0,id:'1',function:{name:'context',arguments:'true}'}}]})+event({},'tool_calls')+'data: [DONE]\r\n\r\n';
 let displayed='';const value=await readCompletion(response(source,true),text=>displayed+=text,new AbortController().signal);
 assert.equal(displayed,'中文📚');assert.deepEqual(value.tool_calls,[{id:'call-1',type:'function',function:{name:'teachshelf_context',arguments:'{"ok":true}'}}]);
});
test('SSE refuses truncated, oversized, partial and duplicate tool responses',async()=>{
 await assert.rejects(readCompletion(response(event({content:'partial'})),()=>{},new AbortController().signal),/中断/);
 await assert.rejects(readCompletion(response(event({content:'partial'},'length')),()=>{},new AbortController().signal),/未完成/);
 const calls=[0,1].map(index=>({index,id:'duplicate',type:'function',function:{name:'t',arguments:'{}'}}));
 await assert.rejects(readCompletion(response(event({tool_calls:calls},'tool_calls')),()=>{},new AbortController().signal),/重复/);
 await assert.rejects(readCompletion(response('x'.repeat(2_000_001)),()=>{},new AbortController().signal),/2 MB/);
});
test('non-streaming compatible response preserves reasoning field',async()=>{
 const value=await readCompletion(new Response(JSON.stringify({choices:[{message:{role:'assistant',content:'答案',reasoning_content:'provider-state'},finish_reason:'stop'}]})),()=>{},new AbortController().signal);
 assert.equal(value.content,'答案');assert.equal(value.reasoning_content,'provider-state');
});
test('schema guided tool argument compatibility rejects unknown properties',()=>{
 const definition=selectTools(['teachshelf_update_course'])[0];
 const json=JSON.stringify({library_id:'library',expected_library_revision:'rev',id:'id',patch:{archived:'true'}});
 assert.equal((decodeToolArguments(json,definition.inputSchema).patch as {archived:boolean}).archived,true);
 assert.throws(()=>decodeToolArguments('{"shell":"rm"}',definition.inputSchema));
});
test('real HTTP streaming chat confirms a write, persists receipts and reloads without credentials',async()=>{
 const root=await temp();let count=0,executed=0;const requestBodies:Record<string,unknown>[]=[];const events:ChatEvent[]=[];
 const args={library_id:'library',expected_library_revision:'revision',request_id:'11111111-1111-4111-8111-111111111111',fields:{name:'微积分'}};
 const server=http.createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;requestBodies.push(JSON.parse(body));assert.equal(req.headers.authorization,'Bearer secret-fixture-key');
  res.writeHead(200,{'Content-Type':'text/event-stream'});if(count++===0){res.write(event({role:'assistant',tool_calls:[{index:0,id:'write1',type:'function',function:{name:'teachshelf_create_course',arguments:JSON.stringify(args)}}]}));res.end(event({},'tool_calls')+'data: [DONE]\n\n');}else res.end(textStream('课程已保存。'));
 });server.listen(0,'127.0.0.1');await once(server,'listening');const port=(server.address()as{port:number}).port;
 const tools={definitions:selectTools(['teachshelf_create_course']),execute:async(name:string,input:Record<string,unknown>)=>{assert.equal(name,'teachshelf_create_course');assert.deepEqual(input,args);executed++;return{changed:true,course:{name:'微积分'}};}};
 const service=new ChatService({root,tools,config:()=>({...config(),baseURL:`http://127.0.0.1:${port}/v1`}),onEvent:e=>{events.push(e);if(e.type==='confirmation'){assert.equal(executed,0);service.confirm(e.requestID!,true);}}});
 try{
  await service.send('建立微积分课程');assert.equal(executed,1);assert.equal(requestBodies.length,2);assert.equal(requestBodies[0].stream,true);
  const history=await service.history();assert.deepEqual(history.map(m=>m.role),['user','tool','assistant']);assert.equal(history.at(-1)?.content,'课程已保存。');
  const persisted=await fs.readFile(path.join(root,'.desktop-chat.json'),'utf8');assert.ok(!persisted.includes('secret-fixture-key'));
  assert.deepEqual(await new ChatService({root,tools,config,onEvent:()=>{}}).history(),history);
  assert.ok(events.some(e=>e.type==='delta'&&e.text==='课程已保存。'));assert.equal(events.at(-1)?.type,'done');
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));await fs.rm(root,{recursive:true,force:true});}
});
test('denial and cancellation at confirmation never execute the tool',async()=>{
 for(const action of ['deny','cancel']){
  const root=await temp();let called=0,requests=0;const events:ChatEvent[]=[];
  const args={library_id:'library',request_id:'11111111-1111-4111-8111-111111111111',fields:{title:'计划'}};
  const service=new ChatService({root,config,tools:{definitions:selectTools(['teachshelf_create_plan']),execute:()=>{called++;return{};}},onEvent:e=>{events.push(e);if(e.type==='confirmation'){if(action==='deny')service.confirm(e.requestID!,false);else service.cancel();}},fetch:async()=>requests++===0?response(event({tool_calls:[{index:0,id:'a',type:'function',function:{name:'teachshelf_create_plan',arguments:JSON.stringify(args)}}]},'tool_calls')):response(textStream('已取消'))});
  try{await service.send('创建计划');assert.equal(called,0);if(action==='deny')assert.match((await service.history()).find(m=>m.role==='tool')!.content,/用户拒绝/);else assert.ok(events.some(e=>e.type==='error'&&e.text?.includes('已停止')));assert.throws(()=>service.confirm('stale',true),/失效/);}finally{await fs.rm(root,{recursive:true,force:true});}
 }
});
test('cancellation aborts an active response and clears incomplete wire history',async()=>{
 const root=await temp();let read=false,cancelled=false;const events:ChatEvent[]=[];
 const service=new ChatService({root,config,tools:{definitions:[],execute:()=>({})},onEvent:e=>events.push(e),fetch:async()=>new Response(new ReadableStream({start(c){c.enqueue(Buffer.from(event({content:'开始'})));read=true;},cancel(){cancelled=true;}}),{headers:{'content-type':'text/event-stream'}})});
 try{const task=service.send('请回答');await until(()=>read);service.cancel();await task;assert.equal(cancelled,true);assert.deepEqual(JSON.parse(await fs.readFile(path.join(root,'.desktop-chat.json'),'utf8')).wire,[]);assert.ok(events.some(e=>e.type==='error'));}finally{await fs.rm(root,{recursive:true,force:true});}
});
test('read-only tools require no confirmation and unsupported tools are never executed',async()=>{
 const root=await temp();let executed=0,requests=0,confirmed=0;
 const service=new ChatService({root,config,tools:{definitions:selectTools(['teachshelf_context']),execute:()=>{executed++;return{library_id:'test'};}},onEvent:e=>{if(e.type==='confirmation')confirmed++;},fetch:async()=>requests++===0?response(event({tool_calls:[{index:0,id:'read',type:'function',function:{name:'teachshelf_context',arguments:'{}'}},{index:1,id:'unknown',type:'function',function:{name:'execute_shell',arguments:'{}'}}]},'tool_calls')):response(textStream('完成'))});
 try{await service.send('查看资料库');assert.equal(executed,1);assert.equal(confirmed,0);assert.match((await service.history()).filter(m=>m.role==='tool')[1].content,/未支持/);}finally{await fs.rm(root,{recursive:true,force:true});}
});
test('corrupt history and symlink history cannot be overwritten; clear resets valid history',async()=>{
 const root=await temp(),file=path.join(root,'.desktop-chat.json');await fs.writeFile(file,'broken');const options={root,config,tools:{definitions:[],execute:()=>({})},onEvent:()=>{},fetch:async()=>response(textStream('回答'))};
 try{await assert.rejects(new ChatService(options).history(),/损坏/);assert.equal(await fs.readFile(file,'utf8'),'broken');await fs.unlink(file);const outside=path.join(root,'outside');await fs.writeFile(outside,'preserve');await fs.symlink(outside,file);await assert.rejects(new ChatService(options).history(),/符号链接/);assert.equal(await fs.readFile(outside,'utf8'),'preserve');await fs.unlink(file);const service=new ChatService(options);await service.send('你好');assert.equal((await service.history()).length,2);await service.clear();assert.deepEqual(await service.history(),[]);}finally{await fs.rm(root,{recursive:true,force:true});}
});
test('redirects are rejected without following and server body is not disclosed',async()=>{
 const root=await temp(),events:ChatEvent[]=[];let redirects:unknown;
 const service=new ChatService({root,config,tools:{definitions:[],execute:()=>({})},onEvent:e=>events.push(e),fetch:async(_url,init)=>{redirects=init?.redirect;return new Response('SECRET response body',{status:302,headers:{Location:'https://attacker.invalid'}});}});
 try{await service.send('你好');assert.equal(redirects,'manual');assert.ok(events.some(e=>e.type==='error'&&e.text?.includes('302')));assert.ok(!JSON.stringify(events).includes('SECRET'));}finally{await fs.rm(root,{recursive:true,force:true});}
});
test('concurrent initial history loads and send do not overwrite the new message',async()=>{
 const root=await temp(),options={root,config,tools:{definitions:[],execute:()=>({})},onEvent:()=>{},fetch:async()=>response(textStream('回答'))};
 try{const service=new ChatService(options);await Promise.all([service.history(),service.send('初次消息'),service.history()]);assert.deepEqual((await service.history()).map(m=>m.content),['初次消息','回答']);const clearing=service.clear();await assert.rejects(service.send('清除竞争'),/停止/);await clearing;assert.deepEqual(await service.history(),[]);}finally{await fs.rm(root,{recursive:true,force:true});}
});
