import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Repository } from '../electron/services/storage/repository.ts';
import { emptyLibrary, decodeLibrary } from '../shared/model.ts';
import {
  importUndergraduateTimetable,
  updateTimetableSettings,
  updateTimetableMeeting,
  setTimetableMeetingColor,
  deleteTimetableMeeting,
  readTimetableTerms,
  rescheduleTimetableOccurrence,
  cancelTimetableOccurrence,
  restoreTimetableOccurrence,
} from '../electron/services/course/timetable.ts';
import { timetableOccurrences, shanghaiDayKey } from '../shared/timetable.ts';
import { scheduleFreeMeetings } from '../shared/schedule.ts';
const row = {
  name: '交互测试课程',
  class_number: 'A001',
  teacher: '教师',
  classroom: '原教室',
  weeks: [1, 2, 3, 4],
  week_time: 1,
  start_time: 1,
  time_count: 0,
};
const schedule = { name: '2026 秋季', courses: [row] };
const settings = {
  weekOneMonday: '2026-10-05T00:00:00+08:00',
  weekCount: 4,
  sectionTimes: [{ section: 1, startMinute: 480, endMinute: 530 }],
};
function setup() {
  const state = emptyLibrary(),
    { termID } = importUndergraduateTimetable(state, schedule);
  updateTimetableSettings(state, termID, settings);
  const meetingID = readTimetableTerms(state)[0].meetings[0].id;
  rescheduleTimetableOccurrence(state, termID, meetingID, '2026-10-05', {
    date: '2026-10-07',
    startSection: 1,
    sectionCount: 1,
    classroom: '临时教室',
  });
  rescheduleTimetableOccurrence(state, termID, meetingID, '2026-10-12', {
    date: '2026-10-14',
    startSection: 1,
    sectionCount: 1,
    classroom: '另一个临时教室',
  });
  cancelTimetableOccurrence(state, termID, meetingID, '2026-10-12', '测试');
  return { state, termID, meetingID };
}
const patch = {
  weekday: 2,
  startSection: 1,
  sectionCount: 1,
  classroom: '新教室',
  weeks: [1, 2, 3, 4],
};
test('weekly editing follows Swift exception rebasing while preserving destination snapshots and metadata', () => {
  const { state, termID, meetingID } = setup();
  (state.timetableTerms[0].meetings as Record<string, unknown>[])[0].futureField = { keep: true };
  updateTimetableMeeting(state, termID, meetingID, patch);
  const term = readTimetableTerms(state)[0];
  assert.equal(shanghaiDayKey(term.reschedules[0].originalDate), '2026-10-06');
  assert.equal(shanghaiDayKey(term.cancellations[0].date), '2026-10-13');
  assert.equal(shanghaiDayKey(term.cancellations[0].savedReschedule!.originalDate), '2026-10-13');
  assert.equal(term.reschedules[0].meeting.classroom, '临时教室');
  assert.deepEqual(term.meetings[0].futureField, { keep: true });
  assert.equal(timetableOccurrences(term, '2026-10-05').length, 0);
  assert.equal(timetableOccurrences(term, '2026-10-06').length, 0);
  assert.equal(timetableOccurrences(term, '2026-10-07').length, 1);
  assert.equal(timetableOccurrences(term, '2026-10-13').length, 0);
  assert.equal(timetableOccurrences(term, '2026-10-20')[0].meeting.classroom, '新教室');
  restoreTimetableOccurrence(state, termID, term.cancellations[0].id);
  assert.equal(timetableOccurrences(readTimetableTerms(state)[0], '2026-10-14').length, 1);
});
test('removed weeks retain their one-off exceptions exactly as Swift does', () => {
  const { state, termID, meetingID } = setup();
  updateTimetableMeeting(state, termID, meetingID, { ...patch, weeks: [3, 4] });
  const term = readTimetableTerms(state)[0];
  assert.equal(shanghaiDayKey(term.reschedules[0].originalDate), '2026-10-05');
  assert.equal(shanghaiDayKey(term.cancellations[0].date), '2026-10-12');
  assert.equal(timetableOccurrences(term, '2026-10-07').length, 1);
});
test('invalid edits fail without changing the supplied state', () => {
  for (const invalid of [
    { weeks: [] },
    { weeks: [1, 1] },
    { weeks: [5] },
    { startSection: 30, sectionCount: 2 },
    { weekday: 8 },
    { weeks: [1], title: '不允许跨字段修改' },
  ]) {
    const { state, termID, meetingID } = setup(),
      before = structuredClone(state);
    assert.throws(() => updateTimetableMeeting(state, termID, meetingID, { ...patch, ...invalid }));
    assert.deepEqual(state, before);
  }
});
test('color override propagates to moved and cancelled snapshots; inheritance removes only the override', () => {
  const { state, termID, meetingID } = setup(),
    courseColor = state.courses[0].colorHex;
  setTimetableMeetingColor(state, termID, meetingID, '#aabbcc');
  let term = readTimetableTerms(state)[0];
  assert.equal(term.meetings[0].colorHex, '#AABBCC');
  assert.equal(term.reschedules[0].meeting.colorHex, '#AABBCC');
  assert.equal(term.cancellations[0].savedReschedule!.meeting.colorHex, '#AABBCC');
  assert.equal(state.courses[0].colorHex, courseColor);
  assert.throws(() => setTimetableMeetingColor(state, termID, meetingID, 'red'));
  setTimetableMeetingColor(state, termID, meetingID, null);
  term = readTimetableTerms(state)[0];
  for (const m of [
    term.meetings[0],
    term.reschedules[0].meeting,
    term.cancellations[0].savedReschedule!.meeting,
  ])
    assert.equal(Object.hasOwn(m, 'colorHex'), false);
});
test('removing a weekly slot retains course and cancellation history, clears only its moved snapshots', () => {
  const { state, termID, meetingID } = setup(),
    courses = structuredClone(state.courses);
  deleteTimetableMeeting(state, termID, meetingID);
  const term = readTimetableTerms(state)[0];
  assert.equal(term.meetings.length, 0);
  assert.equal(term.reschedules.length, 0);
  assert.equal(term.cancellations.length, 1);
  assert.equal(term.cancellations[0].savedReschedule, undefined);
  assert.deepEqual(state.courses, courses);
  assert.doesNotThrow(() => decodeLibrary(state));
});
test('free courses honor term, week, course, source and query filters without fabricated dates', () => {
  const state = emptyLibrary(),
    { termID } = importUndergraduateTimetable(state, {
      ...schedule,
      courses: [{ ...row, week_time: 0, start_time: 0, time_count: 0, weeks: [2, 3] }],
    });
  const selected = {
    termID,
    courseID: '',
    filter: 'active' as const,
    showsFixed: true,
    showsActivities: true,
    query: '',
  };
  assert.equal(scheduleFreeMeetings('2026-10-12', state, selected, 2).length, 1);
  assert.equal(scheduleFreeMeetings('2026-10-12', state, selected, 1).length, 0);
  updateTimetableSettings(state, termID, settings);
  assert.equal(scheduleFreeMeetings('2026-10-12', state, selected).length, 1);
  assert.equal(scheduleFreeMeetings('2026-10-26', state, selected).length, 0);
  assert.equal(
    scheduleFreeMeetings('2026-10-12', state, { ...selected, showsFixed: false }).length,
    0,
  );
  assert.equal(
    scheduleFreeMeetings('2026-10-12', state, { ...selected, filter: 'pending' }).length,
    0,
  );
  assert.equal(
    scheduleFreeMeetings('2026-10-12', state, { ...selected, courseID: 'missing' }).length,
    0,
  );
  assert.equal(
    scheduleFreeMeetings('2026-10-12', state, { ...selected, query: '教师 A001' }).length,
    1,
  );
  assert.equal(scheduleFreeMeetings('2026-10-12', state, { ...selected, query: '其他' }).length, 0);
});
async function repository(t: { after: (fn: () => Promise<void>) => void }) {
  const dir = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), 'teachshell-interactions-')),
  );
  const repo = await Repository.open(path.join(dir, 'library'), { create: true });
  t.after(async () => {
    await repo.close();
    await fs.rm(dir, { recursive: true, force: true });
  });
  const imported = await repo.importTimetable(schedule);
  await repo.saveTimetableSettings(imported.summary.termID, settings);
  return {
    repo,
    dir,
    termID: imported.summary.termID,
    meetingID: readTimetableTerms(repo.state)[0].meetings[0].id,
  };
}
test('durable delete and undo preserve real material bytes and intervening plans across reopen', async (t) => {
  const { repo, dir, termID, meetingID } = await repository(t);
  const source = path.join(dir, '课程资料.txt');
  await fs.writeFile(source, 'Unicode 原课件不可丢失\n');
  await repo.importFiles([source], { courseID: repo.state.courses[0].id });
  const before = repo.state,
    material = before.materials[0];
  await repo.deleteTimetableMeeting(termID, meetingID);
  assert.equal(repo.snapshot().canUndoTimetable, true);
  await repo.saveTask({
    title: '保留新计划',
    startsAt: '2026-10-26',
    courseID: before.courses[0].id,
  });
  await repo.undoTimetableChange();
  assert.deepEqual(repo.state.timetableTerms, before.timetableTerms);
  assert.equal(repo.state.tasks.at(-1)?.title, '保留新计划');
  assert.deepEqual(repo.state.materials[0], material);
  assert.equal(repo.snapshot().canUndoTimetable, false);
  await assert.rejects(() => repo.undoTimetableChange(), /无法撤销/);
  const files = await fs.readdir(path.join(repo.root, 'files'), { recursive: true });
  const file = files.find((p) => p.endsWith('课程资料.txt'))!;
  assert.equal(
    await fs.readFile(path.join(repo.root, 'files', file), 'utf8'),
    'Unicode 原课件不可丢失\n',
  );
  await repo.close();
  const reopened = await Repository.open(repo.root);
  try {
    assert.deepEqual(reopened.state.timetableTerms, before.timetableTerms);
  } finally {
    await reopened.close();
  }
});
test('external timetable edits invalidate undo; guarded mutations reject without consuming undo', async (t) => {
  const { repo, termID, meetingID } = await repository(t);
  await repo.updateTimetableMeeting(termID, meetingID, patch);
  const before = repo.snapshot();
  await assert.rejects(
    () =>
      repo.withMutationGuard(
        () => {
          throw new Error('stale');
        },
        () => repo.deleteTimetableMeeting(termID, meetingID),
      ),
    /stale/,
  );
  assert.equal(repo.snapshot().revision, before.revision);
  assert.equal(repo.snapshot().canUndoTimetable, true);
  const external = repo.state;
  external.timetableTerms[0].name = '外部课表修改';
  await fs.writeFile(path.join(repo.root, 'library.json'), JSON.stringify(external));
  await assert.rejects(() => repo.undoTimetableChange(), /无法撤销|索引被另一程序修改/);
  assert.equal(
    JSON.parse(await fs.readFile(path.join(repo.root, 'library.json'), 'utf8')).timetableTerms[0]
      .name,
    '外部课表修改',
  );
});

// Optional production Swift differential bundle, generated only under an explicit temp path.
if (process.env.TEACHSHELF_TIMETABLE_INTERACTIONS) {
  const cases = [];
  for (const action of ['weekly', 'removed-weeks', 'color', 'inherit', 'delete']) {
    const { state, termID, meetingID } = setup();
    if (action === 'inherit') setTimetableMeetingColor(state, termID, meetingID, '#AABBCC');
    const before = structuredClone(state);
    if (action === 'weekly') updateTimetableMeeting(state, termID, meetingID, patch);
    if (action === 'removed-weeks')
      updateTimetableMeeting(state, termID, meetingID, { ...patch, weeks: [3, 4] });
    if (action === 'color') setTimetableMeetingColor(state, termID, meetingID, '#AABBCC');
    if (action === 'inherit') setTimetableMeetingColor(state, termID, meetingID, null);
    if (action === 'delete') deleteTimetableMeeting(state, termID, meetingID);
    cases.push({ action, termID, meetingID, before, after: state });
  }
  await fs.writeFile(process.env.TEACHSHELF_TIMETABLE_INTERACTIONS, JSON.stringify(cases));
}
