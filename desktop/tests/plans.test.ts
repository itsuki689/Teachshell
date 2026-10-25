import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {Repository} from '../electron/services/storage/repository.ts';
import {emptyLibrary,decodeLibrary} from '../shared/model.ts';
import type {LibraryState,StudyTask} from '../shared/model.ts';
import {planEvents,planSnapshot,planAnchor,isPlanOccurrenceAnchor,planOccurrenceDate,readPlan,swiftSeconds} from '../shared/plans.ts';
import type {Plan,PlanEditScope,PlanStatus} from '../shared/plans.ts';
import {saveAdvancedPlan,changePlanStatus,removeAdvancedPlan,validatePlans} from '../electron/services/course/plans.ts';
import {shanghaiDay} from '../shared/timetable.ts';

const id='11111111-2222-4333-8444-000000000001';
const second=swiftSeconds('2026-10-19T19:00:00+08:00');
const now=swiftSeconds('2026-10-25T12:00:00+08:00');
function weekly():Plan{return {id,title:'实验报告',content:'',kind:'任务',materialIDs:[],startsAt:swiftSeconds('2026-10-12T19:00:00+08:00'),endsAt:swiftSeconds('2026-10-12T20:00:00+08:00'),deadline:swiftSeconds('2026-10-16T23:59:00+08:00'),isAllDay:false,showOnCalendar:true,origin:'activity',hasExecutionTime:true,location:'',showInMonth:false,completionRequired:true,deadlineIsAllDay:false,exceptions:[],repeatRule:{frequency:'weekly',interval:1,until:shanghaiDay('2026-11-30')}};}
function stateWith(plan:Plan=weekly()){const state=emptyLibrary();saveAdvancedPlan(state,plan,'all',undefined,now);return state;}
function events(state:LibraryState,date:string|number){return planEvents(date,state.tasks);}
async function fixture(t:{after:(fn:()=>Promise<void>)=>void}){const dir=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'teachshelf-plans-')));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const repo=await Repository.open(path.join(dir,'Library'),{create:true});t.after(()=>repo.close());return repo;}

test('execution and deadline are separate events with shared parent and fixed deadline semantics',()=>{
 const plan=weekly(),state=stateWith(plan);const execution=events(state,plan.startsAt)[0],deadline=events(state,plan.deadline!)[0];assert.equal(execution.isDeadline,false);assert.equal(execution.isFixed,false);assert.equal(deadline.isDeadline,true);assert.equal(deadline.isFixed,true);assert.equal(deadline.task.id,execution.task.id);assert.notEqual(execution.id,deadline.id);
});
test('monthly recurrence clamps to February without drifting the March anchor; until includes the entire Shanghai day',()=>{
 const plan={...weekly(),startsAt:swiftSeconds('2026-01-31T23:30:00+08:00'),endsAt:undefined,deadline:undefined,repeatRule:{frequency:'monthly' as const,interval:1,until:shanghaiDay('2026-03-31')}};
 assert.equal(planEvents('2026-02-28T12:00:00+08:00',[plan])[0].date,swiftSeconds('2026-02-28T23:30:00+08:00'));assert.equal(planEvents('2026-02-28T16:00:00Z',[plan]).length,0);assert.equal(planEvents('2026-03-31',[plan]).length,1);assert.equal(planEvents('2026-03-28',[plan]).length,0);assert.equal(planEvents('2026-04-30',[plan]).length,0);
});
test('monthly leap-year clamping, long intervals and subsecond values preserve the original anchor',()=>{
 const base=swiftSeconds('2024-01-31T12:34:56.125+08:00'),rule={frequency:'monthly' as const,interval:1};assert.equal(planOccurrenceDate(1,base,rule),swiftSeconds('2024-02-29T12:34:56.125+08:00'));assert.equal(planOccurrenceDate(2,base,rule),swiftSeconds('2024-03-31T12:34:56.125+08:00'));assert.equal(planOccurrenceDate(1,base,{frequency:'monthly',interval:12}),swiftSeconds('2025-01-31T12:34:56.125+08:00'));
});
test('deadline-only repeats use civil days and do not create duplicate execution events',()=>{
 const plan={...weekly(),startsAt:shanghaiDay('2026-10-01'),deadline:swiftSeconds('2026-10-13T00:15:00+08:00'),hasExecutionTime:false,repeatRule:{frequency:'daily' as const,interval:2,until:shanghaiDay('2026-10-17')}};
 assert.equal(planEvents('2026-10-12T16:20:00Z',[plan]).length,1);assert.equal(planEvents('2026-10-14',[plan]).length,0);assert.equal(planEvents('2026-10-17',[plan])[0].isDeadline,true);assert.equal(planAnchor(plan),plan.deadline);
});
test('multiday execution clips at midnight and does not create an extra final day',()=>{
 const plan={...weekly(),repeatRule:undefined,startsAt:swiftSeconds('2026-10-12T20:00:00+08:00'),endsAt:shanghaiDay('2026-10-14'),deadline:undefined};const first=planEvents('2026-10-12',[plan])[0],next=planEvents('2026-10-13',[plan])[0];assert.equal(first.id,next.id);assert.equal(next.date,shanghaiDay('2026-10-13'));assert.equal(next.endDate,plan.endsAt);assert.equal(planEvents('2026-10-14',[plan]).length,0);
});
test('independently moved execution and deadline retain the original occurrence identity',()=>{
 const plan=weekly();plan.exceptions=[{originalDate:plan.startsAt,startsAt:second,endsAt:second+3600,deadline:swiftSeconds('2026-12-20T23:59:00+08:00')}];const state=stateWith(plan);assert.equal(events(state,plan.startsAt).length,0);const overlap=events(state,second).filter(e=>!e.isDeadline);assert.equal(overlap.length,2);assert.equal(new Set(overlap.map(e=>e.id)).size,2);assert.equal(events(state,'2026-12-20')[0].originalDate,plan.startsAt);
});
test('single completion/cancellation/restoration affect execution and deadline together but not other weeks',()=>{
 const state=stateWith(),plan=weekly();changePlanStatus(state,id,'complete','thisOccurrence',plan.startsAt,now);assert.ok(events(state,plan.startsAt)[0].task.completedAt);assert.ok(events(state,plan.deadline!)[0].task.completedAt);assert.equal(events(state,second)[0].task.completedAt,undefined);
 changePlanStatus(state,id,'cancel','thisOccurrence',plan.startsAt,now);assert.equal(events(state,plan.startsAt).length,0);assert.equal(events(state,plan.deadline!).length,0);
 changePlanStatus(state,id,'restore','thisOccurrence',plan.startsAt,now);assert.ok(events(state,plan.deadline!)[0].task.completedAt);changePlanStatus(state,id,'resetOccurrence','thisOccurrence',plan.startsAt,now);assert.deepEqual(state.tasks[0].exceptions,[]);
});
test('one occurrence can reopen a completed series without losing the inherited completion elsewhere',()=>{
 const plan=weekly();plan.completedAt=now;const state=stateWith(plan);changePlanStatus(state,id,'reopen','thisOccurrence',second,now);assert.equal(events(state,second)[0].task.completedAt,undefined);assert.equal(events(state,'2026-10-23')[0].task.completedAt,undefined);assert.equal(events(state,plan.startsAt)[0].task.completedAt,now);assert.equal((state.tasks[0].exceptions![0] as any).completedOverride,false);
});
test('single edits record only changed fields so later group edits propagate unrelated fields',()=>{
 const state=stateWith(),plan=weekly();const single=planSnapshot(plan,second);single.title='仅这次';single.location='临时地点';single.deadline=undefined;saveAdvancedPlan(state,single,'thisOccurrence',second,now);
 assert.equal(state.tasks[0].title,plan.title);assert.equal(events(state,second)[0].task.title,'仅这次');assert.equal(events(state,'2026-10-23').length,0);
 saveAdvancedPlan(state,{id,title:plan.title,content:'整组更新',colorHex:'#39786B'},'all',undefined,now);const after=events(state,second)[0].task;assert.equal(after.title,'仅这次');assert.equal(after.content,'整组更新');assert.equal(after.colorHex,'#39786B');
});
test('single color override survives group change and explicit reset clears inherited color',()=>{
 const plan=weekly();plan.colorHex='#3B72B8';const state=stateWith(plan);saveAdvancedPlan(state,{id,colorHex:'#AE567C'},'thisOccurrence',second,now);saveAdvancedPlan(state,{id,colorHex:'#39786B'},'all',undefined,now);assert.equal(events(state,second)[0].task.colorHex,'#AE567C');assert.equal(events(state,'2026-10-26')[0].task.colorHex,'#39786B');
 saveAdvancedPlan(state,{id,colorHex:undefined},'thisOccurrence',second,now);assert.equal(events(state,second)[0].task.colorHex,undefined);assert.ok((state.tasks[0].exceptions![0].details as any).overriddenFields.includes('colorHex'));
});
test('legacy complete detail snapshots without a color do not erase the parent color',()=>{
 const plan=weekly();plan.colorHex='#39786B';const state=stateWith(plan);saveAdvancedPlan(state,{id,title:'例外'},'thisOccurrence',second,now);const p=readPlan(state.tasks[0]);delete p.exceptions[0].details!.overriddenFields;delete p.exceptions[0].details!.colorHex;assert.equal(planSnapshot(p,second).colorHex,'#39786B');
});
test('undefined optional IPC properties preserve required defaults and existing occurrence exceptions',()=>{
 const state=stateWith();saveAdvancedPlan(state,{id,title:'例外'},'thisOccurrence',second,now);
 saveAdvancedPlan(state,{id,title:'整组新标题',exceptions:undefined,materialIDs:undefined,hasExecutionTime:undefined,location:undefined},'all',undefined,now);
 assert.equal(events(state,second)[0].task.title,'例外');assert.equal(readPlan(state.tasks[0]).exceptions.length,1);assert.equal(state.tasks[0].hasExecutionTime,true);
});
test('this-and-future editing splits the series, keeps prior history and rebases later exceptions',()=>{
 const plan=weekly(),state=stateWith(plan),third=swiftSeconds('2026-10-26T19:00:00+08:00');saveAdvancedPlan(state,{id,title:'第三次例外'},'thisOccurrence',third,now);const future=planSnapshot(plan,second);future.title='未来组';future.location='新地点';saveAdvancedPlan(state,future,'thisAndFuture',second,now);
 assert.equal(state.tasks.length,2);assert.equal(events(state,plan.startsAt)[0].task.title,plan.title);assert.equal(events(state,second)[0].task.title,'未来组');assert.equal(events(state,third)[0].task.title,'第三次例外');assert.notEqual(state.tasks[1].id,id);assert.equal(readPlan(state.tasks[0]).repeatRule!.until,shanghaiDay('2026-10-18'));
});
test('this-and-future editing at the first anchor preserves the parent ID and drops only that selected exception',()=>{
 const state=stateWith(),plan=weekly();saveAdvancedPlan(state,{id,title:'首次例外'},'thisOccurrence',plan.startsAt,now);saveAdvancedPlan(state,{id,title:'第二次例外'},'thisOccurrence',second,now);saveAdvancedPlan(state,{id,title:'新的整组'},'thisAndFuture',plan.startsAt,now);assert.equal(state.tasks.length,1);assert.equal(state.tasks[0].id,id);assert.equal(events(state,plan.startsAt)[0].task.title,'新的整组');assert.equal(events(state,second)[0].task.title,'第二次例外');
});
test('deleting this-and-future preserves earlier execution and a deadline after the cutoff',()=>{
 const plan=weekly();plan.deadline=swiftSeconds('2026-10-22T23:59:00+08:00');const state=stateWith(plan);removeAdvancedPlan(state,id,'thisAndFuture',second,now);assert.equal(events(state,plan.startsAt).length,1);assert.equal(events(state,plan.deadline!)[0].originalDate,plan.startsAt);assert.equal(events(state,second).length,0);assert.equal(events(state,'2026-10-29').length,0);
});
test('this-and-future cancellation retains a restorable future series with its exceptions',()=>{
 const state=stateWith(),third=swiftSeconds('2026-10-26T19:00:00+08:00');saveAdvancedPlan(state,{id,location:'保留单次地点'},'thisOccurrence',third,now);changePlanStatus(state,id,'cancel','thisAndFuture',second,now);assert.equal(state.tasks.length,2);assert.equal(events(state,second).length,0);assert.equal(events(state,weekly().startsAt).length,1);const future=state.tasks.find(p=>p.id!==id)!;assert.equal(future.cancelledAt,now);changePlanStatus(state,future.id,'restore','all',undefined,now);assert.equal(events(state,second).length,1);assert.equal(events(state,third)[0].task.location,'保留单次地点');
});
test('group edits remap original anchors by occurrence index and removing recurrence clears exceptions',()=>{
 const state=stateWith();saveAdvancedPlan(state,{id,title:'second'},'thisOccurrence',second,now);saveAdvancedPlan(state,{id,startsAt:swiftSeconds('2026-10-13T19:00:00+08:00'),endsAt:swiftSeconds('2026-10-13T20:00:00+08:00')},'all',undefined,now);assert.equal(readPlan(state.tasks[0]).exceptions[0].originalDate,swiftSeconds('2026-10-20T19:00:00+08:00'));saveAdvancedPlan(state,{id,repeatRule:undefined},'all',undefined,now);assert.deepEqual(state.tasks[0].exceptions,[]);
});
test('disabling execution or deleting group deadline also removes stale occurrence-level overrides',()=>{
 const state=stateWith(),p=weekly();saveAdvancedPlan(state,{id,startsAt:second+3600,endsAt:second+7200,deadline:second+5*86400},'thisOccurrence',second,now);saveAdvancedPlan(state,{id,hasExecutionTime:false},'all',undefined,now);assert.equal(planEvents('2026-10-19',state.tasks).filter(e=>!e.isDeadline).length,0);saveAdvancedPlan(state,{id,repeatRule:undefined,deadline:undefined},'all',undefined,now);assert.deepEqual(planEvents(p.startsAt,state.tasks),[]);
});
test('archived plans are read-only until unarchived and archive requires valid chronology',()=>{
 const state=stateWith();changePlanStatus(state,id,'archive','all',undefined,now);assert.equal(state.tasks[0].completedAt,now);assert.equal(state.tasks[0].archivedAt,now);assert.deepEqual(events(state,weekly().startsAt),[]);assert.throws(()=>saveAdvancedPlan(state,{id,title:'不可编辑'}),/只读/);assert.throws(()=>changePlanStatus(state,id,'complete'),/只读/);changePlanStatus(state,id,'unarchive');saveAdvancedPlan(state,{id,title:'可编辑'});assert.equal(state.tasks[0].title,'可编辑');
 const future=stateWith({...weekly(),startsAt:now+86400,endsAt:now+90000,deadline:undefined,repeatRule:undefined});assert.throws(()=>changePlanStatus(future,id,'archive','all',undefined,now),/晚于/);
});
test('unsupported status scopes and non-anchor exception writes are rejected',()=>{
 const state=stateWith();for(const status of ['complete','reopen','restore','archive','unarchive'] as PlanStatus[])assert.throws(()=>changePlanStatus(state,id,status,'thisAndFuture',second,now));assert.throws(()=>changePlanStatus(state,id,'archive','thisOccurrence',second,now));assert.throws(()=>saveAdvancedPlan(state,{id,title:'invalid'},'thisOccurrence',second+1,now),/找不到/);assert.throws(()=>saveAdvancedPlan(state,{id,repeatRule:{frequency:'daily',interval:1}},'thisOccurrence',second,now),/单次/);
});
test('malformed recurrence, exceptions, relationships and chronology fail validation',()=>{
 const invalids:Plan[]=[];let p=weekly();p.repeatRule!.interval=0;invalids.push(p);p=weekly();p.endsAt=Number(p.startsAt)-1;invalids.push(p);p=weekly();p.exceptions=[{originalDate:second+1}];invalids.push(p);p=weekly();p.exceptions=[{originalDate:second},{originalDate:second}];invalids.push(p);p=weekly();p.courseID='11111111-2222-4333-8444-000000000099';invalids.push(p);p=weekly();p.repeatRule!.until=shanghaiDay('2026-01-01');invalids.push(p);
 for(const plan of invalids)assert.throws(()=>validatePlans({...emptyLibrary(),tasks:[plan]}));assert.equal(isPlanOccurrenceAnchor(second+1,weekly()),false);assert.deepEqual(planEvents(NaN,[weekly()]),[]);
});
test('old tasks with a deadline retain deadline-only semantics',()=>{
 const raw:any={...emptyLibrary(),tasks:[weekly()]};for(const key of ['origin','hasExecutionTime','endsAt','location','showInMonth','repeatRule','completionRequired','cancelledAt','deadlineIsAllDay','exceptions'])delete raw.tasks[0][key];const state=decodeLibrary(raw);assert.equal(events(state,weekly().startsAt).length,0);assert.equal(events(state,weekly().deadline!)[0].isDeadline,true);
});
test('repository advanced APIs persist split groups and recover from failed writes without partial edits',async t=>{
 const repo=await fixture(t);await repo.savePlan(weekly());await repo.savePlan({id,title:'新的未来'},'thisAndFuture',second);assert.equal(repo.state.tasks.length,2);const before=repo.state,bytes=await fs.readFile(path.join(repo.root,'library.json'));await fs.rm(path.join(repo.root,'library.json.bak'));await fs.mkdir(path.join(repo.root,'library.json.bak'));await assert.rejects(repo.setPlanStatus(id,'cancel'));assert.deepEqual(repo.state,before);assert.deepEqual(await fs.readFile(path.join(repo.root,'library.json')),bytes);
});
test('repository plan guards recheck revisions in the writer queue and preserve unrelated plans',async t=>{
 const repo=await fixture(t);await repo.savePlan(weekly());await repo.savePlan({title:'other'});const later=repo.savePlan({id,title:'latest'});const stale=repo.withMutationGuard(s=>{if(s.tasks.find(p=>p.id===id)?.title!=='实验报告')throw new Error('revision_conflict');},()=>repo.deletePlan(id));await later;await assert.rejects(stale,/revision_conflict/);assert.equal(repo.state.tasks.length,2);assert.equal(repo.state.tasks[0].title,'latest');
});
test('single deletion is reversible cancellation and full deletion removes all derived deadlines',()=>{
 const state=stateWith();removeAdvancedPlan(state,id,'thisOccurrence',second,now);assert.equal(events(state,second).length,0);changePlanStatus(state,id,'restore','thisOccurrence',second,now);assert.equal(events(state,second).length,1);removeAdvancedPlan(state,id,'all');assert.equal(events(state,weekly().deadline!).length,0);assert.equal(state.tasks.length,0);
});

interface Operation {kind:'save'|'status'|'delete';input?:Partial<StudyTask>;id?:string;status?:PlanStatus;scope?:PlanEditScope;originalDate?:number}
interface ContractCase {name:string;initial:LibraryState;operations:Operation[];state:LibraryState;dates:number[];expected:unknown[]}
function contractCase(name:string,plan:Plan,operations:Operation[],dates:string[]):ContractCase {
 const initial=stateWith(plan),state=structuredClone(initial);
 for(const op of operations){if(op.kind==='save')saveAdvancedPlan(state,op.input!,op.scope,op.originalDate,now);else if(op.kind==='status')changePlanStatus(state,op.id!,op.status!,op.scope,op.originalDate,now);else removeAdvancedPlan(state,op.id!,op.scope,op.originalDate,now);}
 validatePlans(state);const days=dates.map(shanghaiDay);
 const expected=days.map(day=>({day,events:planEvents(day,state.tasks).map(e=>({title:e.task.title,content:e.task.content,location:e.task.location,colorHex:e.task.colorHex??null,date:e.date,endDate:e.endDate??null,originalDate:e.originalDate,isDeadline:e.isDeadline,isAllDay:e.isAllDay,isCompleted:e.task.completedAt!=null,isFixed:e.isFixed}))}));
 return {name,initial,operations,state,dates:days,expected};
}
test('exports a production-Swift differential contract with recurrence and scoped mutation boundaries',async()=>{
 const month={...weekly(),startsAt:swiftSeconds('2026-01-31T23:30:00.125+08:00'),endsAt:undefined,deadline:undefined,repeatRule:{frequency:'monthly' as const,interval:1,until:shanghaiDay('2026-03-31')}};
 const daily={...weekly(),startsAt:shanghaiDay('2026-10-01'),deadline:swiftSeconds('2026-10-13T00:15:00+08:00'),hasExecutionTime:false,repeatRule:{frequency:'daily' as const,interval:2,until:shanghaiDay('2026-10-17')}};
 const moved=weekly();moved.exceptions=[{originalDate:moved.startsAt,startsAt:second,endsAt:second+3600,deadline:swiftSeconds('2026-12-20T23:59:00+08:00')}];
 const completed=weekly();completed.completedAt=now;
 const cases=[
  contractCase('month-end-no-drift',month,[],['2026-01-31','2026-02-28','2026-03-28','2026-03-31','2026-04-30']),
  contractCase('deadline-only-two-day',daily,[],['2026-10-13','2026-10-14','2026-10-15','2026-10-17','2026-10-19']),
  contractCase('independent-far-moves',moved,[],['2026-10-12','2026-10-16','2026-10-19','2026-12-20']),
  contractCase('single-partial-then-group',weekly(),[{kind:'save',input:{id,title:'仅一次',location:'临时'},scope:'thisOccurrence',originalDate:second},{kind:'save',input:{id,content:'更新整组',colorHex:'#39786B'}}],['2026-10-12','2026-10-19','2026-10-23','2026-10-26']),
  contractCase('single-reopen-completed-series',completed,[{kind:'status',id,status:'reopen',scope:'thisOccurrence',originalDate:second}],['2026-10-12','2026-10-19','2026-10-23','2026-10-26']),
  contractCase('split-future-keeps-exceptions',weekly(),[{kind:'save',input:{id,title:'之后的例外'},scope:'thisOccurrence',originalDate:second+7*86400},{kind:'save',input:{id,title:'新的未来'},scope:'thisAndFuture',originalDate:second}],['2026-10-12','2026-10-16','2026-10-19','2026-10-26','2026-11-02']),
  contractCase('cancel-future',weekly(),[{kind:'status',id,status:'cancel',scope:'thisAndFuture',originalDate:second}],['2026-10-12','2026-10-16','2026-10-19','2026-10-23']),
  contractCase('delete-future-retains-late-deadline',{...weekly(),deadline:swiftSeconds('2026-10-22T23:59:00+08:00')},[{kind:'delete',id,scope:'thisAndFuture',originalDate:second}],['2026-10-12','2026-10-19','2026-10-22','2026-10-29']),
  contractCase('multiday-midnight-end',{...weekly(),repeatRule:undefined,startsAt:swiftSeconds('2026-10-12T20:00:00+08:00'),endsAt:shanghaiDay('2026-10-14'),deadline:undefined},[],['2026-10-12','2026-10-13','2026-10-14']),
  contractCase('group-anchor-remap',weekly(),[{kind:'save',input:{id,title:'本次'},scope:'thisOccurrence',originalDate:second},{kind:'save',input:{id,startsAt:swiftSeconds('2026-10-13T19:00:00+08:00'),endsAt:swiftSeconds('2026-10-13T20:00:00+08:00')}}],['2026-10-12','2026-10-13','2026-10-19','2026-10-20'])
 ];
 if(process.env.TEACHSHELF_PLANS_ROUNDTRIP)await fs.writeFile(process.env.TEACHSHELF_PLANS_ROUNDTRIP,JSON.stringify({now,cases},null,2));assert.ok(cases.length>=6);
});
