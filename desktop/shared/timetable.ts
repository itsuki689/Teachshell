import {dateMs, SWIFT_EPOCH_MS} from './model.ts';
import type {SwiftDate} from './model.ts';

/** Wire fields intentionally match TeachshelfCore/TimetableModels.swift. */
export interface TimetableSectionTime {section:number;startMinute:number;endMinute:number;[key:string]:unknown}
export interface TimetableMeeting {
 id:string;courseID?:string;courseCode:string;title:string;teacher:string;classroom:string;
 weeks:number[];weekday?:number;startSection:number;sectionCount:number;note:string;
 showInMonth?:boolean;startMinuteOverride?:number;endMinuteOverride?:number;colorHex?:string;
 [key:string]:unknown;
}
export interface TimetableReschedule {
 id:string;meetingID:string;originalDate:SwiftDate;date:SwiftDate;meeting:TimetableMeeting;[key:string]:unknown;
}
export interface TimetableCancellation {
 id:string;meetingID:string;date:SwiftDate;title:string;reason:string;savedReschedule?:TimetableReschedule;[key:string]:unknown;
}
export interface TimetableTerm {
 id:string;name:string;weekOneMonday?:SwiftDate;weekCount:number;endDate?:SwiftDate;
 sectionTimes:TimetableSectionTime[];meetings:TimetableMeeting[];
 cancellations:TimetableCancellation[];reschedules:TimetableReschedule[];[key:string]:unknown;
}
export interface TimetableOccurrence {
 id:string;meeting:TimetableMeeting;date:number;originalDate:number;rescheduleID?:string;
}
export interface TimetableSettingsInput {
 name?:string;weekOneMonday?:SwiftDate|null;weekCount?:number;endDate?:SwiftDate|null;sectionTimes?:TimetableSectionTime[];
}
export interface TimetableImportSummary {termID:string;coursesCreated:number;meetingsImported:number}
export interface TimetableRescheduleInput {
 date:SwiftDate;startSection:number;sectionCount:number;classroom:string;startMinute?:number;endMinute?:number;
}

const DAY=86_400_000;
const dateFormatter=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'});
const timeFormatter=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
function parts(ms:number,includeTime=false):Record<string,number> {
 if(!Number.isFinite(ms)||!Number.isFinite(new Date(ms).getTime()))throw new Error('课表日期无效');
 return Object.fromEntries((includeTime?timeFormatter:dateFormatter).formatToParts(new Date(ms)).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]));
}
function civilNumber(value:SwiftDate):number {
 const p=parts(dateMs(value));return Math.floor(Date.UTC(p.year,p.month-1,p.day)/DAY);
}
function swiftDayFromCivil(day:number):number {
 // Resolve civil midnight through the timezone database, including historical
 // Shanghai DST; never use the execution host's local Date setters.
 const midnight=day*DAY;let instant=midnight;
 for(let i=0;i<4;i++){
  const p=parts(instant,true);
  const offset=Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second)-Math.floor(instant/1000)*1000;
  const next=midnight-offset;if(next===instant)break;instant=next;
 }
 return (instant-SWIFT_EPOCH_MS)/1000;
}
export function shanghaiDay(value:SwiftDate):number {return swiftDayFromCivil(civilNumber(value));}
export function shanghaiDayKey(value:SwiftDate):string {
 const p=parts(dateMs(value));return `${String(p.year).padStart(4,'0')}-${String(p.month).padStart(2,'0')}-${String(p.day).padStart(2,'0')}`;
}
export function shanghaiWeekday(value:SwiftDate):number {return ((civilNumber(value)+3)%7+7)%7+1;}
export function sameShanghaiDay(a:SwiftDate,b:SwiftDate):boolean {return civilNumber(a)===civilNumber(b);}
export function isScheduled(meeting:TimetableMeeting):boolean {
 return Number.isInteger(meeting.weekday)&&meeting.weekday!>=1&&meeting.weekday!<=7&&meeting.startSection>0&&meeting.sectionCount>0;
}
export function endSection(meeting:TimetableMeeting):number {return meeting.sectionCount>0?meeting.startSection+meeting.sectionCount-1:0;}
export function meetingTimeRange(meeting:TimetableMeeting,sections:TimetableSectionTime[]):{start:number;end:number}|undefined {
 if(!isScheduled(meeting))return undefined;
 const start=meeting.startMinuteOverride??sections.find(s=>s.section===meeting.startSection)?.startMinute;
 const end=meeting.endMinuteOverride??sections.find(s=>s.section===endSection(meeting))?.endMinute;
 return start!==undefined&&end!==undefined&&start>=0&&end<=1440&&end>start?{start,end}:undefined;
}
export function timetableWeek(term:TimetableTerm,value:SwiftDate):number|undefined {
 try{
  if(!Number.isInteger(term.weekCount)||term.weekCount<1||term.weekCount>60||term.weekOneMonday==null)return undefined;
  if(shanghaiWeekday(term.weekOneMonday)!==1)return undefined;
  const day=civilNumber(value),start=civilNumber(term.weekOneMonday);
  if(day<start||(term.endDate!=null&&day>civilNumber(term.endDate)))return undefined;
  const week=Math.floor((day-start)/7)+1;return week<=term.weekCount?week:undefined;
 }catch{return undefined;}
}
export function timetableDate(term:TimetableTerm,week:number,weekday:number):number|undefined {
 if(!Number.isInteger(week)||week<1||week>term.weekCount||!Number.isInteger(weekday)||weekday<1||weekday>7||term.weekOneMonday==null)return undefined;
 try{const day=swiftDayFromCivil(civilNumber(term.weekOneMonday)+(week-1)*7+weekday-1);return timetableWeek(term,day)!==undefined?day:undefined;}catch{return undefined;}
}
export function inferWeekOneMonday(reference:SwiftDate,academicWeek:number):number|undefined {
 if(!Number.isInteger(academicWeek)||academicWeek<1||academicWeek>60)return undefined;
 try{return swiftDayFromCivil(civilNumber(reference)-(shanghaiWeekday(reference)-1)-(academicWeek-1)*7);}catch{return undefined;}
}
export function isActualOccurrence(meeting:TimetableMeeting,term:TimetableTerm,date:SwiftDate):boolean {
 const week=timetableWeek(term,date);return week!==undefined&&isScheduled(meeting)&&meeting.weekday===shanghaiWeekday(date)&&meeting.weeks.includes(week);
}
export function isTimetableCancelled(term:TimetableTerm,meetingID:string,date:SwiftDate):boolean {
 return (term.cancellations??[]).some(c=>c.meetingID===meetingID&&sameShanghaiDay(c.date,date));
}
export function timetableOccurrences(term:TimetableTerm,value:SwiftDate):TimetableOccurrence[] {
 if(timetableWeek(term,value)===undefined)return [];
 const date=shanghaiDay(value);const moves=term.reschedules??[];
 const regular=term.meetings.filter(m=>isActualOccurrence(m,term,date)&&!isTimetableCancelled(term,m.id,date)&&!moves.some(r=>r.meetingID===m.id&&sameShanghaiDay(r.originalDate,date)))
  .map(meeting=>({id:`${meeting.id}-${date}`,meeting,date,originalDate:date}));
 const moved=moves.filter(r=>sameShanghaiDay(r.date,date)&&!isTimetableCancelled(term,r.meetingID,r.originalDate))
  .map(r=>({id:`${r.meeting.id}-${shanghaiDay(r.originalDate)}`,meeting:r.meeting,date,originalDate:shanghaiDay(r.originalDate),rescheduleID:r.id}));
 return [...regular,...moved].sort((a,b)=>a.meeting.startSection-b.meeting.startSection||endSection(a.meeting)-endSection(b.meeting)||a.meeting.title.localeCompare(b.meeting.title,'zh',{numeric:true})||a.id.localeCompare(b.id));
}
