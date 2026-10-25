import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {Repository} from '../electron/services/storage/repository.ts';
import {importUndergraduateTimetable,updateTimetableSettings,cancelTimetableOccurrence,restoreTimetableOccurrence,readTimetableTerms,validateTimetables} from '../electron/services/course/timetable.ts';
import {decodeLibrary,emptyLibrary,dateMs} from '../shared/model.ts';
import {timetableOccurrences,timetableWeek,timetableDate,inferWeekOneMonday,shanghaiDay,shanghaiDayKey,meetingTimeRange,isScheduled} from '../shared/timetable.ts';
import type {TimetableTerm,TimetableMeeting} from '../shared/timetable.ts';

const sample=JSON.parse(await fs.readFile(fileURLToPath(new URL('../../Resources/Timetable/Sample-undergraduate.json',import.meta.url)),'utf8'));
const swiftFixture=JSON.parse(await fs.readFile(fileURLToPath(new URL('./fixtures/swift-schema9.json',import.meta.url)),'utf8'));
const settings={weekOneMonday:'2026-08-30T16:00:00Z',weekCount:20,sectionTimes:swiftFixture.timetableTerms[0].sectionTimes};
const row=(changes:Record<string,unknown>={})=>({name:'高等数学',class_number:'MATH001',teacher:'张老师',classroom:'101',weeks:[1,2,3,4],week_time:1,start_time:1,time_count:1,...changes});
const schedule=(courses:unknown[],name='2026 秋季')=>({name,courses});
function stateWithTimetable(){const state=emptyLibrary();const summary=importUndergraduateTimetable(state,schedule([row()]));updateTimetableSettings(state,summary.termID,settings);return {state,term:readTimetableTerms(state)[0]};}
async function fixture(t:{after:(f:()=>Promise<void>)=>void}){const dir=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'teachshelf-timetable-')));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const repo=await Repository.open(path.join(dir,'Library'),{create:true});t.after(()=>repo.close());return {repo,dir};}

test('repository sample imports five courses and six sessions with explicit free-time and end-offset rules',async t=>{
 const {repo}=await fixture(t);const result=await repo.importTimetable(sample);assert.equal(result.summary.coursesCreated,5);assert.equal(result.summary.meetingsImported,6);
 const term=readTimetableTerms(repo.state)[0];assert.equal(term.weekCount,20);assert.deepEqual(term.sectionTimes,[]);assert.equal(term.weekOneMonday,undefined);
 assert.equal(term.meetings[2].sectionCount,3);assert.equal(term.meetings[4].sectionCount,1);assert.equal(isScheduled(term.meetings[5]),false);assert.deepEqual(timetableOccurrences(term,'2026-10-05'),[]);
 for(const course of repo.state.courses)assert.ok((await fs.stat(path.join(repo.root,`files/${course.name} [${course.id}]/资料`))).isDirectory());
});
test('exact duplicate sessions collapse, unique rooms remain, weeks sort and duplicates collapse',()=>{
 const state=emptyLibrary(),first=row({weeks:[3,1,3]});const result=importUndergraduateTimetable(state,schedule([first,first,row({weeks:[1,3],classroom:'102'}),row({week_time:4,start_time:5,time_count:0}),row({name:'论文',class_number:'',teacher:null,weeks:[],week_time:0,start_time:0,time_count:0})]));
 assert.equal(result.coursesCreated,2);assert.equal(result.meetingsImported,4);const term=readTimetableTerms(state)[0];assert.deepEqual(term.meetings[0].weeks,[1,3]);assert.equal(term.meetings[0].sectionCount,2);assert.equal(term.meetings[2].sectionCount,1);assert.equal(term.meetings[3].weekday,undefined);
});
test('exam details become notes while missing optional portal strings and warnings are accepted',()=>{
 const state=emptyLibrary();importUndergraduateTimetable(state,schedule([row({info:' 教学备注 ',test_time:'另行通知',test_location:' 201 '})]));assert.equal(readTimetableTerms(state)[0].meetings[0].note,'教学备注\n考试时间：另行通知\n考试地点：201');
});
test('reimport preserves edited course identity, original meeting IDs, colors and semester settings',async t=>{
 const {repo,dir}=await fixture(t);const result=await repo.importTimetable(schedule([row()]));const initial=readTimetableTerms(repo.state)[0];const course=repo.state.courses[0];
 await repo.saveTimetableSettings(initial.id,{...settings,weekCount:24});await repo.updateCourse(course.id,{name:'本地名称',teacher:'本地教师',colorHex:'#8058A1'});
 const file=path.join(dir,'note.txt');await fs.writeFile(file,'保留笔记');await repo.importFiles([file],{courseID:course.id});await repo.saveTask({title:'作业',courseID:course.id});
 const exact=await repo.importTimetable(schedule([row()]));assert.equal(exact.summary.coursesCreated,0);assert.equal(readTimetableTerms(repo.state)[0].meetings[0].id,initial.meetings[0].id);
 const changed=await repo.importTimetable(schedule([row({teacher:'门户新教师'}),row({week_time:3,start_time:3})],' 2026 秋季 '));assert.equal(changed.summary.termID,result.summary.termID);assert.equal(changed.summary.coursesCreated,0);assert.equal(changed.summary.meetingsImported,2);
 const term=readTimetableTerms(repo.state)[0];assert.ok(term.meetings.every(m=>m.courseID===course.id));assert.equal(term.weekCount,24);assert.equal(term.weekOneMonday,shanghaiDay(settings.weekOneMonday));assert.deepEqual(term.sectionTimes,settings.sectionTimes);
 assert.equal(repo.state.courses[0].name,'本地名称');assert.equal(repo.state.courses[0].teacher,'本地教师');assert.equal(repo.state.materials.length,1);assert.equal(repo.state.tasks.length,1);assert.equal(await fs.readFile(await repo.resolveMaterial(repo.state.materials[0].id),'utf8'),'保留笔记');
});
test('exact existing semester/name/teacher course is reused and same reimport leaves the data identical',()=>{
 const state=emptyLibrary();state.courses.push({id:'11111111-2222-4333-8444-000000000001',name:'高等数学',semester:'2026 秋季',teacher:'张老师',colorHex:'#39786B',isArchived:false});
 const first=importUndergraduateTimetable(state,schedule([row()]));assert.equal(first.coursesCreated,0);const before=structuredClone(state);importUndergraduateTimetable(state,schedule([row()]));assert.deepEqual(state,before);
});
test('course keys prefer portal number and do not conflate unrelated blank-code courses',()=>{
 const state=emptyLibrary();importUndergraduateTimetable(state,schedule([row({class_number:''}),row({name:'大学英语',class_number:''}),row({class_number:'',teacher:'另一教师'})]));assert.equal(state.courses.length,3);
});
test('Shanghai calendar changes week at local Monday and honors final-day bounds',()=>{
 const {term}=stateWithTimetable();term.weekCount=2;
 assert.equal(timetableWeek(term,'2026-08-30T15:59:59Z'),undefined);assert.equal(timetableWeek(term,'2026-08-30T16:00:00Z'),1);assert.equal(timetableWeek(term,'2026-09-06T15:59:59Z'),1);assert.equal(timetableWeek(term,'2026-09-06T16:00:00Z'),2);assert.equal(timetableWeek(term,'2026-09-13T16:00:00Z'),undefined);
 term.endDate=shanghaiDay('2026-09-11');assert.equal(timetableWeek(term,'2026-09-11T15:59:59Z'),2);assert.equal(timetableWeek(term,'2026-09-11T16:00:00Z'),undefined);assert.equal(timetableDate(term,2,5),shanghaiDay('2026-09-11'));assert.equal(timetableDate(term,2,6),undefined);
});
test('week-one inference matches Swift academic week-eight example and rejects invalid inputs',()=>{
 const expected=shanghaiDay('2026-08-24');assert.equal(inferWeekOneMonday('2026-10-14T04:00:00Z',8),expected);assert.equal(inferWeekOneMonday('2026-10-11T16:00:00Z',8),expected);
 assert.equal(inferWeekOneMonday('2026-10-11T15:59:59Z',8),shanghaiDay('2026-08-17'));for(const week of [-1,0,61,1.5])assert.equal(inferWeekOneMonday('2026-10-14',week),undefined);assert.equal(inferWeekOneMonday(NaN,8),undefined);
});
test('clock projection uses configured section bounds and optional per-meeting overrides',()=>{
 const {term}=stateWithTimetable();const meeting=term.meetings[0];assert.deepEqual(meetingTimeRange(meeting,term.sectionTimes),{start:480,end:590});assert.equal(meetingTimeRange(meeting,[]),undefined);
 assert.deepEqual(meetingTimeRange({...meeting,startMinuteOverride:500,endMinuteOverride:550},[]),{start:500,end:550});assert.equal(meetingTimeRange({...meeting,startMinuteOverride:600,endMinuteOverride:500},[]),undefined);
});
test('Swift fixture projection includes recurring sessions, excludes cancellations, and renders moved snapshots',()=>{
 const state=decodeLibrary(swiftFixture);validateTimetables(state);const term=readTimetableTerms(state)[0];assert.equal(timetableOccurrences(term,'2026-10-05').length,1);assert.equal(timetableOccurrences(term,'2026-10-12').length,0);assert.equal(timetableOccurrences(term,'2026-10-19').length,0);
 const moved=timetableOccurrences(term,'2026-10-20');assert.equal(moved.length,1);assert.equal(moved[0].rescheduleID,term.reschedules[0].id);assert.equal(moved[0].originalDate,shanghaiDay('2026-10-19'));assert.equal(timetableOccurrences(term,'2026-10-26').length,1);
});
test('single-occurrence cancellation and restoration preserve recurring meeting and repeat cancellation does not rewrite backup',async t=>{
 const {repo}=await fixture(t);const result=await repo.importTimetable(schedule([row()]));await repo.saveTimetableSettings(result.summary.termID,settings);const term=readTimetableTerms(repo.state)[0],meeting=term.meetings[0];
 await repo.cancelTimetableClass(term.id,meeting.id,'2026-08-31T08:00:00Z',' 临时停课 ');const cancelled=readTimetableTerms(repo.state)[0];assert.equal(cancelled.cancellations[0].reason,'临时停课');assert.deepEqual(cancelled.meetings,term.meetings);assert.equal(timetableOccurrences(cancelled,'2026-08-31').length,0);assert.equal(timetableOccurrences(cancelled,'2026-09-07').length,1);
 const backup=await fs.readFile(path.join(repo.root,'library.json.bak'));await repo.cancelTimetableClass(term.id,meeting.id,'2026-08-31','不同理由');assert.deepEqual(await fs.readFile(path.join(repo.root,'library.json.bak')),backup);assert.equal(readTimetableTerms(repo.state)[0].cancellations[0].reason,'临时停课');
 await repo.restoreTimetableClass(term.id,cancelled.cancellations[0].id);assert.equal(timetableOccurrences(readTimetableTerms(repo.state)[0],'2026-08-31').length,1);
});
test('cancelling a moved session stores its exact snapshot and restoration restores the moved target',()=>{
 const state=decodeLibrary(swiftFixture),term=readTimetableTerms(state)[0],move=structuredClone(term.reschedules[0]);assert.equal(cancelTimetableOccurrence(state,term.id,move.meetingID,move.originalDate),true);let after=readTimetableTerms(state)[0];assert.equal(after.reschedules.length,0);const cancellation=after.cancellations.find(c=>c.savedReschedule)!;assert.deepEqual(cancellation.savedReschedule,move);
 assert.equal(restoreTimetableOccurrence(state,term.id,cancellation.id),true);after=readTimetableTerms(state)[0];assert.deepEqual(after.reschedules,[move]);assert.equal(timetableOccurrences(after,move.date).length,1);
});
test('reimport remaps cancellation and move IDs only when the source slot matches unambiguously',()=>{
 const state=decodeLibrary(swiftFixture),old=readTimetableTerms(state)[0];const meeting=old.meetings[0];const originalMove=structuredClone(old.reschedules[0]);
 const updated=row({name:meeting.title,teacher:meeting.teacher,class_number:meeting.courseCode,classroom:'门户新教室',weeks:meeting.weeks,week_time:meeting.weekday,start_time:meeting.startSection,time_count:meeting.sectionCount-1,info:meeting.note});
 importUndergraduateTimetable(state,schedule([updated],old.name));const term=readTimetableTerms(state)[0],replacement=term.meetings[0];assert.notEqual(replacement.id,meeting.id);assert.equal(replacement.courseID,meeting.courseID);assert.equal(term.cancellations[0].meetingID,replacement.id);assert.equal(term.reschedules[0].meetingID,replacement.id);assert.equal(term.reschedules[0].meeting.id,replacement.id);assert.equal(term.reschedules[0].id,originalMove.id);assert.equal(term.reschedules[0].meeting.classroom,originalMove.meeting.classroom);
});
test('orphan moved snapshots survive removed portal sessions and remain cancellable/restorable',()=>{
 const state=decodeLibrary(swiftFixture),old=readTimetableTerms(state)[0],move=structuredClone(old.reschedules[0]);importUndergraduateTimetable(state,schedule([row({name:'另一门课',class_number:'OTHER'})],old.name));let term=readTimetableTerms(state)[0];assert.ok(!term.meetings.some(m=>m.id===move.meetingID));assert.equal(timetableOccurrences(term,move.date).length,1);
 cancelTimetableOccurrence(state,term.id,move.meetingID,move.originalDate);term=readTimetableTerms(state)[0];const c=term.cancellations.find(c=>c.savedReschedule)!;restoreTimetableOccurrence(state,term.id,c.id);assert.equal(timetableOccurrences(readTimetableTerms(state)[0],move.date).length,1);
});
test('saved cancellation snapshots remap alongside active moves on reimport',()=>{
 const state=decodeLibrary(swiftFixture),old=readTimetableTerms(state)[0],move=old.reschedules[0];cancelTimetableOccurrence(state,old.id,move.meetingID,move.originalDate);
 const m=old.meetings[0];importUndergraduateTimetable(state,schedule([row({name:m.title,class_number:m.courseCode,teacher:m.teacher,classroom:'Changed',weeks:m.weeks,week_time:m.weekday,start_time:m.startSection,time_count:m.sectionCount-1})],old.name));const term=readTimetableTerms(state)[0],saved=term.cancellations.find(c=>c.savedReschedule)!.savedReschedule!;assert.equal(saved.meetingID,term.meetings[0].id);assert.equal(saved.meeting.id,term.meetings[0].id);
});
test('ambiguous same-slot remapping preserves historical detached IDs',()=>{
 const state=decodeLibrary(swiftFixture),old=readTimetableTerms(state)[0],m=old.meetings[0];const common=row({name:m.title,class_number:m.courseCode,teacher:m.teacher,weeks:m.weeks,week_time:m.weekday,start_time:m.startSection,time_count:m.sectionCount-1});importUndergraduateTimetable(state,schedule([{...common,classroom:'A'},{...common,classroom:'B'}],old.name));const term=readTimetableTerms(state)[0];assert.equal(term.cancellations[0].meetingID,m.id);assert.equal(term.reschedules[0].meetingID,m.id);
});
test('setting an end date bounds subsequent imports and invalid edits leave persisted data unchanged',async t=>{
 const {repo}=await fixture(t);const imported=await repo.importTimetable(schedule([row()]));await repo.saveTimetableSettings(imported.summary.termID,{...settings,weekCount:4,endDate:'2026-09-25'});const before=repo.state,bytes=await fs.readFile(path.join(repo.root,'library.json'));
 await assert.rejects(repo.importTimetable(schedule([row({weeks:[1,5]})])),/超过/);await assert.rejects(repo.saveTimetableSettings(imported.summary.termID,{weekOneMonday:'2026-09-01'}),/周一/);await assert.rejects(repo.saveTimetableSettings(imported.summary.termID,{weekCount:3}),/结束日期/);assert.deepEqual(repo.state,before);assert.deepEqual(await fs.readFile(path.join(repo.root,'library.json')),bytes);
});
test('malformed inputs cannot commit partial newly-created courses',async t=>{
 const {repo}=await fixture(t);await repo.importTimetable(schedule([row()]));await repo.sync();const before=repo.state,bytes=await fs.readFile(path.join(repo.root,'library.json'));
 const bad=[row({weeks:[]}),row({weeks:[0]}),row({weeks:[61]}),row({week_time:8}),row({week_time:null}),row({start_time:30,time_count:1}),row({time_count:-1}),row({start_time:0,time_count:1}),row({name:' '}),row({time_count:1.5})];
 for(const invalid of bad)await assert.rejects(repo.importTimetable(schedule([row({class_number:'NEW',name:'新课程'}),invalid])));assert.deepEqual(repo.state,before);assert.deepEqual(await fs.readFile(path.join(repo.root,'library.json')),bytes);
});
test('overlapping and unsorted clocks, duplicate IDs and malformed snapshots are rejected',()=>{
 const {state,term}=stateWithTimetable();for(const times of [[{section:1,startMinute:480,endMinute:530},{section:2,startMinute:520,endMinute:580}],[{section:2,startMinute:480,endMinute:530},{section:1,startMinute:540,endMinute:590}],[{section:1,startMinute:1400,endMinute:1450}]])assert.throws(()=>updateTimetableSettings(structuredClone(state),term.id,{sectionTimes:times}));
 const duplicate=structuredClone(state);(duplicate.timetableTerms[0].meetings as TimetableMeeting[]).push(structuredClone(term.meetings[0]));assert.throws(()=>validateTimetables(duplicate),/重复/);
 const malformed=decodeLibrary(swiftFixture);(malformed.timetableTerms[0].reschedules as any[])[0].meeting.weekday=1;assert.throws(()=>validateTimetables(malformed),/星期/);
});
test('invalid occurrence cannot be cancelled and nonexistent cancellation restore is harmless',()=>{
 const {state,term}=stateWithTimetable();const before=structuredClone(state);assert.throws(()=>cancelTimetableOccurrence(state,term.id,term.meetings[0].id,'2026-09-01'),/没有/);assert.equal(restoreTimetableOccurrence(state,term.id,'11111111-2222-4333-8444-000000000099'),false);assert.deepEqual(state,before);
});
test('old missing cancellation/reschedule arrays decode while explicit null is rejected',()=>{
 const {state}=stateWithTimetable();delete state.timetableTerms[0].cancellations;delete state.timetableTerms[0].reschedules;validateTimetables(state);assert.deepEqual(readTimetableTerms(state)[0].reschedules,[]);state.timetableTerms[0].reschedules=null;assert.throws(()=>readTimetableTerms(state));
});
test('index-write failure rolls back imported courses and semester state',async t=>{
 const {repo}=await fixture(t);await repo.importTimetable(schedule([row()]));const before=repo.state;const index=await fs.readFile(path.join(repo.root,'library.json'));await fs.rm(path.join(repo.root,'library.json.bak'));await fs.mkdir(path.join(repo.root,'library.json.bak'));
 await assert.rejects(repo.importTimetable(schedule([row({class_number:'NEW'})],'Other')));assert.deepEqual(repo.state,before);assert.deepEqual(await fs.readFile(path.join(repo.root,'library.json')),index);
});
test('timetable settings and cancelled occurrences survive closing and reopening the repository',async t=>{
 const {repo}=await fixture(t);const {summary}=await repo.importTimetable(sample);await repo.saveTimetableSettings(summary.termID,settings);const term=readTimetableTerms(repo.state)[0];await repo.cancelTimetableClass(term.id,term.meetings[0].id,'2026-08-31');const before=repo.state.timetableTerms;await repo.close();const opened=await Repository.open(repo.root);t.after(()=>opened.close());assert.deepEqual(opened.state.timetableTerms,before);
});
test('exports a Swift decoder and projection comparison bundle when explicitly requested',async()=>{
 const state=decodeLibrary(swiftFixture);const old=readTimetableTerms(state)[0];const move=old.reschedules[0];cancelTimetableOccurrence(state,old.id,move.meetingID,move.originalDate);const cancellation=readTimetableTerms(state)[0].cancellations.find(c=>c.savedReschedule)!;restoreTimetableOccurrence(state,old.id,cancellation.id);
 const imported=importUndergraduateTimetable(state,sample);updateTimetableSettings(state,imported.termID,settings);const term=readTimetableTerms(state).find(t=>t.id===imported.termID)!;cancelTimetableOccurrence(state,term.id,term.meetings[0].id,'2026-08-31');validateTimetables(state);
 const dates=['2026-08-31','2026-09-01','2026-09-02','2026-10-05','2026-10-12','2026-10-19','2026-10-20','2026-10-26'].map(shanghaiDay);
 const expected=dates.map(date=>({date,events:readTimetableTerms(state).flatMap(term=>timetableOccurrences(term,date).map(e=>({termID:term.id,meetingID:e.meeting.id,date:e.date,originalDate:e.originalDate,rescheduleID:e.rescheduleID??null})))}));
 if(process.env.TEACHSHELF_TIMETABLE_ROUNDTRIP)await fs.writeFile(process.env.TEACHSHELF_TIMETABLE_ROUNDTRIP,JSON.stringify({state,expected},null,2));
 assert.equal(shanghaiDayKey(dateMs('2026-08-31')/1000-978307200),'2026-08-31');
});

test('single class reschedule persists the source anchor, preserves following weeks, and restores',async t=>{
 const {repo}=await fixture(t);const result=await repo.importTimetable(schedule([row()]));await repo.saveTimetableSettings(result.summary.termID,settings);const term=readTimetableTerms(repo.state)[0],meeting=term.meetings[0];
 const target={date:'2026-09-02T00:00:00+08:00',startSection:3,sectionCount:2,classroom:' 新教室 ',startMinute:630,endMinute:720};
 await repo.rescheduleTimetableClass(term.id,meeting.id,'2026-08-31T08:00:00+08:00',target);let current=readTimetableTerms(repo.state)[0];const move=current.reschedules[0];
 assert.equal(move.originalDate,shanghaiDay('2026-08-31'));assert.equal(move.meeting.classroom,'新教室');assert.equal(move.meeting.weekday,3);assert.equal(timetableOccurrences(current,'2026-08-31').length,0);assert.equal(timetableOccurrences(current,'2026-09-02').length,1);assert.equal(timetableOccurrences(current,'2026-09-07').length,1);assert.deepEqual(current.meetings,term.meetings);
 await repo.rescheduleTimetableClass(term.id,meeting.id,move.originalDate,{...target,date:'2026-09-03'});current=readTimetableTerms(repo.state)[0];assert.equal(current.reschedules[0].id,move.id);assert.equal(current.reschedules[0].originalDate,move.originalDate);assert.equal(timetableOccurrences(current,'2026-09-02').length,0);
 await repo.cancelTimetableClass(term.id,meeting.id,move.originalDate);current=readTimetableTerms(repo.state)[0];assert.equal(current.reschedules.length,0);assert.equal(timetableOccurrences(current,'2026-09-03').length,0);
 await repo.restoreTimetableClass(term.id,current.cancellations[0].id);current=readTimetableTerms(repo.state)[0];assert.equal(timetableOccurrences(current,'2026-09-03').length,1);
 const bytes=JSON.parse(await fs.readFile(path.join(repo.root,'library.json'),'utf8'));assert.equal(bytes.timetableTerms[0].reschedules[0].id,move.id);
 await repo.restoreTimetableMove(term.id,move.id);current=readTimetableTerms(repo.state)[0];assert.equal(timetableOccurrences(current,'2026-08-31').length,1);assert.equal(timetableOccurrences(current,'2026-09-03').length,0);
});
test('invalid reschedules are atomic and returning a moved class to its original slot removes the override',async t=>{
 const {repo}=await fixture(t);const result=await repo.importTimetable(schedule([row()]));await repo.saveTimetableSettings(result.summary.termID,settings);const term=readTimetableTerms(repo.state)[0],meeting=term.meetings[0],date='2026-08-31',good={date:'2026-09-01',startSection:2,sectionCount:2,classroom:'B'};
 await repo.sync();const before=repo.state,bytes=await fs.readFile(path.join(repo.root,'library.json'));
 for(const changes of [{date:'2027-09-01'},{startSection:30,sectionCount:2},{startMinute:700},{startMinute:720,endMinute:700},{sectionCount:0}])await assert.rejects(repo.rescheduleTimetableClass(term.id,meeting.id,date,{...good,...changes}));
 await assert.rejects(repo.rescheduleTimetableClass(term.id,meeting.id,'2026-09-01',good),/原课次/);assert.deepEqual(repo.state,before);assert.deepEqual(await fs.readFile(path.join(repo.root,'library.json')),bytes);
 await repo.rescheduleTimetableClass(term.id,meeting.id,date,good);await repo.rescheduleTimetableClass(term.id,meeting.id,date,{date,startSection:meeting.startSection,sectionCount:meeting.sectionCount,classroom:meeting.classroom});assert.equal(readTimetableTerms(repo.state)[0].reschedules.length,0);
 await repo.cancelTimetableClass(term.id,meeting.id,date);await assert.rejects(repo.rescheduleTimetableClass(term.id,meeting.id,date,good),/停课/);
});
