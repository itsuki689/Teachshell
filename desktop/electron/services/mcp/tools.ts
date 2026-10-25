import catalog from './catalog.json' with {type:'json'};

export interface JSONSchema {type?:string;properties?:Record<string,JSONSchema>;required?:string[];additionalProperties?:boolean;anyOf?:JSONSchema[];items?:JSONSchema;enum?:unknown[];minLength?:number;maxLength?:number;minimum?:number;maximum?:number;maxItems?:number;[key:string]:unknown}
export interface ToolDefinition {name:string;description:string;inputSchema:JSONSchema;annotations?:{readOnlyHint?:boolean;destructiveHint?:boolean;openWorldHint?:boolean}}
export interface ToolProvider {definitions:ToolDefinition[];execute(name:string,args:Record<string,unknown>):Promise<unknown>|unknown}
/** Source catalog is exported from the unchanged Swift implementation. Publish only implemented tools. */
export const swiftToolCatalog = catalog as unknown as ToolDefinition[];
export function selectTools(names:string[]):ToolDefinition[]{
 const requested=new Set(names);if(requested.size!==names.length)throw new Error('重复工具名称');
 const selected=swiftToolCatalog.filter(tool=>requested.has(tool.name));
 if(selected.length!==names.length)throw new Error('未知工具名称');return structuredClone(selected);
}
export function validateArguments(value:unknown,schema:JSONSchema,path='arguments',depth=0):void {
 if(depth>30)throw new Error('工具参数嵌套过深');
 const fail=():never=>{throw new Error(`${path} 不符合参数要求`);};
 if(schema.anyOf){for(const variant of schema.anyOf){try{validateArguments(value,variant,path,depth+1);return;}catch{}}return fail();}
 switch(schema.type){
  case 'object':{
   if(!value||typeof value!=='object'||Array.isArray(value))return fail();
   const object=value as Record<string,unknown>,properties=schema.properties??{};
   if((schema.required??[]).some(key=>!Object.hasOwn(object,key)))return fail();
   for(const [key,item]of Object.entries(object)){if(!Object.hasOwn(properties,key))return fail();validateArguments(item,properties[key],`${path}.${key}`,depth+1);}return;
  }
  case 'string':if(typeof value!=='string'||Array.from(value).length<(schema.minLength??0)||Array.from(value).length>(schema.maxLength??200000)||(schema.enum&&!schema.enum.includes(value)))return fail();return;
  case 'boolean':if(typeof value!=='boolean')return fail();return;
  case 'integer':if(typeof value!=='number'||!Number.isSafeInteger(value)||value<(schema.minimum??0)||value>(schema.maximum??1000000))return fail();return;
  case 'number':if(typeof value!=='number'||!Number.isFinite(value)||value<(schema.minimum??-Infinity)||value>(schema.maximum??Infinity))return fail();return;
  case 'array':if(!Array.isArray(value)||value.length>(schema.maxItems??500)||!schema.items)return fail();value.forEach((item,i)=>validateArguments(item,schema.items!,`${path}[${i}]`,depth+1));return;
  case 'null':if(value!==null)return fail();return;
  default:return fail();
 }
}
/** Compatibility coercion is restricted to declared schema fields, then strictly validated. */
export function decodeToolArguments(json:string,schema:JSONSchema):Record<string,unknown>{
 if(Buffer.byteLength(json)>200000)throw new Error('工具参数过大');
 function convert(value:unknown,s:JSONSchema,depth=0):unknown{
  if(depth>30)throw new Error('工具参数嵌套过深');
  if(s.anyOf){for(const variant of s.anyOf){try{const v=convert(value,variant,depth+1);validateArguments(v,variant);return v;}catch{}}return value;}
  if(s.type==='boolean'&&typeof value==='string'){if(value.trim().toLowerCase()==='true')return true;if(value.trim().toLowerCase()==='false')return false;}
  if((s.type==='integer'||s.type==='number')&&typeof value==='string'&&value.trim()!==''&&Number.isFinite(Number(value)))return Number(value);
  if((s.type==='array'||s.type==='object')&&typeof value==='string'){try{value=JSON.parse(value);}catch{}}
  if(s.type==='array'&&Array.isArray(value)&&s.items)return value.map(item=>convert(item,s.items!,depth+1));
  if(s.type==='object'&&value&&typeof value==='object'&&!Array.isArray(value))return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,s.properties&&Object.hasOwn(s.properties,key)?convert(item,s.properties[key],depth+1):item]));
  return value;
 }
 const value=convert(JSON.parse(json),schema);validateArguments(value,schema);
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('工具参数必须是对象');return value as Record<string,unknown>;
}
export async function executeTool(tools:ToolProvider,name:string,args:unknown):Promise<unknown>{
 const definition=tools.definitions.find(tool=>tool.name===name);if(!definition)throw new Error('工具未支持');
 validateArguments(args,definition.inputSchema);return tools.execute(name,args as Record<string,unknown>);
}
