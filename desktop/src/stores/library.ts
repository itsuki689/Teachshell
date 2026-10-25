import {defineStore} from 'pinia';
import {computed,ref} from 'vue';
import {emptyLibrary} from '../../shared/model';
import type {Snapshot,Settings} from '../../shared/api';
export const useLibrary=defineStore('library',()=>{
 const snapshot=ref<Snapshot|null>(null),settings=ref<Settings|null>(null),error=ref(''),status=ref('正在打开资料库…'),busy=ref(0),route=ref('all'),folderID=ref<string|undefined>(),selected=ref<string[]>([]);
 const confirmRequest=ref<{title:string;detail:string;action:string}|null>(null); let confirmResolve:((v:boolean)=>void)|undefined;
 const state=computed(()=>snapshot.value?.state??emptyLibrary());
 const courseID=computed(()=>route.value.startsWith('course:')?route.value.slice(7):undefined);
 const course=computed(()=>state.value.courses.find(c=>c.id===courseID.value));
 const title=computed(()=>course.value?.name??({all:'全部资料',favorites:'我的收藏',recent:'最近打开',unassigned:'未分类',plans:'计划',timetable:'课表',pending:'待完成计划',assistant:'AI 助手',settings:'设置'}[route.value]??'资料库'));
 function navigate(to:string){route.value=to;folderID.value=undefined;selected.value=[];}
 function accept(value:Snapshot){snapshot.value=value; if(courseID.value&&!value.state.courses.some(c=>c.id===courseID.value))navigate('all');selected.value=selected.value.filter(id=>value.state.materials.some(m=>m.id===id));}
 async function run<T>(fn:()=>Promise<T>,label='已保存'):Promise<T|undefined>{busy.value++;try{const value=await fn();status.value=label;return value;}catch(e){error.value=e instanceof Error?e.message:String(e);status.value='操作未完成';return undefined;}finally{busy.value--;}}
 async function change(fn:()=>Promise<Snapshot>,label='已保存'){return run(async()=>{const result=await fn();accept(result);return result;},label);}
 async function refresh(){return change(()=>window.teachshelf.snapshot(),'资料库已加载');}
 async function chooseLibrary(copy:boolean){await run(async()=>{const result=await(copy?window.teachshelf.importLibrary():window.teachshelf.openLibrary());if(result){accept(result);navigate('all');}},copy?'资料库复制导入完成':'资料库已打开');}
 function confirm(title:string,detail:string,action='确认'):Promise<boolean>{if(confirmResolve)confirmResolve(false);confirmRequest.value={title,detail,action};return new Promise(resolve=>{confirmResolve=resolve;});}
 function decide(approved:boolean){confirmRequest.value=null;confirmResolve?.(approved);confirmResolve=undefined;}
 return {snapshot,settings,error,status,busy,route,folderID,selected,state,courseID,course,title,confirmRequest,navigate,accept,run,change,refresh,chooseLibrary,confirm,decide};
});
