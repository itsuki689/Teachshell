import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Repository } from '../electron/services/storage/repository.ts';
import { TeachingBatchService } from '../electron/services/website/batch-sync.ts';
import type { TeachingBatchTransport } from '../electron/services/website/batch-sync.ts';
import type { TeachingActivity, TeachingPage } from '../electron/services/website/teaching.ts';
import { getTeachingConnection } from '../electron/services/website/teaching.ts';
import { resourceHead } from '../electron/services/website/resource-head.ts';

const resource: TeachingActivity = {
  id: '11',
  kind: 'resource',
  title: '讲义',
  sectionID: '1',
  section: '课程',
  url: 'https://selearning.nju.edu.cn/mod/resource/view.php?id=11',
};
const assignment: TeachingActivity = {
  id: '12',
  kind: 'assign',
  title: '作业',
  sectionID: '1',
  section: '课程',
  url: 'https://selearning.nju.edu.cn/mod/assign/view.php?id=12',
};
const files = ['first.txt', 'second.txt'].map((name) => ({
  key: name,
  name,
  url: 'https://selearning.nju.edu.cn/pluginfile.php/1/mod_resource/content/0/' + name,
  subfolders: [],
}));
const page = (kind: TeachingPage['kind']): TeachingPage => ({
  kind,
  accountID: '123',
  courseID: '411',
  title: kind === 'course' ? '课程' : '教学内容',
  activities: kind === 'course' ? [resource, assignment] : [],
  files: kind === 'resource' ? files : [],
  intro: '阅读教材',
  deadlineText: kind === 'assign' ? '2099-01-01 18:00' : '',
  submitted: false,
});
async function fixture() {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'teaching-batch-')));
  const repo = await Repository.open(path.join(root, 'Library'), { create: true });
  await repo.createCourse({ name: '课程' });
  const courseID = repo.state.courses[0].id;
  const { connection } = await repo.connectTeachingCourse({
    courseID,
    remoteCourseID: '411',
    remoteTitle: '课程',
    accountID: '123',
  });
  const pages = { course: page('course'), resource: page('resource'), assign: page('assign') };
  const requests: string[] = [],
    reads: string[] = [],
    fail = new Set<string>();
  let now = Date.now(),
    active = repo,
    account = '123',
    onFetch: undefined | (() => Promise<void>),
    waitFetch = false,
    cancelled = false;
  const transport: TeachingBatchTransport = {
    async readTeaching(raw, _expected, signal) {
      signal.throwIfAborted();
      reads.push(raw);
      const kind = raw.includes('/course/')
        ? 'course'
        : raw.includes('/resource/')
          ? 'resource'
          : 'assign';
      return {
        url: raw,
        title: '课程',
        data: { ...structuredClone(pages[kind]), accountID: account },
      };
    },
    fetch: (async (raw, init) => {
      requests.push(String(raw));
      await onFetch?.();
      if (waitFetch)
        await new Promise<void>((_resolve, reject) => {
          if (init?.signal?.aborted) reject(init.signal.reason);
          else
            init?.signal?.addEventListener('abort', () => reject(init.signal!.reason), {
              once: true,
            });
        });
      if (fail.has(String(raw))) throw new Error('临时网络失败');
      return new Response('website bytes', {
        headers: { 'content-type': 'application/octet-stream' },
      });
    }) as typeof fetch,
    cancelTeaching() {
      cancelled = true;
    },
  };
  const cacheRoot = path.join(root, 'Cache');
  const service = new TeachingBatchService({
    repository: () => active,
    transport: () => transport,
    cacheRoot,
    now: () => now,
  });
  return {
    root,
    repo,
    courseID,
    connection,
    pages,
    requests,
    reads,
    fail,
    service,
    cacheRoot,
    setAccount: (v: string) => (account = v),
    setFetch: (v: typeof onFetch) => (onFetch = v),
    setWait: () => (waitFetch = true),
    setRepo: (v: Repository) => (active = v),
    expire: () => (now += 16 * 60000),
    isCancelled: () => cancelled,
    cleanup: async () => {
      service.clear();
      await repo.close();
      await fs.rm(root, { recursive: true, force: true });
    },
  };
}

test('whole-course inspection is read-only, stable and downloads only selected files before plans', async () => {
  const f = await fixture();
  try {
    const before = await fs.readFile(path.join(f.repo.root, 'library.json'), 'utf8');
    const review = await f.service.check();
    assert.equal(review.rows.length, 3);
    assert.equal(f.requests.length, 0);
    assert.equal(await fs.readFile(path.join(f.repo.root, 'library.json'), 'utf8'), before);
    const again = await f.service.check();
    assert.deepEqual(
      again.rows.map((r) => r.id),
      review.rows.map((r) => r.id),
    );
    const chosen = [again.rows[0].id, again.rows.find((r) => r.kind === 'plan')!.id];
    const applied = await f.service.apply({ reviewID: again.id, selectedIDs: chosen });
    assert.equal(applied.downloaded, 1);
    assert.equal(
      applied.results.every((r) => r.success),
      true,
    );
    assert.equal(applied.review.rows.length, 1);
    assert.equal(f.repo.state.materials.length, 1);
    assert.equal(f.repo.state.tasks.length, 1);
    assert.equal(f.requests[0], files[0].url);
    assert.ok(getTeachingConnection(f.repo.state, f.connection.id).lastSyncAt);
    assert.equal(getTeachingConnection(f.repo.state, f.connection.id).messages.length, 2);
    assert.deepEqual(await fs.readdir(f.cacheRoot), []);
    const refreshed = await f.service.check();
    const existing = refreshed.rows.find((r) => r.status === 'verify-file')!;
    assert.ok(existing);
    assert.equal(existing.selectedByDefault, false);
    assert.equal(refreshed.unverifiedFiles, 1);
  } finally {
    await f.cleanup();
  }
});

test('partial network failures preserve failed rows and retry never repeats successful work', async () => {
  const f = await fixture();
  try {
    f.fail.add(files[0].url);
    const review = await f.service.check();
    const result = await f.service.apply({
      reviewID: review.id,
      selectedIDs: review.rows.map((r) => r.id),
    });
    assert.equal(result.results.filter((r) => r.success).length, 2);
    assert.equal(result.review.rows.length, 1);
    assert.match(result.review.rows[0].error!, /网络/);
    const successRequests = f.requests.filter((u) => u === files[1].url).length;
    f.fail.clear();
    const retry = await f.service.apply({
      reviewID: review.id,
      selectedIDs: result.review.rows.map((r) => r.id),
    });
    assert.equal(retry.review.rows.length, 0);
    assert.equal(f.repo.state.materials.length, 2);
    assert.equal(f.requests.filter((u) => u === files[1].url).length, successRequests);
  } finally {
    await f.cleanup();
  }
});

test('local revision edits, expiry and connection changes reject stale approval before downloading', async () => {
  const f = await fixture();
  try {
    let review = await f.service.check();
    await f.repo.updateCourse(f.courseID, { teacher: '本地编辑' });
    await assert.rejects(
      f.service.apply({ reviewID: review.id, selectedIDs: [review.rows[0].id] }),
      /revision_conflict/,
    );
    assert.equal(f.requests.length, 0);
    review = await f.service.check();
    await f.repo.updateTeachingOptions(f.connection.id, { includeMaterials: false });
    await assert.rejects(
      f.service.apply({ reviewID: review.id, selectedIDs: [review.rows[0].id] }),
      /revision_conflict/,
    );
    review = await f.service.check();
    f.expire();
    await assert.rejects(
      f.service.apply({ reviewID: review.id, selectedIDs: review.rows.map((r) => r.id) }),
      /过期/,
    );
  } finally {
    await f.cleanup();
  }
});

test('account switch and page mutation during download discard bytes before committing', async () => {
  const f = await fixture();
  try {
    const review = await f.service.check();
    f.setFetch(async () => f.setAccount('456'));
    const result = await f.service.apply({ reviewID: review.id, selectedIDs: [review.rows[0].id] });
    assert.equal(result.interrupted, true);
    assert.match(result.results[0].message, /账号/);
    assert.equal(f.repo.state.materials.length, 0);
    assert.deepEqual(await fs.readdir(f.cacheRoot), []);
    f.setAccount('123');
    f.setFetch(async () => {
      f.pages.resource.title = '远端改变';
    });
    const retried = await f.service.apply({
      reviewID: review.id,
      selectedIDs: [review.rows[0].id],
    });
    assert.equal(retried.results[0].success, false);
    assert.match(retried.results[0].message, /内容已变化/);
    assert.equal(f.repo.state.materials.length, 0);
  } finally {
    await f.cleanup();
  }
});

test('an edit racing selected downloads is checked again inside the writer transaction', async () => {
  const f = await fixture();
  try {
    const review = await f.service.check();
    f.setFetch(() => f.repo.updateCourse(f.courseID, { teacher: '下载期间修改' }).then(() => {}));
    const result = await f.service.apply({
      reviewID: review.id,
      selectedIDs: review.rows.map((r) => r.id),
    });
    assert.equal(result.interrupted, true);
    assert.match(result.results[0].message, /revision_conflict/);
    assert.equal(f.repo.state.materials.length, 0);
    assert.equal(f.repo.state.tasks.length, 0);
  } finally {
    await f.cleanup();
  }
});

test('cancel and clear abort active network requests and cannot commit to a switched library', async () => {
  const f = await fixture();
  let other: Repository | undefined;
  try {
    const review = await f.service.check();
    f.setWait();
    const operation = f.service.apply({ reviewID: review.id, selectedIDs: [review.rows[0].id] });
    while (!f.requests.length) await new Promise((r) => setTimeout(r, 1));
    other = await Repository.open(path.join(f.root, 'Other'), { create: true });
    f.setRepo(other);
    f.service.clear();
    const result = await operation;
    assert.equal(result.interrupted, true);
    assert.equal(f.isCancelled(), true);
    assert.equal(f.repo.state.materials.length, 0);
    assert.equal(other.state.materials.length, 0);
    await assert.rejects(
      f.service.apply({ reviewID: review.id, selectedIDs: [review.rows[0].id] }),
      /过期/,
    );
  } finally {
    await other?.close();
    await f.cleanup();
  }
});

test('missing files need explicit selection and removed mappings never reappear', async () => {
  const f = await fixture();
  try {
    let review = await f.service.check();
    await f.service.apply({ reviewID: review.id, selectedIDs: [review.rows[0].id] });
    const m = f.repo.state.materials[0];
    await fs.unlink(await f.repo.resolveMaterial(m.id));
    await f.repo.sync();
    review = await f.service.check();
    const missing = review.rows.find((r) => r.status === 'missing-file')!;
    assert.ok(missing);
    assert.equal(missing.selectedByDefault, false);
    const repaired = await f.service.apply({ reviewID: review.id, selectedIDs: [missing.id] });
    assert.equal(repaired.results[0].success, true);
    const current = getTeachingConnection(f.repo.state, f.connection.id).items.find(
      (i) => i.id === 'file:resource:11:first.txt',
    )!.localID!;
    await f.repo.removeMaterials([current]);
    review = await f.service.check();
    assert.equal(
      review.rows.some((r) => r.file?.key === 'first.txt'),
      false,
    );
  } finally {
    await f.cleanup();
  }
});

test('locally edited bytes require a second explicit approval and remain in history', async () => {
  const f = await fixture();
  try {
    let review = await f.service.check();
    await f.service.apply({ reviewID: review.id, selectedIDs: [review.rows[0].id] });
    const original = f.repo.state.materials[0],
      originalPath = await f.repo.resolveMaterial(original.id);
    await fs.writeFile(originalPath, 'local changes');
    await f.repo.sync();
    review = await f.service.check();
    const row = review.rows.find((r) => r.file?.key === 'first.txt')!;
    const blocked = await f.service.apply({ reviewID: review.id, selectedIDs: [row.id] });
    assert.equal(blocked.results[0].status, 'local-modified');
    assert.equal(blocked.review.rows.find((r) => r.id === row.id)?.status, 'local-modified');
    assert.equal(await fs.readFile(originalPath, 'utf8'), 'local changes');
    const accepted = await f.service.apply({
      reviewID: review.id,
      selectedIDs: [row.id],
      adoptLocalFileIDs: [row.id],
    });
    assert.equal(accepted.results[0].success, true);
    assert.equal(
      await fs.readFile(await f.repo.resolveMaterial(original.id), 'utf8'),
      'local changes',
    );
  } finally {
    await f.cleanup();
  }
});

test('deadline conflicts require an explicit choice and resolve within the plan transaction', async () => {
  const f = await fixture();
  try {
    let review = await f.service.check();
    await f.service.apply({
      reviewID: review.id,
      selectedIDs: [review.rows.find((r) => r.kind === 'plan')!.id],
    });
    const task = f.repo.state.tasks[0];
    await f.repo.savePlan({
      ...task,
      deadline: (task.deadline as number) + 3600,
      title: '人工题目',
    });
    f.pages.assign.deadlineText = '2099-01-02 18:00';
    review = await f.service.check();
    const row = review.rows.find((r) => r.kind === 'plan')!;
    assert.equal(row.status, 'deadline-conflict');
    await assert.rejects(f.service.apply({ reviewID: review.id, selectedIDs: [row.id] }), /请选择/);
    const result = await f.service.apply({
      reviewID: review.id,
      selectedIDs: [row.id],
      deadlineChoices: { [row.id]: false },
    });
    assert.equal(result.results[0].success, true);
    assert.equal(f.repo.state.tasks[0].deadline, (task.deadline as number) + 3600);
    assert.equal(f.repo.state.tasks[0].title, '人工题目');
    assert.equal(
      getTeachingConnection(f.repo.state, f.connection.id).items.find((i) => i.id === 'plan:12')
        ?.pendingDeadline,
      undefined,
    );
  } finally {
    await f.cleanup();
  }
});

test('resource direct-download discovery uses HEAD only and rejects login/foreign redirects', async () => {
  const calls: { url: string; method: unknown }[] = [];
  const fetcher = (async (url, init) => {
    calls.push({ url: String(url), method: init?.method });
    return String(url) === resource.url
      ? new Response(null, { status: 302, headers: { location: files[0].url } })
      : new Response(null, {
          headers: {
            'content-type': 'application/octet-stream',
            'content-disposition': "attachment; filename*=UTF-8''%E8%AF%BE%E7%A8%8B.txt",
          },
        });
  }) as typeof fetch;
  const value = await resourceHead(fetcher, resource.url, new AbortController().signal);
  assert.equal(value?.name, '课程.txt');
  assert.deepEqual(
    calls.map((c) => c.method),
    ['HEAD', 'HEAD'],
  );
  for (const target of ['https://evil.test/file', 'https://selearning.nju.edu.cn/login/index.php'])
    await assert.rejects(
      resourceHead(
        (async () =>
          new Response(null, { status: 302, headers: { location: target } })) as typeof fetch,
        resource.url,
        new AbortController().signal,
      ),
    );
});

test('attachment transactions precede their assignment and the resulting plan links imported materials', async () => {
  const f = await fixture();
  try {
    f.pages.resource.files = [];
    f.pages.assign.files = [files[0]];
    const review = await f.service.check();
    const result = await f.service.apply({
      reviewID: review.id,
      selectedIDs: [...review.rows].reverse().map((r) => r.id),
    });
    assert.equal(result.results[0].status, 'added');
    assert.equal(result.results[1].status, 'applied');
    assert.deepEqual(f.repo.state.tasks[0].materialIDs, [f.repo.state.materials[0].id]);
  } finally {
    await f.cleanup();
  }
});

test('failed selected assignment attachments retain the plan until retry commits all links exactly once', async () => {
  const f = await fixture();
  try {
    f.pages.resource.files = [];
    f.pages.assign.files = [files[0]];
    f.fail.add(files[0].url);
    const review = await f.service.check();
    const first = await f.service.apply({
      reviewID: review.id,
      selectedIDs: review.rows.map((row) => row.id),
    });
    assert.equal(first.review.rows.length, 2);
    assert.equal(
      first.results.find((result) => result.id.endsWith(':plan:12'))?.status,
      'waiting-attachments',
    );
    assert.equal(f.repo.state.tasks.length, 0);
    assert.equal(f.repo.state.materials.length, 0);
    const incomplete = getTeachingConnection(f.repo.state, f.connection.id);
    assert.equal(incomplete.lastSyncAt, undefined);
    assert.equal(incomplete.messages.length, 2);
    assert.ok(incomplete.messages.every((note) => note.isIssue));
    f.fail.clear();
    const retried = await f.service.apply({
      reviewID: review.id,
      selectedIDs: first.review.rows.map((row) => row.id),
    });
    assert.equal(retried.review.rows.length, 0);
    assert.equal(
      retried.results.every((result) => result.success),
      true,
    );
    assert.equal(f.repo.state.tasks.length, 1);
    assert.equal(f.repo.state.materials.length, 1);
    assert.deepEqual(f.repo.state.tasks[0].materialIDs, [f.repo.state.materials[0].id]);
    const complete = getTeachingConnection(f.repo.state, f.connection.id);
    assert.ok(complete.lastSyncAt);
    assert.equal(complete.messages.length, 2);
    assert.ok(complete.messages.every((note) => !note.isIssue));
    await assert.rejects(
      f.service.apply({ reviewID: review.id, selectedIDs: first.review.rows.map((row) => row.id) }),
      /请选择/,
    );
    assert.equal(f.repo.state.tasks.length, 1);
  } finally {
    await f.cleanup();
  }
});

test('an unselected attachment never blocks its selected plan and only selected contents are linked', async () => {
  const f = await fixture();
  try {
    f.pages.resource.files = [];
    f.pages.assign.files = files;
    f.fail.add(files[1].url);
    const review = await f.service.check();
    const result = await f.service.apply({
      reviewID: review.id,
      selectedIDs: review.rows
        .filter((row) => row.kind === 'plan' || row.file?.key === files[0].key)
        .map((row) => row.id),
    });
    assert.equal(
      result.results.every((row) => row.success),
      true,
    );
    assert.equal(result.review.rows.length, 1);
    assert.equal(result.review.rows[0].file?.key, files[1].key);
    assert.equal(f.requests.includes(files[1].url), false);
    assert.equal(f.repo.state.tasks.length, 1);
    assert.deepEqual(f.repo.state.tasks[0].materialIDs, [f.repo.state.materials[0].id]);
  } finally {
    await f.cleanup();
  }
});

test('a failed course does not discard other sources and mismatched accounts never yield review rows', async () => {
  const f = await fixture();
  try {
    await f.repo.createCourse({ name: '无法访问课程' });
    const courseID = f.repo.state.courses.find((c) => c.name === '无法访问课程')!.id;
    await f.repo.connectTeachingCourse({
      courseID,
      remoteCourseID: '999',
      remoteTitle: '无法访问课程',
      accountID: '123',
    });
    const before = await fs.readFile(path.join(f.repo.root, 'library.json'), 'utf8');
    const review = await f.service.check();
    assert.equal(review.connectionIDs.length, 2);
    assert.equal(review.rows.length, 3);
    assert.ok(review.messages.some((m) => /课程页面/.test(m.text)));
    assert.equal(f.requests.length, 0);
    assert.equal(await fs.readFile(path.join(f.repo.root, 'library.json'), 'utf8'), before);
    f.setAccount('456');
    const mismatch = await f.service.check();
    assert.equal(mismatch.rows.length, 0);
    assert.ok(mismatch.messages.every((m) => /账号/.test(m.text)));
  } finally {
    await f.cleanup();
  }
});
