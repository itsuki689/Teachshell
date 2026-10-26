import { dateMs } from './model.ts';
import type { Course, LibraryState, StudyTask } from './model.ts';
import { planEvents, planSnapshot, readPlan } from './plans.ts';
import type { PlanOccurrence } from './plans.ts';
import { meetingTimeRange, shanghaiDay, timetableOccurrences } from './timetable.ts';
import type { TimetableOccurrence, TimetableTerm } from './timetable.ts';
export type ScheduleMode = 'month' | 'week' | 'agenda';
export type ScheduleFilter = 'active' | 'unscheduled' | 'pending' | 'completed' | 'cancelled';
export interface ScheduleSelection {
  termID: string;
  courseID: string;
  filter: ScheduleFilter;
  showsFixed: boolean;
  showsActivities: boolean;
  query: string;
}
export interface ScheduleEvent {
  id: string;
  title: string;
  date: number;
  endDate?: number;
  color: string;
  allDay: boolean;
  deadline: boolean;
  completed: boolean;
  fixed: boolean;
  time: string;
  location: string;
  section: 'allDay' | 'deadlines' | 'timed';
  plan?: PlanOccurrence;
  meeting?: TimetableOccurrence;
  term?: TimetableTerm;
}
export function validScheduleDay(day: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const date = new Date(day + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === day;
}
export function shiftScheduleDay(day: string, mode: ScheduleMode, offset: number): string {
  if (!validScheduleDay(day) || !Number.isInteger(offset)) return day;
  const date = new Date(day + 'T00:00:00Z');
  if (mode === 'month') {
    const number = date.getUTCDate();
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + offset);
    const end = new Date(date);
    end.setUTCMonth(end.getUTCMonth() + 1);
    end.setUTCDate(0);
    date.setUTCDate(Math.min(number, end.getUTCDate()));
  } else date.setUTCDate(date.getUTCDate() + offset * (mode === 'week' ? 7 : 1));
  const result = Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : '';
  return validScheduleDay(result) ? result : day;
}
export function scheduleWeekDays(day: string): string[] {
  if (!validScheduleDay(day)) return [];
  const weekday = (new Date(day + 'T00:00:00Z').getUTCDay() + 6) % 7;
  return Array.from({ length: 7 }, (_, i) => shiftScheduleDay(day, 'agenda', i - weekday));
}
export function scheduleMonthDays(day: string): string[] {
  if (!validScheduleDay(day)) return [];
  const first = scheduleWeekDays(day.slice(0, 7) + '-01')[0];
  return Array.from({ length: 42 }, (_, i) => shiftScheduleDay(first, 'agenda', i));
}
export function scheduleCourses(state: LibraryState, termID: string): Course[] {
  const term = (state.timetableTerms as unknown as TimetableTerm[]).find((t) => t.id === termID);
  const linked = new Set(
    [...(term?.meetings ?? []), ...(term?.reschedules.map((r) => r.meeting) ?? [])].map(
      (m) => m.courseID,
    ),
  );
  return state.courses.filter((c) => !term || c.semester === term.name || linked.has(c.id));
}
function matches(task: StudyTask, state: LibraryState, selection: ScheduleSelection): boolean {
  if (task.archivedAt != null || (selection.courseID && task.courseID !== selection.courseID))
    return false;
  if (
    selection.termID &&
    task.courseID &&
    !scheduleCourses(state, selection.termID).some((c) => c.id === task.courseID)
  )
    return false;
  const text = [
    task.title,
    task.content,
    task.kind,
    task.location,
    state.courses.find((c) => c.id === task.courseID)?.name,
  ]
    .join(' ')
    .toLocaleLowerCase();
  if (
    !selection.query
      .toLocaleLowerCase()
      .split(/\s+/)
      .filter(Boolean)
      .every((word) => text.includes(word))
  )
    return false;
  switch (selection.filter) {
    case 'pending':
      return (
        task.completionRequired !== false && task.completedAt == null && task.cancelledAt == null
      );
    case 'completed':
      return task.completedAt != null;
    case 'cancelled':
      return task.cancelledAt != null;
    case 'unscheduled':
      return !readPlan(task).hasExecutionTime && task.cancelledAt == null;
    default:
      return true;
  }
}
export function scheduleLoosePlans(state: LibraryState, selection: ScheduleSelection): StudyTask[] {
  return state.tasks.filter((input) => {
    const task = readPlan(input);
    if (!(task.origin === 'fixed' ? selection.showsFixed : selection.showsActivities)) return false;
    const variants = [task, ...task.exceptions.map((e) => planSnapshot(task, e.originalDate))];
    return variants.some(
      (v) =>
        matches(v, state, selection) &&
        (selection.filter !== 'active' ||
          (!v.hasExecutionTime && v.deadline == null && v.cancelledAt == null)),
    );
  });
}
export function scheduleEvents(
  day: string,
  state: LibraryState,
  selection: ScheduleSelection,
  forMonth = false,
): ScheduleEvent[] {
  if (!validScheduleDay(day)) return [];
  const color = (value: unknown, courseID?: string) =>
    typeof value === 'string'
      ? value
      : (state.courses.find((c) => c.id === courseID)?.colorHex ?? state.accentColor);
  const instant = day + 'T00:00:00+08:00';
  const clock = (minutes: number) =>
    String(Math.floor(minutes / 60)).padStart(2, '0') + ':' + String(minutes % 60).padStart(2, '0');
  const time = (date: number) =>
    clock(Math.round((dateMs(date) - dateMs(shanghaiDay(instant))) / 60000));
  const result: ScheduleEvent[] = planEvents(instant, state.tasks)
    .filter(
      (e) =>
        matches(e.task, state, selection) &&
        (e.isFixed ? selection.showsFixed : selection.showsActivities) &&
        (!forMonth || e.isDeadline || e.task.showInMonth),
    )
    .map((plan) => ({
      id: 'plan-' + plan.id,
      title: plan.task.title,
      date: plan.date,
      endDate: plan.endDate,
      color: color(plan.task.colorHex, plan.task.courseID),
      allDay: plan.isAllDay,
      deadline: plan.isDeadline,
      completed: plan.task.completedAt != null,
      fixed: plan.isFixed,
      location: plan.task.location,
      plan,
      section: plan.isDeadline ? 'deadlines' : plan.isAllDay ? 'allDay' : 'timed',
      time: plan.isDeadline
        ? plan.isAllDay
          ? '当日截止'
          : time(plan.date) + ' 截止'
        : plan.isAllDay
          ? '全天'
          : time(plan.date) + (plan.endDate == null ? '' : ' – ' + time(plan.endDate)),
    }));
  if (selection.showsFixed && selection.filter === 'active')
    for (const term of state.timetableTerms as unknown as TimetableTerm[]) {
      if (selection.termID && selection.termID !== term.id) continue;
      for (const meeting of timetableOccurrences(term, instant)) {
        const master = term.meetings.find((m) => m.id === meeting.meeting.id);
        if (forMonth && !(master?.showInMonth ?? meeting.meeting.showInMonth)) continue;
        if (selection.courseID && meeting.meeting.courseID !== selection.courseID) continue;
        const text = [meeting.meeting.title, meeting.meeting.teacher, meeting.meeting.classroom]
          .join(' ')
          .toLocaleLowerCase();
        if (
          !selection.query
            .toLocaleLowerCase()
            .split(/\s+/)
            .filter(Boolean)
            .every((word) => text.includes(word))
        )
          continue;
        const range = meetingTimeRange(meeting.meeting, term.sectionTimes);
        result.push({
          id: 'course-' + term.id + '-' + meeting.id,
          title: meeting.meeting.title,
          date: meeting.date + (range?.start ?? 0) * 60,
          endDate: range ? meeting.date + range.end * 60 : undefined,
          color: color(meeting.meeting.colorHex, meeting.meeting.courseID),
          allDay: false,
          deadline: false,
          completed: false,
          fixed: true,
          section: 'timed',
          location: meeting.meeting.classroom,
          meeting,
          term,
          time: range
            ? clock(range.start) + ' – ' + clock(range.end)
            : `第 ${meeting.meeting.startSection}–${meeting.meeting.startSection + meeting.meeting.sectionCount - 1} 节`,
        });
      }
    }
  return result.sort(
    (a, b) => Number(b.allDay) - Number(a.allDay) || a.date - b.date || a.id.localeCompare(b.id),
  );
}
