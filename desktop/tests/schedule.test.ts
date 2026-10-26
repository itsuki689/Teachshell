import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { decodeLibrary, emptyLibrary } from '../shared/model.ts';
import { shanghaiDayKey } from '../shared/timetable.ts';
import type { TimetableTerm } from '../shared/timetable.ts';
import type { StudyTask } from '../shared/model.ts';
import { readPlan, swiftSeconds } from '../shared/plans.ts';
import {
  scheduleEvents,
  scheduleCourses,
  scheduleLoosePlans,
  scheduleMonthDays,
  scheduleWeekDays,
  shiftScheduleDay,
  validScheduleDay,
} from '../shared/schedule.ts';
import type { ScheduleSelection } from '../shared/schedule.ts';
const selected: ScheduleSelection = {
  termID: '',
  courseID: '',
  filter: 'active',
  showsFixed: true,
  showsActivities: true,
  query: '',
};
const task = (overrides: Partial<StudyTask> = {}) =>
  readPlan({
    id: 'plan',
    title: '学习安排',
    startsAt: '2026-10-26T09:00:00+08:00',
    endsAt: '2026-10-26T10:00:00+08:00',
    content: '',
    kind: '任务',
    materialIDs: [],
    isAllDay: false,
    showOnCalendar: true,
    hasExecutionTime: true,
    origin: 'activity',
    showInMonth: false,
    ...overrides,
  });
test('civil navigation validates dates, preserves month-end intent and spans academic boundaries', () => {
  assert.equal(validScheduleDay('2026-02-30'), false);
  assert.equal(validScheduleDay('2024-02-29'), true);
  assert.equal(shiftScheduleDay('2024-01-31', 'month', 1), '2024-02-29');
  assert.equal(shiftScheduleDay('2026-01-31', 'month', 1), '2026-02-28');
  assert.equal(shiftScheduleDay('2026-12-31', 'agenda', 1), '2027-01-01');
  assert.equal(shiftScheduleDay('2026-10-26', 'week', 1), '2026-11-02');
  assert.equal(shiftScheduleDay('invalid', 'month', 1), 'invalid');
});
test('month and week use the same Monday-based civil dates across year boundaries', () => {
  assert.deepEqual(scheduleWeekDays('2027-01-01'), [
    '2026-12-28',
    '2026-12-29',
    '2026-12-30',
    '2026-12-31',
    '2027-01-01',
    '2027-01-02',
    '2027-01-03',
  ]);
  const month = scheduleMonthDays('2027-01-31');
  assert.equal(month.length, 42);
  assert.equal(month[0], '2026-12-28');
  assert.equal(month.at(-1), '2027-02-07');
});
test('monthly opt-in never hides deadlines from their fixed section or daily execution', () => {
  const state = emptyLibrary();
  state.tasks = [task({ deadline: '2026-10-26T18:00:00+08:00' })];
  assert.equal(scheduleEvents('2026-10-26', state, selected).length, 2);
  const month = scheduleEvents('2026-10-26', state, selected, true);
  assert.equal(month.length, 1);
  assert.equal(month[0].section, 'deadlines');
  assert.equal(
    scheduleEvents('2026-10-26', state, { ...selected, showsFixed: false })[0].deadline,
    false,
  );
  assert.equal(
    scheduleEvents('2026-10-26', state, { ...selected, showsActivities: false })[0].deadline,
    true,
  );
});
test('cross-midnight execution is clipped independently and preserves original record dates', () => {
  const state = emptyLibrary();
  state.tasks = [
    task({ startsAt: '2026-10-25T23:00:00+08:00', endsAt: '2026-10-26T01:00:00+08:00' }),
  ];
  const previous = scheduleEvents('2026-10-25', state, selected)[0],
    next = scheduleEvents('2026-10-26', state, selected)[0];
  assert.equal(previous.time, '23:00 – 24:00');
  assert.equal(next.time, '00:00 – 01:00');
  assert.equal(next.plan?.originalDate, swiftSeconds(state.tasks[0].startsAt));
  assert.equal(state.tasks[0].endsAt, '2026-10-26T01:00:00+08:00');
});
test('completed occurrence filtering uses effective exceptions and unscheduled items stay out of dates', () => {
  const state = emptyLibrary();
  const plan = task({ repeatRule: { frequency: 'weekly', interval: 1 } });
  plan.exceptions = [{ originalDate: plan.startsAt, completedAt: '2026-10-26T11:00:00+08:00' }];
  state.tasks = [
    plan,
    task({ id: 'loose', hasExecutionTime: false, endsAt: undefined, title: '待安排的计划' }),
  ];
  assert.equal(scheduleEvents('2026-10-26', state, { ...selected, filter: 'completed' }).length, 1);
  assert.equal(scheduleEvents('2026-11-02', state, { ...selected, filter: 'completed' }).length, 0);
  assert.deepEqual(
    scheduleLoosePlans(state, selected).map((t) => t.id),
    ['loose'],
  );
  assert.equal(
    scheduleEvents('2026-10-26', state, selected).some((e) => e.title === '待安排的计划'),
    false,
  );
});
test('course and multi-word filters apply consistently to every calendar projection', () => {
  const state = emptyLibrary();
  state.courses = [
    {
      id: 'course',
      name: '数学课程',
      semester: '秋季',
      teacher: '',
      colorHex: '#39786B',
      isArchived: false,
    },
  ];
  state.tasks = [
    task({ courseID: 'course', title: '复习', location: '教学楼', showInMonth: true }),
  ];
  for (const month of [false, true]) {
    assert.equal(
      scheduleEvents(
        '2026-10-26',
        state,
        { ...selected, courseID: 'course', query: '数学 复习' },
        month,
      ).length,
      1,
    );
    assert.equal(
      scheduleEvents('2026-10-26', state, { ...selected, courseID: 'missing' }, month).length,
      0,
    );
  }
});
test('Swift schema 9 courses, cancellations and reschedules project consistently across calendar views', async () => {
  const state = decodeLibrary(
    JSON.parse(
      await fs.readFile(new URL('./fixtures/swift-schema9.json', import.meta.url), 'utf8'),
    ),
  );
  const term = state.timetableTerms[0] as unknown as TimetableTerm;
  const selection = { ...selected, termID: term.id };
  assert.equal(scheduleCourses(state, term.id)[0].id, term.meetings[0].courseID);
  const cancelled = shanghaiDayKey(term.cancellations[0].date);
  const moved = term.reschedules[0];
  for (const month of [false, true]) {
    assert.equal(
      scheduleEvents(cancelled, state, selection, month).filter((e) => e.meeting).length,
      0,
    );
    assert.equal(
      scheduleEvents(shanghaiDayKey(moved.originalDate), state, selection, month).filter(
        (e) => e.meeting,
      ).length,
      0,
    );
    const course = scheduleEvents(shanghaiDayKey(moved.date), state, selection, month).find(
      (e) => e.meeting,
    )!;
    assert.equal(course.meeting?.rescheduleID, moved.id);
    assert.equal(course.time, '10:10 – 12:00');
    assert.equal(course.section, 'timed');
    assert.equal(
      scheduleEvents(
        shanghaiDayKey(moved.date),
        state,
        { ...selection, filter: 'completed' },
        month,
      ).filter((e) => e.meeting).length,
      0,
    );
  }
  term.meetings[0].showInMonth = false;
  assert.equal(
    scheduleEvents(shanghaiDayKey(moved.date), state, selection, true).filter((e) => e.meeting)
      .length,
    0,
  );
  assert.equal(
    scheduleEvents(shanghaiDayKey(moved.date), state, selection).filter((e) => e.meeting).length,
    1,
  );
  state.courses.push({ ...state.courses[0], id: 'other-course', semester: '2027 春季' });
  state.tasks = [task({ courseID: 'other-course' }), task({ id: 'no-course' })];
  assert.deepEqual(
    scheduleEvents('2026-10-26', state, selection)
      .filter((e) => e.plan)
      .map((e) => e.plan?.task.id),
    ['no-course'],
  );
});
