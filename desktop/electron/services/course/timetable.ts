import { randomUUID } from 'node:crypto';
import { assertID, dateMs, requiredText, textValue } from '../../../shared/model.ts';
import type { LibraryState, SwiftDate } from '../../../shared/model.ts';
import {
  endSection,
  isScheduled,
  isActualOccurrence,
  sameShanghaiDay,
  shanghaiDay,
  shanghaiWeekday,
  timetableWeek,
  meetingTimeRange,
  isTimetableCancelled,
} from '../../../shared/timetable.ts';
import type {
  TimetableTerm,
  TimetableMeeting,
  TimetableReschedule,
  TimetableCancellation,
  TimetableImportSummary,
  TimetableRescheduleInput,
} from '../../../shared/timetable.ts';

const newID = () => randomUUID().toUpperCase();
const palette = [
  '#39786B',
  '#287D8E',
  '#3B72B8',
  '#5555A5',
  '#8058A1',
  '#AE567C',
  '#B2534D',
  '#AC633C',
  '#967326',
  '#6C7E3D',
  '#826452',
  '#596574',
];
const integer = (value: unknown, min: number, max: number, label: string): number => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max)
    throw new Error(label);
  return value;
};
function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(label);
  return value as Record<string, unknown>;
}
function list(value: unknown, label: string, limit = 50000): unknown[] {
  if (!Array.isArray(value) || value.length > limit) throw new Error(label);
  return value;
}
function optionalString(value: unknown): string {
  return value == null ? '' : textValue(value, 10000).trim();
}
function date(value: unknown): SwiftDate {
  if (typeof value !== 'number' && typeof value !== 'string') throw new Error('课表日期无效');
  dateMs(value);
  shanghaiDay(value);
  return value;
}
function canonicalID(value: unknown): string {
  assertID(value);
  return value.toUpperCase();
}

/** Accept missing arrays from old Codable versions, never accept null arrays. */
export function readTimetableTerms(state: LibraryState): TimetableTerm[] {
  return state.timetableTerms.map((value) => {
    const term = structuredClone(object(value, '课表学期无效')) as unknown as TimetableTerm;
    if (term.cancellations === undefined) term.cancellations = [];
    if (term.reschedules === undefined) term.reschedules = [];
    list(term.meetings, '上课时段无效');
    list(term.sectionTimes, '节次表无效', 30);
    list(term.cancellations, '停课记录无效');
    list(term.reschedules, '调课记录无效');
    return term;
  });
}
function validateMeeting(meeting: TimetableMeeting, weekCount: number, courseIDs?: Set<string>) {
  object(meeting, '课程时段无效');
  canonicalID(meeting.id);
  requiredText(meeting.title, 10000);
  for (const key of ['courseCode', 'teacher', 'classroom', 'note'] as const)
    textValue(meeting[key], 100000);
  if (meeting.courseID != null) {
    canonicalID(meeting.courseID);
    if (courseIDs && !courseIDs.has(meeting.courseID)) throw new Error('课表关联的课程不存在');
  }
  if (meeting.colorHex != null && !/^#[0-9a-f]{6}$/i.test(meeting.colorHex))
    throw new Error('课程时段颜色无效');
  if (meeting.showInMonth != null && typeof meeting.showInMonth !== 'boolean')
    throw new Error('课程显示设置无效');
  if (meeting.startMinuteOverride != null || meeting.endMinuteOverride != null) {
    integer(meeting.startMinuteOverride, 0, 1439, '课程开始时间无效');
    integer(meeting.endMinuteOverride, 1, 1440, '课程结束时间无效');
    if (meeting.endMinuteOverride! <= meeting.startMinuteOverride!)
      throw new Error('课程结束时间必须晚于开始时间');
  }
  const weeks = list(meeting.weeks, '课程周次无效', 60) as number[];
  if (
    new Set(weeks).size !== weeks.length ||
    weeks.some((w) => !Number.isInteger(w) || w < 1 || w > weekCount)
  )
    throw new Error('课程周次应在学期周数范围内');
  const free = meeting.weekday == null || meeting.weekday === 0;
  if (free) {
    if (meeting.startSection !== 0 || meeting.sectionCount !== 0)
      throw new Error('自由时间课程不能包含固定节次');
  } else {
    integer(meeting.weekday, 1, 7, '课程星期无效');
    integer(meeting.startSection, 1, 30, '课程起始节次无效');
    integer(meeting.sectionCount, 1, 30, '课程节数无效');
    if (endSection(meeting) > 30 || weeks.length === 0) throw new Error('课程节次或周次无效');
  }
}
function occurrenceKey(meetingID: string, value: SwiftDate) {
  return `${meetingID}:${shanghaiDay(value)}`;
}
function validateReschedule(
  move: TimetableReschedule,
  term: TimetableTerm,
  courseIDs: Set<string>,
  active: boolean,
) {
  object(move, '调课记录无效');
  canonicalID(move.id);
  canonicalID(move.meetingID);
  date(move.date);
  date(move.originalDate);
  validateMeeting(move.meeting, 60, courseIDs);
  if (
    move.meetingID !== move.meeting.id ||
    !isScheduled(move.meeting) ||
    dateMs(move.date) !== dateMs(shanghaiDay(move.date)) ||
    dateMs(move.originalDate) !== dateMs(shanghaiDay(move.originalDate)) ||
    move.meeting.weekday !== shanghaiWeekday(move.date)
  )
    throw new Error('调课日期需按北京时间整日保存，星期应与目标日期一致');
  if (active && term.weekOneMonday != null && timetableWeek(term, move.date) === undefined)
    throw new Error('调课目标日期应在所选学期内');
}
export function validateTimetables(state: LibraryState): void {
  const terms = readTimetableTerms(state);
  const courseIDs = new Set(state.courses.map((c) => c.id));
  const termIDs = new Set<string>(),
    names = new Set<string>(),
    meetingIDs = new Set<string>(),
    cancelIDs = new Set<string>(),
    moveIDs = new Set<string>();
  for (const term of terms) {
    canonicalID(term.id);
    if (termIDs.has(term.id) || names.has(term.name))
      throw new Error('课表包含重复的学期编号或名称');
    termIDs.add(term.id);
    names.add(term.name);
    if (requiredText(term.name, 10000) !== term.name) throw new Error('学期名称不能包含首尾空格');
    integer(term.weekCount, 1, 60, '学期周数应为1–60周');
    if (term.weekOneMonday != null) {
      date(term.weekOneMonday);
      if (shanghaiWeekday(term.weekOneMonday) !== 1)
        throw new Error('第一周起始日必须是北京时间周一');
    }
    if (term.endDate != null) {
      date(term.endDate);
      if (term.weekOneMonday != null) {
        const days = Math.round(
          (Date.parse(shanghaiDateString(term.endDate)) -
            Date.parse(shanghaiDateString(term.weekOneMonday))) /
            86400000,
        );
        if (days < (term.weekCount - 1) * 7 || days >= term.weekCount * 7)
          throw new Error('学期结束日期必须位于最后一周');
      }
    }
    let previousSection = 0,
      previousEnd = 0;
    for (const slot of term.sectionTimes) {
      object(slot, '节次时间无效');
      integer(slot.section, 1, 30, '节次应为1–30');
      integer(slot.startMinute, 0, 1439, '开始时间无效');
      integer(slot.endMinute, 1, 1440, '结束时间无效');
      if (
        slot.section <= previousSection ||
        slot.startMinute < previousEnd ||
        slot.endMinute <= slot.startMinute
      )
        throw new Error('节次必须排序且作息时间不能重叠');
      previousSection = slot.section;
      previousEnd = slot.endMinute;
    }
    for (const m of term.meetings) {
      validateMeeting(m, term.weekCount, courseIDs);
      if (meetingIDs.has(m.id)) throw new Error('上课时段编号重复');
      meetingIDs.add(m.id);
    }
    const cancelled = new Set<string>(),
      moved = new Set<string>();
    for (const c of term.cancellations) {
      object(c, '停课记录无效');
      canonicalID(c.id);
      canonicalID(c.meetingID);
      date(c.date);
      requiredText(c.title, 10000);
      textValue(c.reason, 100000);
      if (cancelIDs.has(c.id)) throw new Error('停课编号重复');
      cancelIDs.add(c.id);
      const key = occurrenceKey(c.meetingID, c.date);
      if (cancelled.has(key)) throw new Error('同一课次重复停课');
      cancelled.add(key);
      if (c.savedReschedule) {
        const saved = c.savedReschedule;
        if (saved.meetingID !== c.meetingID || !sameShanghaiDay(saved.originalDate, c.date))
          throw new Error('停课调课快照不匹配');
        validateReschedule(saved, term, courseIDs, false);
        if (moveIDs.has(saved.id)) throw new Error('调课编号重复');
        moveIDs.add(saved.id);
      }
    }
    for (const move of term.reschedules) {
      validateReschedule(move, term, courseIDs, true);
      if (moveIDs.has(move.id)) throw new Error('调课编号重复');
      moveIDs.add(move.id);
      const key = occurrenceKey(move.meetingID, move.originalDate);
      if (moved.has(key) || cancelled.has(key)) throw new Error('同一课次不能重复调课或同时停课');
      moved.add(key);
    }
  }
}
function shanghaiDateString(value: SwiftDate): string {
  // Comparing civil dates avoids 23/25-hour days in historical timezone data.
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const p = Object.fromEntries(
    formatter
      .formatToParts(new Date(dateMs(value)))
      .filter((v) => v.type !== 'literal')
      .map((v) => [v.type, v.value]),
  );
  return `${p.year}-${p.month}-${p.day}`;
}
function courseKey(code: string, title: string, teacher: string) {
  return JSON.stringify([code, code ? '' : title, code ? '' : teacher]);
}
function sessionKey(m: TimetableMeeting) {
  return JSON.stringify([
    m.courseCode,
    m.title,
    m.teacher,
    m.classroom,
    m.weeks,
    m.weekday ?? null,
    m.startSection,
    m.sectionCount,
    m.note,
  ]);
}
function sameSlot(a: TimetableMeeting, b: TimetableMeeting) {
  return (
    isScheduled(a) &&
    isScheduled(b) &&
    a.weekday === b.weekday &&
    a.startSection === b.startSection &&
    a.sectionCount === b.sectionCount &&
    ((!!a.courseID && a.courseID === b.courseID) ||
      (!!a.courseCode && a.courseCode === b.courseCode))
  );
}
function remappedID(id: string, old: TimetableMeeting[], fresh: TimetableMeeting[]): string {
  if (fresh.some((m) => m.id === id)) return id;
  const previous = old.find((m) => m.id === id);
  if (!previous) return id;
  const candidates = fresh.filter((m) => sameSlot(previous, m));
  return candidates.length === 1 && old.filter((m) => sameSlot(m, candidates[0])).length === 1
    ? candidates[0].id
    : id;
}
function remapMove(
  move: TimetableReschedule,
  old: TimetableMeeting[],
  fresh: TimetableMeeting[],
): TimetableReschedule {
  const result = structuredClone(move);
  result.meetingID = remappedID(move.meetingID, old, fresh);
  result.meeting.id = result.meetingID;
  return result;
}

/** Mutates only the caller's transaction copy; no filesystem or UI side effects. */
export function importUndergraduateTimetable(
  state: LibraryState,
  input: unknown,
): TimetableImportSummary {
  const schedule = object(input, '本科课表必须是JSON对象');
  const name = requiredText(schedule.name, 10000);
  const courses = list(schedule.courses, '本科课表课程无效', 10000);
  if (courses.length === 0) throw new Error('课表中没有可导入的本科课程');
  if (schedule.warnings !== undefined)
    for (const warning of list(schedule.warnings, '课表提示无效', 1000)) textValue(warning, 10000);
  const terms = readTimetableTerms(state);
  const existing = terms.find((t) => t.name === name);
  const term: TimetableTerm = existing ?? {
    id: newID(),
    name,
    weekCount: 20,
    sectionTimes: [],
    meetings: [],
    cancellations: [],
    reschedules: [],
  };
  const oldCourses = new Map<string, string>(),
    oldSessions = new Map<string, TimetableMeeting>(),
    importedCourses = new Map<string, string>(),
    sessions = new Set<string>();
  for (const m of term.meetings) {
    if (m.courseID && state.courses.some((c) => c.id === m.courseID))
      oldCourses.set(courseKey(m.courseCode, m.title, m.teacher), m.courseID);
    oldSessions.set(sessionKey(m), m);
  }
  let created = 0;
  const meetings: TimetableMeeting[] = [];
  for (const value of courses) {
    const row = object(value, '本科课程记录无效');
    const title = requiredText(row.name, 10000),
      teacher = optionalString(row.teacher),
      code = optionalString(row.class_number),
      classroom = optionalString(row.classroom);
    const start = integer(row.start_time, 0, 30, '课程起始节次无效'),
      offset = integer(row.time_count, 0, 29, '课程节次偏移无效');
    if (start === 0 && offset !== 0) throw new Error('自由时间课程不能包含节次偏移');
    const weekday =
      row.week_time == null ? undefined : integer(row.week_time, 0, 7, '课程星期无效');
    const weeks = [
      ...new Set(
        list(row.weeks, '课程周次无效', 10000).map((w) => integer(w, 1, 60, '上课周次应在1–60周')),
      ),
    ].sort((a, b) => a - b);
    const notes = [optionalString(row.info)];
    const exam = optionalString(row.test_time),
      location = optionalString(row.test_location);
    if (exam) notes.push('考试时间：' + exam);
    if (location) notes.push('考试地点：' + location);
    let meeting: TimetableMeeting = {
      id: newID(),
      courseCode: code,
      title,
      teacher,
      classroom,
      weeks,
      startSection: start,
      sectionCount: start > 0 ? offset + 1 : 0,
      note: notes.filter(Boolean).join('\n'),
    };
    if (weekday) meeting.weekday = weekday;
    validateMeeting(meeting, 60);
    const key = courseKey(code, title, teacher);
    let courseID = importedCourses.get(key) ?? oldCourses.get(key);
    if (!courseID)
      courseID = state.courses.find(
        (c) => c.semester === name && c.name === title && c.teacher === teacher,
      )?.id;
    if (!courseID) {
      courseID = newID();
      state.courses.push({
        id: courseID,
        name: title,
        semester: name,
        teacher,
        colorHex: palette[state.courses.length % palette.length],
        isArchived: false,
      });
      created++;
    }
    meeting.courseID = courseID;
    importedCourses.set(key, courseID);
    const session = sessionKey(meeting);
    if (sessions.has(session)) continue;
    sessions.add(session);
    const old = oldSessions.get(session);
    if (old) {
      meeting = { ...old, ...meeting, id: old.id };
      delete meeting.startMinuteOverride;
      delete meeting.endMinuteOverride;
    } else {
      const slots = term.meetings.filter(
        (m) =>
          m.courseID === courseID &&
          m.weekday === meeting.weekday &&
          m.startSection === meeting.startSection &&
          m.sectionCount === meeting.sectionCount,
      );
      if (slots.length === 1 && slots[0].showInMonth !== undefined)
        meeting.showInMonth = slots[0].showInMonth;
    }
    meetings.push(meeting);
  }
  term.cancellations = term.cancellations.map((c) => ({
    ...c,
    meetingID: remappedID(c.meetingID, term.meetings, meetings),
    ...(c.savedReschedule
      ? { savedReschedule: remapMove(c.savedReschedule, term.meetings, meetings) }
      : {}),
  }));
  term.reschedules = term.reschedules.map((r) => remapMove(r, term.meetings, meetings));
  term.meetings = meetings;
  const importedWeeks = Math.max(1, ...meetings.flatMap((m) => m.weeks));
  if (term.endDate != null && importedWeeks > term.weekCount)
    throw new Error('导入周次超过已设置的学期结束范围');
  if (term.endDate == null) term.weekCount = Math.max(term.weekCount, importedWeeks);
  if (!existing) terms.push(term);
  state.timetableTerms = terms;
  validateTimetables(state);
  return { termID: term.id, coursesCreated: created, meetingsImported: meetings.length };
}
function selectedTerm(state: LibraryState, id: string) {
  const terms = readTimetableTerms(state);
  const term = terms.find((t) => t.id === canonicalID(id));
  if (!term) throw new Error('学期课表不存在');
  return { terms, term };
}
export function updateTimetableSettings(state: LibraryState, termID: string, input: unknown): void {
  const settings = object(input, '学期设置无效');
  const allowed = new Set(['name', 'weekOneMonday', 'weekCount', 'endDate', 'sectionTimes']);
  if (Object.keys(settings).some((k) => !allowed.has(k))) throw new Error('包含不支持的学期设置');
  const { terms, term } = selectedTerm(state, termID);
  if (settings.name !== undefined) term.name = requiredText(settings.name, 10000);
  if (settings.weekCount !== undefined)
    term.weekCount = integer(settings.weekCount, 1, 60, '学期周数应为1–60周');
  for (const key of ['weekOneMonday', 'endDate'] as const)
    if (key in settings) {
      if (settings[key] == null) delete term[key];
      else term[key] = shanghaiDay(date(settings[key]));
    }
  if (settings.sectionTimes !== undefined)
    term.sectionTimes = structuredClone(
      list(settings.sectionTimes, '节次时间表无效', 30),
    ) as TimetableTerm['sectionTimes'];
  for (const move of term.reschedules) {
    move.date = shanghaiDay(move.date);
    move.originalDate = shanghaiDay(move.originalDate);
  }
  for (const cancellation of term.cancellations) {
    cancellation.date = shanghaiDay(cancellation.date);
    if (cancellation.savedReschedule) {
      cancellation.savedReschedule.date = shanghaiDay(cancellation.savedReschedule.date);
      cancellation.savedReschedule.originalDate = shanghaiDay(
        cancellation.savedReschedule.originalDate,
      );
    }
  }
  state.timetableTerms = terms;
  validateTimetables(state);
}
export function cancelTimetableOccurrence(
  state: LibraryState,
  termID: string,
  meetingID: string,
  value: SwiftDate,
  reason = '',
): boolean {
  const day = shanghaiDay(date(value)),
    id = canonicalID(meetingID);
  const { terms, term } = selectedTerm(state, termID);
  if (term.cancellations.some((c) => c.meetingID === id && sameShanghaiDay(c.date, day)))
    return false;
  const move = term.reschedules.find(
    (r) => r.meetingID === id && sameShanghaiDay(r.originalDate, day),
  );
  const meeting = move?.meeting ?? term.meetings.find((m) => m.id === id);
  if (!meeting) throw new Error('上课时段不存在');
  if (!move && !isActualOccurrence(meeting, term, day)) throw new Error('所选日期没有这次固定课程');
  const cancellation: TimetableCancellation = {
    id: newID(),
    meetingID: id,
    date: day,
    title: meeting.title,
    reason: textValue(reason, 10000).trim(),
  };
  if (move) {
    cancellation.savedReschedule = move;
    term.reschedules = term.reschedules.filter((r) => r.id !== move.id);
  }
  term.cancellations.push(cancellation);
  state.timetableTerms = terms;
  validateTimetables(state);
  return true;
}
export function restoreTimetableOccurrence(
  state: LibraryState,
  termID: string,
  cancellationID: string,
): boolean {
  const { terms, term } = selectedTerm(state, termID);
  const cancellation = term.cancellations.find((c) => c.id === canonicalID(cancellationID));
  if (!cancellation) return false;
  if (cancellation.savedReschedule) term.reschedules.push(cancellation.savedReschedule);
  term.cancellations = term.cancellations.filter((c) => c.id !== cancellation.id);
  state.timetableTerms = terms;
  validateTimetables(state);
  return true;
}

/** Matches LibraryRepository.rescheduleTimetableClass, including its source anchor. */
export function rescheduleTimetableOccurrence(
  state: LibraryState,
  termID: string,
  meetingID: string,
  originalDate: SwiftDate,
  input: TimetableRescheduleInput,
): boolean {
  const origin = shanghaiDay(date(originalDate)),
    target = shanghaiDay(date(input.date)),
    id = canonicalID(meetingID);
  const { terms, term } = selectedTerm(state, termID);
  const existing = term.reschedules.find(
    (r) => r.meetingID === id && sameShanghaiDay(r.originalDate, origin),
  );
  const master = term.meetings.find((m) => m.id === id),
    source = existing?.meeting ?? master;
  if (!source) throw new Error('上课时段不存在');
  if (
    isTimetableCancelled(term, id, origin) ||
    (!existing && !isActualOccurrence(source, term, origin))
  )
    throw new Error('原课次不存在或已停课，请先恢复停课后再调整');
  const week = timetableWeek(term, target);
  if (week === undefined) throw new Error('调课目标日期应在所选学期内');
  const start = integer(input.startSection, 1, 30, '调课节次需在第1–30节内'),
    count = integer(input.sectionCount, 1, 30, '调课节次需在第1–30节内');
  if (start + count > 31) throw new Error('调课节次需在第1–30节内');
  const room = textValue(input.classroom, 10000).trim();
  if (input.startMinute !== undefined || input.endMinute !== undefined) {
    integer(input.startMinute, 0, 1439, '课程开始时间无效');
    integer(input.endMinute, 1, 1440, '课程结束时间无效');
    if (input.endMinute! <= input.startMinute!) throw new Error('课程结束时间必须晚于开始时间');
  }
  const masterTime = master ? meetingTimeRange(master, term.sectionTimes) : undefined;
  if (
    master &&
    isActualOccurrence(master, term, origin) &&
    origin === target &&
    master.startSection === start &&
    master.sectionCount === count &&
    master.classroom === room &&
    ((input.startMinute === undefined && input.endMinute === undefined) ||
      (masterTime?.start === input.startMinute && masterTime?.end === input.endMinute))
  ) {
    if (!existing) return false;
    term.reschedules = term.reschedules.filter((r) => r.id !== existing.id);
  } else {
    const meeting: TimetableMeeting = {
      ...source,
      id,
      weekday: shanghaiWeekday(target),
      weeks: [week],
      startSection: start,
      sectionCount: count,
      classroom: room,
    };
    if (input.startMinute === undefined) {
      delete meeting.startMinuteOverride;
      delete meeting.endMinuteOverride;
    } else {
      meeting.startMinuteOverride = input.startMinute;
      meeting.endMinuteOverride = input.endMinute;
    }
    const move: TimetableReschedule = {
      id: existing?.id ?? newID(),
      meetingID: id,
      originalDate: origin,
      date: target,
      meeting,
    };
    if (existing && JSON.stringify(existing) === JSON.stringify(move)) return false;
    if (existing) term.reschedules[term.reschedules.indexOf(existing)] = move;
    else term.reschedules.push(move);
  }
  state.timetableTerms = terms;
  validateTimetables(state);
  return true;
}
export function restoreTimetableReschedule(
  state: LibraryState,
  termID: string,
  rescheduleID: string,
): boolean {
  const { terms, term } = selectedTerm(state, termID),
    id = canonicalID(rescheduleID);
  if (!term.reschedules.some((r) => r.id === id)) return false;
  term.reschedules = term.reschedules.filter((r) => r.id !== id);
  state.timetableTerms = terms;
  validateTimetables(state);
  return true;
}
export function setTimetableMonthVisible(
  state: LibraryState,
  termID: string,
  meetingID: string,
  visible: boolean,
): void {
  if (typeof visible !== 'boolean') throw new Error('月历显示设置无效');
  const { terms, term } = selectedTerm(state, termID),
    id = canonicalID(meetingID);
  let found = false;
  for (const m of term.meetings)
    if (m.id === id) {
      m.showInMonth = visible;
      found = true;
    }
  for (const r of term.reschedules)
    if (r.meetingID === id) {
      r.meeting.showInMonth = visible;
      found = true;
    }
  for (const c of term.cancellations)
    if (c.meetingID === id && c.savedReschedule) {
      c.savedReschedule.meeting.showInMonth = visible;
      found = true;
    }
  if (!found) throw new Error('上课时段不存在');
  state.timetableTerms = terms;
  validateTimetables(state);
}
