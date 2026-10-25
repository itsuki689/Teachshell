import {dateMs,SWIFT_EPOCH_MS} from './model.ts';
import type {StudyTask,SwiftDate} from './model.ts';
import {shanghaiDay,shanghaiDayKey} from './timetable.ts';

export type PlanEditScope='thisOccurrence'|'thisAndFuture'|'all';
export type PlanOrigin='activity'|'fixed';
export type PlanStatus='complete'|'reopen'|'cancel'|'restore'|'archive'|'unarchive'|'resetOccurrence';
export interface PlanRepeatRule {frequency:'daily'|'weekly'|'monthly';interval:number;until?:SwiftDate;[key:string]:unknown}
export const planDetailFields=['title','content','kind','courseID','materialIDs','hasExecutionTime','startsAt','endsAt','deadline','location','isAllDay','deadlineIsAllDay','showInMonth','completionRequired','colorHex'] as const;
export type PlanDetailField=typeof planDetailFields[number];
export interface PlanDetails {
 title:string;content:string;kind:string;courseID?:string;courseNameSnapshot?:string;materialIDs:string[];
 hasExecutionTime:boolean;startsAt:SwiftDate;endsAt?:SwiftDate;deadline?:SwiftDate;location:string;
 isAllDay:boolean;deadlineIsAllDay:boolean;showInMonth:boolean;completionRequired:boolean;colorHex?:string;
 overriddenFields?:PlanDetailField[];[key:string]:unknown;
}
export interface PlanException {
 originalDate:SwiftDate;details?:PlanDetails;startsAt?:SwiftDate;endsAt?:SwiftDate;deadline?:SwiftDate;
 completedAt?:SwiftDate;completedOverride?:boolean;cancelledAt?:SwiftDate;location?:string;[key:string]:unknown;
}
export interface Plan extends StudyTask {
 origin:PlanOrigin;hasExecutionTime:boolean;location:string;showInMonth:boolean;completionRequired:boolean;
 deadlineIsAllDay:boolean;exceptions:PlanException[];repeatRule?:PlanRepeatRule;colorHex?:string;courseNameSnapshot?:string;
}
export interface PlanOccurrence {
 id:string;task:Plan;originalDate:number;date:number;endDate?:number;isDeadline:boolean;isAllDay:boolean;isFixed:boolean;origin:PlanOrigin;
}
const DAY=86_400_000;
const civilFormatter=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
export const swiftSeconds=(value:SwiftDate):number=>(dateMs(value)-SWIFT_EPOCH_MS)/1000;
export function readPlan(value:StudyTask):Plan {
 const plan=structuredClone(value) as Plan;
 if(plan.origin===undefined)plan.origin='activity';if(plan.hasExecutionTime===undefined)plan.hasExecutionTime=plan.deadline==null;
 if(plan.location===undefined)plan.location='';if(plan.showInMonth===undefined)plan.showInMonth=false;
 if(plan.completionRequired===undefined)plan.completionRequired=true;if(plan.deadlineIsAllDay===undefined)plan.deadlineIsAllDay=plan.isAllDay;
 if(plan.exceptions===undefined)plan.exceptions=[];return plan;
}
function civil(value:SwiftDate):Record<string,number> {
 const ms=dateMs(value);if(!Number.isFinite(new Date(ms).getTime()))throw new Error('计划日期超出支持范围');
 const p=Object.fromEntries(civilFormatter.formatToParts(new Date(ms)).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]));p.fraction=ms-Math.floor(ms/1000)*1000;return p;
}
function fromCivil(year:number,month:number,day:number,p:Record<string,number>):number {
 const desired=Date.UTC(year,month-1,day,p.hour??0,p.minute??0,p.second??0)+(p.fraction??0);let instant=desired;
 for(let i=0;i<4;i++){
  const v=civil((instant-SWIFT_EPOCH_MS)/1000);
  const offset=Date.UTC(v.year,v.month-1,v.day,v.hour,v.minute,v.second)-Math.floor(instant/1000)*1000;
  const next=desired-offset;if(instant===next)break;instant=next;
 }
 if(!Number.isFinite(new Date(instant).getTime()))throw new Error('计划日期超出支持范围');return (instant-SWIFT_EPOCH_MS)/1000;
}
export function planCivilDays(from:SwiftDate,to:SwiftDate):number {return Math.round((Date.parse(shanghaiDayKey(to))-Date.parse(shanghaiDayKey(from)))/DAY);}
export function addPlanDays(value:SwiftDate,days:number):number {
 if(!Number.isInteger(days))throw new Error('自然日偏移必须是整数');const p=civil(value),target=new Date(Date.UTC(p.year,p.month-1,p.day+days));
 return fromCivil(target.getUTCFullYear(),target.getUTCMonth()+1,target.getUTCDate(),p);
}
export function planAnchor(value:StudyTask):number {const plan=readPlan(value);return swiftSeconds(plan.hasExecutionTime?plan.startsAt:(plan.deadline??plan.startsAt));}
export function planIndexNear(value:SwiftDate,base:SwiftDate,rule:PlanRepeatRule):number {
 if(rule.frequency==='monthly'){const a=civil(base),b=civil(value);return Math.trunc(((b.year-a.year)*12+b.month-a.month)/rule.interval);}
 return Math.trunc(planCivilDays(base,value)/(rule.interval*(rule.frequency==='weekly'?7:1)));
}
export function planOccurrenceDate(index:number,base:SwiftDate,rule:PlanRepeatRule):number|undefined {
 if(!Number.isInteger(index)||index<0||index>1_000_000||!Number.isInteger(rule.interval)||rule.interval<1||rule.interval>366)return undefined;
 try{
  if(index===0)return swiftSeconds(base);
  if(rule.frequency==='daily'||rule.frequency==='weekly')return addPlanDays(base,index*rule.interval*(rule.frequency==='weekly'?7:1));
  if(rule.frequency!=='monthly')return undefined;
  const p=civil(base),month=new Date(Date.UTC(p.year,p.month-1+index*rule.interval,1));
  const year=month.getUTCFullYear(),number=month.getUTCMonth()+1,last=new Date(Date.UTC(year,number,0)).getUTCDate();
  return fromCivil(year,number,Math.min(p.day,last),p);
 }catch{return undefined;}
}
export function isPlanOccurrenceAnchor(value:SwiftDate,input:StudyTask):boolean {
 try{
  const plan=readPlan(input),base=planAnchor(plan),date=swiftSeconds(value),rule=plan.repeatRule;
  if(!rule)return date===base;
  if(!Number.isInteger(rule.interval)||rule.interval<1||rule.interval>366||date<base)return false;
  const index=planIndexNear(date,base,rule);if(index<0||planOccurrenceDate(index,base,rule)!==date)return false;
  return rule.until==null||shanghaiDay(date)<=shanghaiDay(rule.until);
 }catch{return false;}
}
function put(target:Record<string,unknown>,key:string,value:unknown){if(value==null)delete target[key];else target[key]=structuredClone(value);}
export function applyPlanDetails(plan:Plan,details:PlanDetails):void {
 const includes=(field:PlanDetailField)=>details.overriddenFields==null||details.overriddenFields.includes(field);
 for(const field of planDetailFields)if(field!=='colorHex'&&includes(field))put(plan,field,details[field]);
 if(includes('courseID'))put(plan,'courseNameSnapshot',details.courseNameSnapshot);
 if(details.overriddenFields?.includes('colorHex')||(details.overriddenFields==null&&details.colorHex!=null))put(plan,'colorHex',details.colorHex);
}
/** The returned task is a value copy. Its exceptions retain original anchors. */
export function planSnapshot(input:StudyTask,originalDate:SwiftDate):Plan {
 const plan=readPlan(input),result=structuredClone(plan),days=planCivilDays(planAnchor(plan),originalDate);
 result.startsAt=addPlanDays(plan.startsAt,days);if(plan.endsAt!=null)result.endsAt=addPlanDays(plan.endsAt,days);if(plan.deadline!=null)result.deadline=addPlanDays(plan.deadline,days);
 const change=plan.exceptions.find(e=>swiftSeconds(e.originalDate)===swiftSeconds(originalDate));
 if(change){
  if(change.details)applyPlanDetails(result,change.details);
  for(const key of ['startsAt','endsAt','deadline','cancelledAt','location'] as const)if(change[key]!=null)(result as Record<string,unknown>)[key]=change[key];
  if(change.completedOverride===false)delete result.completedAt;else if(change.completedAt!=null)result.completedAt=change.completedAt;
 }
 return result;
}
function anchors(plan:Plan,from:number,through:number):number[] {
 const rule=plan.repeatRule;if(!rule||!Number.isInteger(rule.interval)||rule.interval<1||rule.interval>366)return [];
 const base=planAnchor(plan),first=Math.max(0,planIndexNear(from,base,rule)-1),last=Math.max(first,planIndexNear(through,base,rule)+1);
 if(!Number.isFinite(last)||last-first>10_000)return [];
 const values:number[]=[];for(let i=first;i<=last;i++){const value=planOccurrenceDate(i,base,rule);if(value!==undefined&&value>=from&&value<=through&&(rule.until==null||shanghaiDay(value)<=shanghaiDay(rule.until)))values.push(value);}return values;
}
function referenceLabel(value:number){return Number.isInteger(value)?value.toFixed(1):String(value);}
function event(task:Plan,originalDate:number,date:number,isDeadline:boolean,isAllDay:boolean,endDate?:number):PlanOccurrence {
 const isFixed=isDeadline||task.origin==='fixed';return {id:`${task.id}-${task.repeatRule?referenceLabel(originalDate):'once'}-${isDeadline?'ddl':'execution'}`,task,originalDate,date,...(endDate===undefined?{}:{endDate}),isDeadline,isAllDay,isFixed,origin:isFixed?'fixed':'activity'};
}
/** Pure Shanghai calendar projection, matching PlanCalendar.events(on:plans:). */
export function planEvents(day:SwiftDate,plans:StudyTask[]):PlanOccurrence[] {
 let start:number,next:number;try{start=shanghaiDay(day);next=addPlanDays(start,1);}catch{return [];}
 const result:PlanOccurrence[]=[];
 for(const input of plans){
  const plan=readPlan(input);if(!plan.showOnCalendar||plan.archivedAt!=null||plan.cancelledAt!=null)continue;
  const base=planAnchor(plan),candidates=new Set<number>();
  if(!plan.repeatRule)candidates.add(base);
  else{
   if(plan.hasExecutionTime){const length=Math.max(0,swiftSeconds(plan.endsAt??plan.startsAt)-swiftSeconds(plan.startsAt));for(const date of anchors(plan,start-length,next))candidates.add(date);}
   if(plan.deadline!=null){const days=planCivilDays(base,plan.deadline),shifted=addPlanDays(start,-days);for(const date of anchors(plan,shifted,addPlanDays(shifted,1)))candidates.add(date);}
  }
  for(const exception of plan.exceptions)candidates.add(swiftSeconds(exception.originalDate));
  for(const originalDate of [...candidates].sort((a,b)=>a-b)){
   if(!isPlanOccurrenceAnchor(originalDate,plan))continue;const effective=planSnapshot(plan,originalDate);if(effective.cancelledAt!=null)continue;
   if(effective.hasExecutionTime){const begin=swiftSeconds(effective.startsAt),end=effective.endsAt==null?undefined:swiftSeconds(effective.endsAt);const intersects=end!==undefined&&end>begin?begin<next&&end>start:begin>=start&&begin<next;if(intersects)result.push(event(effective,originalDate,Math.max(start,begin),false,effective.isAllDay,end===undefined?undefined:Math.min(end,next)));}
   if(effective.deadline!=null){const due=swiftSeconds(effective.deadline);if(due>=start&&due<next)result.push(event(effective,originalDate,due,true,effective.deadlineIsAllDay));}
  }
 }
 return result.sort((a,b)=>a.date-b.date||(a.isDeadline===b.isDeadline?0:a.isDeadline?-1:1)||a.task.title.localeCompare(b.task.title,'zh',{numeric:true})||a.id.localeCompare(b.id));
}
