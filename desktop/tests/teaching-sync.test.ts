import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { Repository } from '../electron/services/storage/repository.ts';
import { AssignmentSyncService } from '../electron/services/website/assignment-sync.ts';
import {
  connectTeachingCourse,
  getTeachingConnection,
  mergeTeachingAssignment,
  resolveTeachingDeadline,
  teachingDeadline,
  teachingPageURL,
} from '../electron/services/website/teaching.ts';
import type {
  TeachingActivity,
  TeachingPage,
  TeachingConnection,
} from '../electron/services/website/teaching.ts';
import { emptyLibrary, dateMs } from '../shared/model.ts';
import type { LibraryState } from '../shared/model.ts';
import { swiftSeconds, planEvents } from '../shared/plans.ts';

const now = swiftSeconds('2026-10-21T12:00:00+08:00'),
  activity: TeachingActivity = {
    id: '5302',
    kind: 'assign',
    title: '作业09',
    sectionID: 'section-2',
    section: '作业',
    url: 'https://selearning.nju.edu.cn/mod/assign/view.php?id=5302',
  };
const page = (deadlineText = '2026年10月26日 Monday 18:00', submitted = false): TeachingPage => ({
  kind: 'assign',
  accountID: '123',
  courseID: '411',
  title: '作业09',
  activities: [],
  files: [],
  intro: '阅读教材，完成题目。',
  deadlineText,
  submitted,
});
function initial() {
  const state = emptyLibrary(),
    course = {
      id: randomUUID().toUpperCase(),
      name: '数据库',
      semester: '',
      teacher: '',
      colorHex: '#39786B',
      isArchived: false,
    };
  state.courses.push(course);
  const { connection } = connectTeachingCourse(state, {
    courseID: course.id,
    remoteCourseID: '411',
    remoteTitle: '数据库系统概论',
    accountID: '123',
  });
  return { state, course, connection };
}
async function fixture() {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'teachshelf-teaching-'))),
    repo = await Repository.open(path.join(root, 'Library'), { create: true }),
    id = randomUUID().toUpperCase();
  await repo.createCourse({ id, name: '数据库' });
  const connected = await repo.connectTeachingCourse({
    courseID: id,
    remoteCourseID: '411',
    remoteTitle: '数据库系统概论',
    accountID: '123',
  });
  return {
    root,
    repo,
    id,
    connection: connected.connection,
    cleanup: async () => {
      await repo.close();
      await fs.rm(root, { recursive: true, force: true });
    },
  };
}

test('concurrent connection option updates merge inside the transaction without losing other flags', async () => {
  const f = await fixture();
  try {
    await f.repo.syncTeachingAssignment(f.connection.id, activity, page(), now);
    const before = getTeachingConnection(f.repo.state, f.connection.id);
    await Promise.all([
      f.repo.updateTeachingOptions(f.connection.id, { includeMaterials: false }),
      f.repo.updateTeachingOptions(f.connection.id, { includeAssignments: false }),
      f.repo.updateTeachingOptions(f.connection.id, { includeHistory: true }),
    ]);
    const after = getTeachingConnection(f.repo.state, f.connection.id);
    assert.equal(after.includeMaterials, false);
    assert.equal(after.includeAssignments, false);
    assert.equal(after.includeHistory, true);
    assert.equal(after.includeExperiments, before.includeExperiments);
    assert.equal(after.accountID, before.accountID);
    assert.equal(after.remoteCourseID, before.remoteCourseID);
    assert.deepEqual(after.items, before.items);
    assert.deepEqual(after.messages, before.messages);
  } finally {
    await f.cleanup();
  }
});

test('teaching deadlines match explicit zones, civil all-day dates and reject ambiguous or invalid text', () => {
  assert.equal(
    teachingDeadline('2026年10月26日 Monday 18:00', 'Asia/Shanghai').date,
    teachingDeadline('2026-10-26 10:00', 'UTC').date,
  );
  assert.equal(teachingDeadline('2026-10-26', 'Asia/Shanghai').allDay, true);
  assert.equal(teachingDeadline('2026-10-26 00:00', 'Asia/Shanghai').allDay, false);
  assert.equal(
    teachingDeadline('2026-10-26T10:00:00Z', 'Asia/Shanghai').date,
    swiftSeconds('2026-10-26T18:00:00+08:00'),
  );
  for (const text of [
    '2026-02-30 18:00',
    '2026-13-01',
    '2026-10-26 25:00',
    '下周一交',
    '2026-10-26T25:00:00Z',
  ])
    assert.equal(teachingDeadline(text, 'Asia/Shanghai').date, undefined, text);
  assert.equal(teachingDeadline('2026-10-26', 'invalid/timezone').date, undefined);
  for (const url of [
    'http://selearning.nju.edu.cn/course/view.php?id=411',
    'https://selearning.nju.edu.cn.evil.invalid/course/view.php?id=411',
    'https://selearning.nju.edu.cn/mod/forum/view.php?id=411',
    'https://selearning.nju.edu.cn:8443/course/view.php?id=411',
  ])
    assert.throws(() => teachingPageURL(url));
});
test('source binding is idempotent, keeps settings and history, and cannot silently switch local course or account', async () => {
  const f = await fixture();
  try {
    await f.repo.saveTeachingConnection({
      ...f.connection,
      includeHistory: true,
      includeExperiments: false,
    });
    await f.repo.finishTeachingUpdate(
      f.connection.id,
      [{ id: randomUUID().toUpperCase(), text: '已有更新记录', isIssue: false }],
      true,
    );
    const before = f.repo.state,
      bytes = await fs.readFile(path.join(f.repo.root, 'library.json'));
    const reused = await f.repo.connectTeachingCourse({
      courseID: f.id,
      remoteCourseID: '411',
      remoteTitle: '重新读取的标题',
      accountID: '123',
    });
    assert.equal(reused.created, false);
    assert.equal(reused.connection.id, f.connection.id);
    assert.equal(reused.connection.includeHistory, true);
    assert.deepEqual(f.repo.state, before);
    assert.deepEqual(await fs.readFile(path.join(f.repo.root, 'library.json')), bytes);
    const other = randomUUID().toUpperCase();
    await f.repo.createCourse({ id: other, name: '另一门课' });
    await assert.rejects(
      f.repo.connectTeachingCourse({
        courseID: other,
        remoteCourseID: '411',
        remoteTitle: '相同远端课程',
        accountID: '123',
      }),
      /已绑定/,
    );
    await assert.rejects(
      f.repo.saveTeachingConnection({ ...f.connection, accountID: '456' }),
      /断开旧连接/,
    );
    const newAccount = await f.repo.connectTeachingCourse({
      courseID: f.id,
      remoteCourseID: '411',
      remoteTitle: '同课另一账号',
      accountID: '456',
    });
    assert.equal(newAccount.created, true);
    assert.equal(f.repo.state.teachingConnections.length, 2);
  } finally {
    await f.cleanup();
  }
});
test('assignment synchronization yields one deadline and preserves local title, content, completion and execution', () => {
  const { state, connection } = initial();
  mergeTeachingAssignment(state, connection.id, activity, page(), now);
  const original = state.tasks[0];
  assert.equal(original.origin, 'fixed');
  assert.equal(original.hasExecutionTime, false);
  assert.equal(planEvents('2026-10-26', state.tasks).filter((e) => e.isDeadline).length, 1);
  original.title = '自己的作业名';
  original.content = '本地笔记';
  original.completedAt = now;
  original.hasExecutionTime = true;
  original.startsAt = now;
  const id = original.id;
  mergeTeachingAssignment(
    state,
    connection.id,
    { ...activity, title: '网站新标题' },
    page('2026年10月27日 18:00'),
    now,
  );
  assert.equal(state.tasks.length, 1);
  assert.equal(state.tasks[0].id, id);
  assert.equal(state.tasks[0].title, '自己的作业名');
  assert.equal(state.tasks[0].content, '本地笔记');
  assert.equal(state.tasks[0].completedAt, now);
  assert.equal(state.tasks[0].startsAt, now);
  assert.equal(state.tasks[0].deadline, swiftSeconds('2026-10-27T18:00:00+08:00'));
});
test('local deadline conflicts persist for explicit choice and an acknowledged website value is not repeatedly proposed', () => {
  const { state, connection } = initial();
  mergeTeachingAssignment(state, connection.id, activity, page(), now);
  const local = swiftSeconds('2026-10-25T18:00:00+08:00');
  state.tasks[0].deadline = local;
  const pending = mergeTeachingAssignment(
    state,
    connection.id,
    activity,
    page('2026-10-28 18:00'),
    now,
  );
  assert.equal(state.tasks[0].deadline, local);
  assert.equal(pending.pendingDeadline!.date, swiftSeconds('2026-10-28T18:00:00+08:00'));
  resolveTeachingDeadline(state, connection.id, 'plan:5302', false);
  mergeTeachingAssignment(state, connection.id, activity, page('2026-10-28 18:00'), now);
  assert.equal(getTeachingConnection(state, connection.id).items[0].pendingDeadline, undefined);
  assert.equal(state.tasks[0].deadline, local);
  mergeTeachingAssignment(state, connection.id, activity, page('2026-10-29 18:00'), now);
  resolveTeachingDeadline(state, connection.id, 'plan:5302', true);
  assert.equal(state.tasks[0].deadline, swiftSeconds('2026-10-29T18:00:00+08:00'));
  assert.equal(getTeachingConnection(state, connection.id).items[0].pendingDeadline, undefined);
});
test('ambiguous dates preserve deadlines, missing dates clear untouched deadlines, and midnight changes all-day display', () => {
  const { state, connection } = initial();
  mergeTeachingAssignment(state, connection.id, activity, page('2026-10-26'), now);
  const deadline = state.tasks[0].deadline;
  assert.equal(state.tasks[0].deadlineIsAllDay, true);
  mergeTeachingAssignment(state, connection.id, activity, page('2026-10-26 00:00'), now);
  assert.equal(state.tasks[0].deadline, deadline);
  assert.equal(state.tasks[0].deadlineIsAllDay, false);
  const ambiguous = mergeTeachingAssignment(state, connection.id, activity, page('下周一'), now);
  assert.match(ambiguous.message, /待核对/);
  assert.equal(state.tasks[0].deadline, deadline);
  mergeTeachingAssignment(state, connection.id, activity, page(''), now);
  assert.equal(state.tasks[0].deadline, undefined);
});
test('new history is opt-in, imported submitted history is completed, and archived or moved local plans are retained', () => {
  const { state, connection, course } = initial();
  assert.equal(
    mergeTeachingAssignment(state, connection.id, activity, page('2026-10-01'), now).reviewable,
    false,
  );
  assert.equal(state.tasks.length, 0);
  connection.includeHistory = true;
  state.teachingConnections = [connection];
  mergeTeachingAssignment(state, connection.id, activity, page('2026-10-01', true), now);
  assert.equal(state.tasks[0].completedAt, now);
  state.tasks[0].archivedAt = now;
  const before = structuredClone(state.tasks[0]);
  assert.match(
    mergeTeachingAssignment(state, connection.id, activity, page('2026-10-29'), now).message,
    /保留归档/,
  );
  assert.deepEqual(state.tasks[0], before);
  delete state.tasks[0].archivedAt;
  delete state.tasks[0].courseID;
  assert.match(
    mergeTeachingAssignment(state, connection.id, activity, page(), now).message,
    /忽略/,
  );
  assert.equal(state.tasks.length, 1);
  assert.equal(state.tasks[0].courseID, undefined);
  assert.equal(getTeachingConnection(state, connection.id).items[0].ignored, true);
  assert.equal(state.courses[0].id, course.id);
});
test('deleted plans stay ignored across repeated synchronization until the user explicitly restores ignored items', async () => {
  const f = await fixture();
  try {
    await f.repo.syncTeachingAssignment(f.connection.id, activity, page(), now);
    await f.repo.deletePlan(f.repo.state.tasks[0].id);
    await f.repo.syncTeachingAssignment(f.connection.id, activity, page(), now);
    await f.repo.syncTeachingAssignment(f.connection.id, activity, page('2026-10-29'), now);
    assert.equal(f.repo.state.tasks.length, 0);
    assert.equal(getTeachingConnection(f.repo.state, f.connection.id).items[0].ignored, true);
    await f.repo.restoreIgnoredTeachingItems(f.connection.id);
    await f.repo.syncTeachingAssignment(f.connection.id, activity, page(), now);
    assert.equal(f.repo.state.tasks.length, 1);
    await f.repo.disconnectTeachingWebsite(f.connection.id);
    assert.equal(f.repo.state.tasks.length, 1);
    assert.equal(f.repo.state.teachingConnections.length, 0);
  } finally {
    await f.cleanup();
  }
});
test('identity mismatches, archived courses and failed index writes leave local plans unchanged', async () => {
  const f = await fixture();
  try {
    const before = f.repo.state;
    for (const other of [
      { ...page(), accountID: '456' },
      { ...page(), courseID: '999' },
    ])
      await assert.rejects(
        f.repo.syncTeachingAssignment(f.connection.id, activity, other, now),
        /账号或课程/,
      );
    assert.deepEqual(f.repo.state, before);
    await f.repo.updateCourse(f.id, { isArchived: true });
    await assert.rejects(
      f.repo.syncTeachingAssignment(f.connection.id, activity, page(), now),
      /归档/,
    );
    await f.repo.updateCourse(f.id, { isArchived: false });
    const intact = f.repo.state,
      bytes = await fs.readFile(path.join(f.repo.root, 'library.json'));
    await fs.rm(path.join(f.repo.root, 'library.json.bak'));
    await fs.mkdir(path.join(f.repo.root, 'library.json.bak'));
    await assert.rejects(f.repo.syncTeachingAssignment(f.connection.id, activity, page(), now));
    assert.deepEqual(f.repo.state, intact);
    assert.deepEqual(await fs.readFile(path.join(f.repo.root, 'library.json')), bytes);
  } finally {
    await f.cleanup();
  }
});
test('assignment preview is read-only and confirmation validates the same page, expiry, root and latest local revision', async () => {
  const f = await fixture();
  let clock = dateMs(now);
  const service = new AssignmentSyncService(
    () => f.repo,
    () => clock,
  );
  try {
    const bytes = await fs.readFile(path.join(f.repo.root, 'library.json')),
      preview = await service.preview(f.connection.id, activity, page(), activity.url);
    assert.equal(f.repo.state.tasks.length, 0);
    assert.deepEqual(await fs.readFile(path.join(f.repo.root, 'library.json')), bytes);
    assert.equal(preview.reviewable, true);
    await assert.rejects(
      service.apply(preview.proposalID, page('2026-10-29'), activity.url),
      /内容已变化/,
    );
    await assert.rejects(
      service.apply(preview.proposalID, page(), activity.url.replace('5302', '5303')),
      /网页不一致/,
    );
    await service.apply(preview.proposalID, page(), activity.url);
    assert.equal(f.repo.state.tasks[0].id, preview.proposed!.id);
    await assert.rejects(service.apply(preview.proposalID, page(), activity.url), /过期/);
    const changed = page('2026-10-29'),
      next = await service.preview(f.connection.id, activity, changed, activity.url);
    await f.repo.savePlan({ id: f.repo.state.tasks[0].id, title: '预览后用户编辑' });
    await assert.rejects(service.apply(next.proposalID, changed, activity.url), /本地资料已修改/);
    assert.equal(f.repo.state.tasks[0].title, '预览后用户编辑');
    const stale = await service.preview(f.connection.id, activity, changed, activity.url);
    clock += 15 * 60000 + 1;
    await assert.rejects(service.apply(stale.proposalID, changed, activity.url), /过期/);
  } finally {
    await f.cleanup();
  }
});
test('preview options and conflict resolution reject stale approval and library switching', async () => {
  const f = await fixture();
  const other = await Repository.open(path.join(f.root, 'Other'), { create: true });
  let active = f.repo;
  const service = new AssignmentSyncService(
    () => active,
    () => dateMs(now),
  );
  try {
    await f.repo.saveTeachingConnection({ ...f.connection, includeAssignments: false });
    await assert.rejects(service.preview(f.connection.id, activity, page(), activity.url), /关闭/);
    await f.repo.saveTeachingConnection(f.connection);
    const preview = await service.preview(f.connection.id, activity, page(), activity.url);
    active = other;
    await assert.rejects(service.apply(preview.proposalID, page(), activity.url), /切换/);
    active = f.repo;
    await service.apply(preview.proposalID, page(), activity.url);
    await f.repo.savePlan({
      id: f.repo.state.tasks[0].id,
      deadline: swiftSeconds('2026-10-25T18:00:00+08:00'),
    });
    await f.repo.syncTeachingAssignment(f.connection.id, activity, page('2026-10-29'), now);
    const revision = f.repo.snapshot().revision;
    await f.repo.savePlan({ id: f.repo.state.tasks[0].id, content: '冲突对话之后的新笔记' });
    await assert.rejects(
      service.resolveDeadline(f.connection.id, 'plan:5302', true, revision),
      /已变化/,
    );
    assert.equal(f.repo.state.tasks[0].content, '冲突对话之后的新笔记');
    await service.resolveDeadline(f.connection.id, 'plan:5302', false, f.repo.snapshot().revision);
  } finally {
    await other.close();
    await f.cleanup();
  }
});

test('existing attachment mappings only add current-course non-ignored materials and preserve manual links', () => {
  const { state, connection, course } = initial(),
    other = { ...course, id: randomUUID().toUpperCase(), name: '其他课程' };
  state.courses.push(other);
  const ids = Array.from({ length: 4 }, () => randomUUID().toUpperCase());
  state.materials = ids.map((id, index) => ({
    id,
    courseID: index === 2 ? other.id : course.id,
    title: '附件' + index,
    originalName: 'attachment.txt',
    sourcePath: 'fixture',
    storedPath: 'files/fixture' + index + '.txt',
    isManaged: true,
    category: '课件',
    tags: '',
    notes: '',
    isFavorite: false,
    size: 10,
    addedAt: now,
  }));
  connection.items = ids.slice(0, 3).map((id, index) => ({
    id: 'file:assign:5302:' + index,
    localID: id,
    title: '附件',
    content: '',
    digest: 'fixture',
    ignored: index === 1,
    submitted: false,
  }));
  state.teachingConnections = [connection];
  mergeTeachingAssignment(state, connection.id, activity, page(), now);
  assert.deepEqual(state.tasks[0].materialIDs, [ids[0]]);
  state.tasks[0].materialIDs.push(ids[3]);
  mergeTeachingAssignment(state, connection.id, activity, page(), now);
  assert.deepEqual(state.tasks[0].materialIDs, [ids[0], ids[3]].sort());
});
test('failed confirmation preserves its preview for retry without creating partial plan or mapping records', async () => {
  const f = await fixture(),
    service = new AssignmentSyncService(
      () => f.repo,
      () => dateMs(now),
    );
  try {
    const preview = await service.preview(f.connection.id, activity, page(), activity.url),
      before = f.repo.state;
    const backup = path.join(f.repo.root, 'library.json.bak');
    await fs.rm(backup);
    await fs.mkdir(backup);
    await assert.rejects(service.apply(preview.proposalID, page(), activity.url));
    assert.deepEqual(f.repo.state, before);
    await fs.rmdir(backup);
    await service.apply(preview.proposalID, page(), activity.url);
    assert.equal(f.repo.state.tasks.length, 1);
    assert.equal(f.repo.state.tasks[0].id, preview.proposed!.id);
    assert.equal(getTeachingConnection(f.repo.state, f.connection.id).items.length, 1);
  } finally {
    await f.cleanup();
  }
});

function projection(state: LibraryState) {
  return {
    tasks: state.tasks.map((p) => ({
      title: p.title,
      content: p.content,
      kind: p.kind,
      origin: p.origin,
      hasExecutionTime: p.hasExecutionTime,
      startsAt: p.hasExecutionTime ? p.startsAt : null,
      deadline: p.deadline ?? null,
      deadlineIsAllDay: p.deadlineIsAllDay,
      completedAt: p.completedAt ?? null,
      archivedAt: p.archivedAt ?? null,
      materialIDs: p.materialIDs,
    })),
    links: (state.teachingConnections as unknown as TeachingConnection[]).flatMap((c) =>
      c.items.map((i) => ({
        id: i.id,
        title: i.title,
        content: i.content,
        ignored: i.ignored,
        submitted: i.submitted,
        remoteDeadline: i.remoteDeadline ?? null,
        appliedDeadline: i.appliedDeadline ?? null,
        remoteDeadlineIsAllDay: i.remoteDeadlineIsAllDay ?? null,
        appliedDeadlineIsAllDay: i.appliedDeadlineIsAllDay ?? null,
        pendingDeadline: i.pendingDeadline
          ? {
              date: i.pendingDeadline.date ?? null,
              allDay: i.pendingDeadline.allDay,
              text: i.pendingDeadline.text,
            }
          : null,
        hasLocalPlan: state.tasks.some((p) => p.id === i.localID),
      })),
    ),
  };
}
test('exports generated teaching cases for unchanged production Swift differential validation', async () => {
  const cases: Record<string, unknown>[] = [];
  function add(
    name: string,
    prepare: (state: LibraryState, c: TeachingConnection) => void,
    current: TeachingPage,
    existing = true,
  ) {
    const { state, connection } = initial();
    if (existing) mergeTeachingAssignment(state, connection.id, activity, page(), now);
    prepare(state, connection);
    const before = structuredClone(state);
    mergeTeachingAssignment(state, connection.id, activity, current, now);
    cases.push({
      name,
      initial: before,
      state,
      connectionID: connection.id,
      activity,
      page: current,
      now,
      expected: projection(state),
    });
  }
  add('new assignment', () => {}, page(), false);
  add('automatic website deadline', () => {}, page('2026-10-27 18:00'));
  add(
    'manual title/content/execution/completion',
    (s) => {
      Object.assign(s.tasks[0], {
        title: '自定义',
        content: '我的笔记',
        hasExecutionTime: true,
        startsAt: now,
        completedAt: now,
      });
    },
    page('2026-10-27 18:00'),
  );
  add(
    'manual deadline conflict',
    (s) => {
      s.tasks[0].deadline = swiftSeconds('2026-10-25T18:00:00+08:00');
    },
    page('2026-10-29 18:00'),
  );
  add('ambiguous deadline', () => {}, page('下周一'));
  add('explicit removed deadline', () => {}, page(''));
  add('all-day deadline', () => {}, page('2026-10-26'));
  add('historical default skip', () => {}, page('2026-10-01'), false);
  add(
    'submitted included history',
    (s) => {
      (s.teachingConnections[0] as unknown as TeachingConnection).includeHistory = true;
    },
    page('2026-10-01', true),
    false,
  );
  add(
    'removed local assignment',
    (s) => {
      s.tasks = [];
    },
    page('2026-10-29'),
  );
  add(
    'retained archived assignment',
    (s) => {
      s.tasks[0].completedAt = now;
      s.tasks[0].archivedAt = now;
    },
    page('2026-10-29'),
  );
  add(
    'repeat deadline conflict',
    (s) => {
      s.tasks[0].repeatRule = { frequency: 'weekly', interval: 1 };
    },
    page('2026-10-29'),
  );
  assert.equal(cases.length, 12);
  if (process.env.TEACHSHELF_TEACHING_ROUNDTRIP)
    await fs.writeFile(
      process.env.TEACHSHELF_TEACHING_ROUNDTRIP,
      JSON.stringify({ cases }, null, 2),
    );
});
