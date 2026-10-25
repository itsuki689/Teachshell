import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Repository } from '../electron/services/storage/repository.ts';
import { defaultToolbarActions, readToolbarActions, toolbarActions } from '../shared/toolbar.ts';
import { decodeLibrary, emptyLibrary } from '../shared/model.ts';
import { planSnapshot, swiftSeconds } from '../shared/plans.ts';
import type { Plan } from '../shared/plans.ts';

const day = (value: number, hour = 0, minute = 0) =>
  swiftSeconds(
    `2026-10-${value}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+08:00`,
  );

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'native-interactions-')));
  let repo = await Repository.open(path.join(root, 'Library'), { create: true });
  t.after(async () => {
    await repo.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  await repo.createCourse({
    name: '保留课程资料',
    semester: '2026 秋季',
    teacher: '原有教师',
    colorHex: '#8058A1',
  });
  const course = repo.state.courses[0];
  const source = path.join(root, '原课件.txt');
  await fs.writeFile(source, '必须保留的原始资料');
  await repo.importFiles([source], { courseID: course.id });
  const material = repo.state.materials[0];
  const plan: Plan = {
    id: randomUUID().toUpperCase(),
    title: '复习',
    content: '人工备注',
    kind: '任务',
    courseID: course.id,
    materialIDs: [material.id],
    startsAt: day(15, 12),
    endsAt: day(15, 13),
    deadline: day(15, 20),
    isAllDay: false,
    showOnCalendar: true,
    origin: 'activity',
    hasExecutionTime: true,
    location: '教室 A',
    showInMonth: true,
    completionRequired: true,
    deadlineIsAllDay: false,
    colorHex: '#8058A1',
    exceptions: [],
    repeatRule: { frequency: 'weekly', interval: 1 },
  };
  await repo.savePlan(plan);
  const index = path.join(repo.root, 'library.json');
  return {
    root,
    get repo() {
      return repo;
    },
    course,
    material,
    plan,
    index,
    async reopen() {
      await repo.close();
      repo = await Repository.open(path.join(root, 'Library'));
      return repo;
    },
  };
}

test('Swift toolbar raw-value schema, original defaults, six unique items and empty capsule', () => {
  assert.deepEqual(toolbarActions, [
    'update',
    'settings',
    'import',
    'create',
    'schedule',
    'allMaterials',
    'favorites',
    'recent',
    'homework',
    'pendingTasks',
  ]);
  assert.deepEqual(readToolbarActions(undefined), ['update', 'settings', 'import', 'create']);
  const defaults = readToolbarActions(undefined);
  defaults.reverse();
  assert.deepEqual(defaultToolbarActions, ['update', 'settings', 'import', 'create']);
  assert.deepEqual(readToolbarActions({ actions: [] }), []);
  const six = ['pendingTasks', 'schedule', 'import', 'favorites', 'homework', 'settings'];
  assert.deepEqual(readToolbarActions({ actions: six }), six);
  for (const invalid of [
    null,
    [],
    '',
    {},
    { actions: null },
    { actions: 'settings' },
    { actions: ['futureAction'] },
    { actions: ['settings', 'settings'] },
    { actions: toolbarActions.slice(0, 7) },
    { actions: ['Settings'] },
    { actions: [0] },
  ])
    assert.throws(() => readToolbarActions(invalid));
});

test('legacy index without toolbar key loads defaults without rewriting any index bytes', async (t) => {
  const f = await fixture(t);
  await f.repo.close();
  const document = JSON.parse(await fs.readFile(f.index, 'utf8'));
  delete document.toolbarSettings;
  const bytes = JSON.stringify(document, null, 3);
  await fs.writeFile(f.index, bytes);
  await f.reopen();
  assert.deepEqual(readToolbarActions(f.repo.state.toolbarSettings), defaultToolbarActions);
  assert.equal(Object.hasOwn(f.repo.state, 'toolbarSettings'), false);
  assert.equal(await fs.readFile(f.index, 'utf8'), bytes);
  assert.deepEqual(f.repo.state.tasks, document.tasks);
  assert.equal(
    await fs.readFile(path.join(f.repo.root, f.material.storedPath), 'utf8'),
    '必须保留的原始资料',
  );
});

test('toolbar custom order and empty capsule survive reopen while unknown fields and records remain intact', async (t) => {
  const f = await fixture(t);
  await f.repo.close();
  const document = JSON.parse(await fs.readFile(f.index, 'utf8'));
  document.toolbarSettings.futureVisualPolicy = { spacing: 12, version: 2 };
  document.futureLibraryField = { keep: true };
  await fs.writeFile(f.index, JSON.stringify(document));
  await f.reopen();
  for (const actions of [
    ['pendingTasks', 'schedule', 'import', 'favorites', 'homework', 'settings'],
    [],
  ]) {
    const before = f.repo.state;
    await f.repo.saveToolbarSettings(actions, f.repo.snapshot().revision);
    await f.reopen();
    assert.deepEqual(f.repo.state, {
      ...before,
      toolbarSettings: { ...(before.toolbarSettings as object), actions },
    });
    assert.deepEqual((f.repo.state.toolbarSettings as Record<string, unknown>).futureVisualPolicy, {
      spacing: 12,
      version: 2,
    });
  }
});

test('invalid stored toolbar values reject open and retain recoverable original bytes', async (t) => {
  const f = await fixture(t);
  await f.repo.close();
  const document = JSON.parse(await fs.readFile(f.index, 'utf8'));
  for (const invalid of [
    null,
    { actions: null },
    { actions: ['futureAction'] },
    { actions: ['settings', 'settings'] },
    { actions: toolbarActions.slice(0, 7) },
  ]) {
    const bytes = JSON.stringify({ ...document, toolbarSettings: invalid });
    await fs.writeFile(f.index, bytes);
    await assert.rejects(Repository.open(f.repo.root));
    assert.equal(await fs.readFile(f.index, 'utf8'), bytes);
    assert.throws(() => decodeLibrary({ ...emptyLibrary(), toolbarSettings: invalid }));
  }
});

test('invalid toolbar writes and stale queued revisions leave state, index and backup unchanged', async (t) => {
  const f = await fixture(t);
  for (const actions of [['settings', 'settings'], toolbarActions.slice(0, 7), ['futureAction']]) {
    const before = f.repo.state,
      bytes = await fs.readFile(f.index),
      backup = await fs.readFile(f.index + '.bak');
    await assert.rejects(f.repo.saveToolbarSettings(actions));
    assert.deepEqual(f.repo.state, before);
    assert.deepEqual(await fs.readFile(f.index), bytes);
    assert.deepEqual(await fs.readFile(f.index + '.bak'), backup);
  }
  const revision = f.repo.snapshot().revision;
  const earlier = f.repo.updateCourse(f.course.id, { name: '并发课程修改' });
  const rejection = assert.rejects(f.repo.saveToolbarSettings([], revision), /资料库已变化/);
  await Promise.all([earlier, rejection]);
  assert.deepEqual(readToolbarActions(f.repo.state.toolbarSettings), defaultToolbarActions);
  assert.equal(f.repo.state.courses[0].name, '并发课程修改');
});

test('backup failure keeps prior toolbar state and data instead of committing a partial edit', async (t) => {
  const f = await fixture(t);
  const before = f.repo.state,
    bytes = await fs.readFile(f.index);
  await fs.rm(f.index + '.bak');
  await fs.mkdir(f.index + '.bak');
  await assert.rejects(f.repo.saveToolbarSettings([]));
  assert.deepEqual(f.repo.state, before);
  assert.deepEqual(await fs.readFile(f.index), bytes);
});

test('Swift repeated minute resize preserves DDL, material links, parent and other weeks', async (t) => {
  const f = await fixture(t);
  const before = f.repo.state.tasks[0];
  await f.repo.setPlanOccurrenceTime(f.plan.id, day(22, 12), day(22), { start: 670, end: 800 });
  const parent = f.repo.state.tasks[0],
    resized = planSnapshot(parent, day(22, 12));
  assert.equal(resized.startsAt, day(22, 11, 10));
  assert.equal(resized.endsAt, day(22, 13, 20));
  assert.equal(resized.deadline, day(22, 20));
  assert.equal(resized.colorHex, '#8058A1');
  assert.deepEqual(resized.materialIDs, [f.material.id]);
  assert.equal(resized.content, '人工备注');
  assert.equal(parent.startsAt, before.startsAt);
  assert.equal(parent.endsAt, before.endsAt);
  const { exceptions: _nextExceptions, ...nextWeek } = planSnapshot(parent, day(29, 12));
  const { exceptions: _oldExceptions, ...oldWeek } = planSnapshot(before, day(29, 12));
  assert.deepEqual(nextWeek, oldWeek);
  assert.equal((parent.exceptions as object[]).length, 1);
  await f.reopen();
  assert.deepEqual(f.repo.state.tasks[0], parent);
});

test('moving a previously overridden occurrence keeps its original anchor and unrelated overrides', async (t) => {
  const f = await fixture(t);
  const single = planSnapshot(f.repo.state.tasks[0], day(22, 12));
  await f.repo.savePlan(
    { ...single, title: '本次人工标题', content: '本次备注', deadline: day(23, 21) },
    'thisOccurrence',
    day(22, 12),
  );
  await f.repo.setPlanOccurrenceTime(f.plan.id, day(22, 12), day(23), { start: 510, end: 570 });
  await f.repo.setPlanOccurrenceTime(f.plan.id, day(22, 12), day(24), { start: 600, end: 720 });
  const parent = f.repo.state.tasks[0],
    moved = planSnapshot(parent, day(22, 12));
  assert.equal(moved.title, '本次人工标题');
  assert.equal(moved.content, '本次备注');
  assert.equal(moved.startsAt, day(24, 10));
  assert.equal(moved.endsAt, day(24, 12));
  assert.equal(moved.deadline, day(23, 21));
  assert.deepEqual(moved.materialIDs, [f.material.id]);
  assert.equal((parent.exceptions as { originalDate: number }[]).length, 1);
  assert.equal((parent.exceptions as { originalDate: number }[])[0].originalDate, day(22, 12));
  const bytes = await fs.readFile(f.index);
  await assert.rejects(
    f.repo.setPlanOccurrenceTime(f.plan.id, day(24, 10), day(24), { start: 610, end: 730 }),
    /找不到该次/,
  );
  assert.deepEqual(await fs.readFile(f.index), bytes);
});

test('nonrepeating minute movement changes only execution and permits day boundaries without adding exceptions', async (t) => {
  const f = await fixture(t);
  await f.repo.savePlan({ ...f.repo.state.tasks[0], repeatRule: undefined });
  const before = f.repo.state.tasks[0];
  await f.repo.setPlanOccurrenceTime(f.plan.id, before.startsAt, day(16, 17), {
    start: 0,
    end: 1440,
  });
  const after = f.repo.state.tasks[0];
  assert.deepEqual(after, { ...before, startsAt: day(16), endsAt: day(17) });
  assert.equal(after.deadline, before.deadline);
  assert.deepEqual(after.exceptions, []);
});

test('invalid ranges, dates and recurrence anchors reject atomically', async (t) => {
  const f = await fixture(t);
  const before = f.repo.state,
    bytes = await fs.readFile(f.index);
  for (const range of [
    { start: -1, end: 60 },
    { start: 30, end: 30 },
    { start: 60, end: 30 },
    { start: 0, end: 1441 },
    { start: 1.5, end: 60 },
    { start: 0, end: NaN },
    { start: Infinity, end: 60 },
  ]) {
    await assert.rejects(f.repo.setPlanOccurrenceTime(f.plan.id, day(22, 12), day(22), range));
    assert.deepEqual(f.repo.state, before);
    assert.deepEqual(await fs.readFile(f.index), bytes);
  }
  for (const invalid of [NaN, Infinity, 'not-a-date'])
    await assert.rejects(
      f.repo.setPlanOccurrenceTime(f.plan.id, day(22, 12), invalid, { start: 600, end: 660 }),
    );
  await assert.rejects(
    f.repo.setPlanOccurrenceTime(f.plan.id, day(23, 12), day(22), { start: 600, end: 660 }),
  );
  assert.deepEqual(await fs.readFile(f.index), bytes);
});

test('all-day, deadline-only and archived plans reject minute editing while preserving bytes', async (t) => {
  const f = await fixture(t);
  for (const variant of [
    { isAllDay: true },
    { hasExecutionTime: false, endsAt: undefined },
    { completedAt: day(24), archivedAt: day(24) },
  ]) {
    await f.repo.savePlan({ ...f.plan, ...variant });
    const bytes = await fs.readFile(f.index),
      before = f.repo.state;
    const anchor = variant.hasExecutionTime === false ? day(22, 20) : day(22, 12);
    await assert.rejects(
      f.repo.setPlanOccurrenceTime(f.plan.id, anchor, day(22), { start: 600, end: 660 }),
    );
    assert.deepEqual(f.repo.state, before);
    assert.deepEqual(await fs.readFile(f.index), bytes);
  }
});
