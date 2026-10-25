import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Repository } from '../electron/services/storage/repository.ts';
import { digest } from '../electron/services/storage/atomic.ts';
import { BackgroundTeachingSyncService } from '../electron/services/website/background-sync.ts';
import type {
  BackgroundClock,
  BackgroundReadiness,
  BackgroundStatus,
} from '../electron/services/website/background-sync.ts';
import { TeachingBatchService } from '../electron/services/website/batch-sync.ts';
import type { BatchCheckInput, BatchReview } from '../electron/services/website/batch-sync.ts';

class Clock implements BackgroundClock {
  time = 1_800_000_000_000;
  serial = 0;
  timers = new Map<number, { at: number; callback: () => void }>();
  now = () => this.time;
  setTimeout = (callback: () => void, delay: number) => {
    const id = ++this.serial;
    this.timers.set(id, { at: this.time + delay, callback });
    return id;
  };
  clearTimeout = (id: unknown) => {
    this.timers.delete(id as number);
  };
  async advance(ms: number) {
    const target = this.time + ms;
    for (let count = 0; count < 1000; count++) {
      const next = [...this.timers]
        .filter(([, value]) => value.at <= target)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) {
        this.time = target;
        await flush();
        return;
      }
      this.time = next[1].at;
      this.timers.delete(next[0]);
      next[1].callback();
      await flush();
    }
    throw new Error('timer loop');
  }
}
async function flush() {
  for (let i = 0; i < 15; i++) await Promise.resolve();
}
async function waitUntil(predicate: () => boolean) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail('asynchronous operation did not settle');
}
async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'background-sync-')));
  const repo = await Repository.open(path.join(root, 'Library'), { create: true });
  await repo.createCourse({ name: '数据库' });
  const course = repo.state.courses[0];
  const { connection } = await repo.connectTeachingCourse({
    courseID: course.id,
    remoteCourseID: '411',
    remoteTitle: '数据库',
    accountID: '123',
  });
  const clock = new Clock();
  let current = repo,
    readiness: BackgroundReadiness = {
      online: true,
      idle: true,
      loginState: 'signedIn',
      accountID: '123',
    };
  const reviews = (): BatchReview => ({
    id: randomUUID(),
    revision: repo.snapshot().revision,
    createdAt: clock.now(),
    expiresAt: clock.now() + 15 * 60_000,
    connectionIDs: [connection.id],
    rows: [],
    messages: [],
    skippedFiles: 0,
    unverifiedFiles: 0,
    interrupted: false,
  });
  let behavior: (input?: BatchCheckInput) => Promise<BatchReview> = async () => reviews();
  let cancelBehavior = () => {};
  const calls: BatchCheckInput[] = [],
    changes: BackgroundStatus[] = [];
  let cancels = 0;
  const options = {
    settingsRoot: path.join(root, 'Settings'),
    repository: () => current,
    batch: {
      check: (input?: BatchCheckInput) => {
        calls.push(input ?? {});
        return behavior(input);
      },
      cancel: () => {
        cancels++;
        cancelBehavior();
      },
    },
    readiness: () => readiness,
    clock,
    onChange: (value: BackgroundStatus) => changes.push(value),
  };
  const service = new BackgroundTeachingSyncService(options);
  t.after(async () => {
    await service.stop();
    await fs.rm(root, { recursive: true, force: true });
  });
  await service.start();
  return {
    root,
    repo,
    course,
    connection,
    clock,
    service,
    calls,
    changes,
    reviews,
    options,
    setBehavior: (value: typeof behavior) => {
      behavior = value;
    },
    setCancel: (value: typeof cancelBehavior) => {
      cancelBehavior = value;
    },
    setReadiness: (value: Partial<BackgroundReadiness>) => {
      readiness = { ...readiness, ...value };
      service.notifyReadinessChanged();
    },
    setRepository: (value: Repository) => {
      current = value;
    },
    get cancels() {
      return cancels;
    },
  };
}
function addRow(review: BatchReview, courseID: string) {
  review.rows.push({
    id: 'new-file',
    connectionID: review.connectionIDs[0],
    courseID,
    courseTitle: '数据库',
    activity: {
      id: '11',
      kind: 'resource',
      title: '讲义',
      sectionID: '1',
      section: '课程',
      url: 'https://selearning.nju.edu.cn/mod/resource/view.php?id=11',
    },
    kind: 'file',
    status: 'new-file',
    title: '讲义.pdf',
    detail: '等候审核',
    selectedByDefault: true,
  });
  return review;
}

test('disabled by default, persists opt-in per library, delays first check and repeats without overlap', async (t) => {
  const f = await fixture(t);
  assert.deepEqual(f.service.getStatus().preferences, { enabled: false, intervalMinutes: 30 });
  await f.clock.advance(60 * 60_000);
  assert.equal(f.calls.length, 0);
  await f.service.updatePreferences({ enabled: true, intervalMinutes: 5 });
  await f.clock.advance(29_999);
  assert.equal(f.calls.length, 0);
  await f.clock.advance(1);
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.calls[0], { connectionIDs: [f.connection.id], includeExisting: true });
  await f.clock.advance(5 * 60_000);
  assert.equal(f.calls.length, 2);
  await f.service.stop();
  await f.service.start();
  assert.equal(f.service.getStatus().preferences.enabled, true);
  await f.clock.advance(29_999);
  assert.equal(f.calls.length, 2);
  await f.clock.advance(1);
  assert.equal(f.calls.length, 3);
});

test('unknown/expired login, offline, busy, archived and different-account connections do not run', async (t) => {
  const f = await fixture(t);
  await f.service.updatePreferences({ enabled: true });
  f.setReadiness({ loginState: 'unknown', accountID: undefined });
  await f.clock.advance(60_000);
  assert.equal(f.calls.length, 0);
  f.setReadiness({ loginState: 'needsLogin' });
  await f.clock.advance(60_000);
  assert.equal(f.calls.length, 0);
  f.setReadiness({ loginState: 'signedIn', accountID: '123', online: false });
  await f.clock.advance(60_000);
  assert.equal(f.calls.length, 0);
  f.setReadiness({ online: true, idle: false });
  await f.clock.advance(60_000);
  assert.equal(f.calls.length, 0);
  f.setReadiness({ idle: true, accountID: '456' });
  await f.clock.advance(60_000);
  assert.equal(f.calls.length, 0);
  await f.repo.updateCourse(f.course.id, { isArchived: true });
  f.setReadiness({ accountID: '123' });
  await f.clock.advance(60_000);
  assert.equal(f.calls.length, 0);
  await f.repo.updateCourse(f.course.id, { isArchived: false });
  f.service.notifyReadinessChanged();
  await flush();
  assert.equal(f.calls.length, 1);
});

test('restored cookie allows one read-only identity probe; own checking/renewing transitions do not cancel', async (t) => {
  const f = await fixture(t);
  f.setReadiness({ loginState: 'unknown', accountID: undefined, allowSessionProbe: true });
  f.setBehavior(async () => {
    f.setReadiness({ loginState: 'checking' });
    await flush();
    f.setReadiness({ loginState: 'renewing' });
    await flush();
    f.setReadiness({ loginState: 'signedIn', accountID: '123', allowSessionProbe: false });
    return addRow(f.reviews(), f.course.id);
  });
  await f.service.updatePreferences({ enabled: true });
  await f.clock.advance(30_000);
  await flush();
  assert.equal(f.calls.length, 1);
  assert.equal(f.cancels, 0);
  assert.equal(f.service.getStatus().phase, 'review');
});

test('restored cookie without verified identity never produces a review or a tight retry loop', async (t) => {
  const f = await fixture(t);
  f.setReadiness({ loginState: 'unknown', accountID: undefined, allowSessionProbe: true });
  f.setBehavior(async () => addRow(f.reviews(), f.course.id));
  await f.service.updatePreferences({ enabled: true });
  await f.clock.advance(30_000);
  assert.equal(f.calls.length, 1);
  assert.equal(f.service.getStatus().review, undefined);
  assert.equal(f.service.getStatus().phase, 'backoff');
  assert.equal(f.service.getStatus().failureCount, 1);
});

test('pending review blocks checks until expiry; expiry clears stale review and uses the normal interval', async (t) => {
  const f = await fixture(t);
  f.setBehavior(async () => addRow(f.reviews(), f.course.id));
  await f.service.updatePreferences({ enabled: true });
  await f.clock.advance(30_000);
  const id = f.service.getStatus().review!.id;
  await f.clock.advance(14 * 60_000);
  assert.equal(f.calls.length, 1);
  await f.clock.advance(60_000);
  assert.equal(f.service.getStatus().review, undefined);
  assert.equal(f.calls.length, 1);
  await f.clock.advance(15 * 60_000);
  assert.equal(f.calls.length, 2);
  assert.notEqual(f.service.getStatus().review!.id, id);
});

test('disabled polling still expires a manual review and never starts a background check', async (t) => {
  const f = await fixture(t);
  const review = addRow(f.reviews(), f.course.id);
  f.service.setReview(review);
  assert.equal(f.service.getStatus().phase, 'disabled');
  assert.equal(f.service.getStatus().review?.id, review.id);
  await f.clock.advance(15 * 60_000 - 1);
  assert.equal(f.service.getStatus().review?.id, review.id);
  await f.clock.advance(1);
  assert.equal(f.service.getStatus().review, undefined);
  assert.equal(f.service.getStatus().phase, 'disabled');
  assert.equal(f.calls.length, 0);
  assert.equal(f.changes.at(-1)?.review, undefined);
});

test('foreground pauses await background cancellation, preserve remaining review, and never cancel a foreground operation', async (t) => {
  const f = await fixture(t);
  let resolve!: (value: BatchReview) => void;
  f.setBehavior(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  f.setCancel(() => resolve(addRow(f.reviews(), f.course.id)));
  await f.service.updatePreferences({ enabled: true });
  await f.clock.advance(30_000);
  assert.equal(f.service.getStatus().phase, 'checking');
  await f.clock.advance(60 * 60_000);
  assert.equal(f.calls.length, 1);
  await f.service.pauseForForeground();
  assert.equal(f.cancels, 1);
  assert.equal(f.service.getStatus().review, undefined);
  await f.service.pauseForForeground();
  assert.equal(f.cancels, 1);
  const manual = addRow(f.reviews(), f.course.id);
  f.service.resumeAfterForeground(manual);
  assert.equal(f.service.getStatus().review!.id, manual.id);
  f.service.setReview(undefined);
  assert.equal(f.service.getStatus().phase, 'waiting');
  await f.service.stop();
  assert.equal(f.cancels, 1);
});

test('switching library cancels active work and ignores late success; settings remain isolated', async (t) => {
  const f = await fixture(t);
  let resolve!: (value: BatchReview) => void;
  f.setBehavior(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  f.setCancel(() => resolve(addRow(f.reviews(), f.course.id)));
  await f.service.updatePreferences({ enabled: true });
  await f.clock.advance(30_000);
  await f.service.stop();
  const other = await Repository.open(path.join(f.root, 'Other'), { create: true });
  f.setRepository(other);
  await f.service.start();
  assert.equal(f.service.getStatus().preferences.enabled, false);
  assert.equal(f.service.getStatus().review, undefined);
  assert.equal(f.cancels, 1);
  assert.equal(
    f.changes.some((value) => value.phase === 'review'),
    false,
  );
});

test('disabling during a check cancels it and does not publish late review', async (t) => {
  const f = await fixture(t);
  let resolve!: (value: BatchReview) => void;
  f.setBehavior(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  f.setCancel(() => resolve(addRow(f.reviews(), f.course.id)));
  await f.service.updatePreferences({ enabled: true });
  await f.clock.advance(30_000);
  await f.service.updatePreferences({ enabled: false });
  assert.equal(f.cancels, 1);
  assert.equal(f.service.getStatus().phase, 'disabled');
  assert.equal(f.service.getStatus().review, undefined);
});

test('network failures and all-error discovery back off exponentially with a six-hour cap', async (t) => {
  const f = await fixture(t);
  let attempt = 0;
  f.setBehavior(async () => {
    if (++attempt === 1) throw new Error('network unavailable');
    return {
      ...f.reviews(),
      messages: [{ connectionID: f.connection.id, text: '页面加载失败', isIssue: true }],
    };
  });
  await f.service.updatePreferences({ enabled: true, intervalMinutes: 120 });
  await f.clock.advance(30_000);
  assert.equal(f.service.getStatus().nextCheckAt! - f.clock.now(), 120 * 60_000);
  await f.clock.advance(120 * 60_000);
  assert.equal(f.service.getStatus().nextCheckAt! - f.clock.now(), 240 * 60_000);
  await f.clock.advance(240 * 60_000);
  assert.equal(f.service.getStatus().nextCheckAt! - f.clock.now(), 360 * 60_000);
  f.setBehavior(async () => f.reviews());
  await f.clock.advance(360 * 60_000);
  assert.equal(f.service.getStatus().failureCount, 0);
  assert.equal(f.service.getStatus().phase, 'waiting');
});

test('long user intervals are never shortened by the backoff cap and wakeup does not replay missed polls', async (t) => {
  const f = await fixture(t);
  f.setBehavior(async () => {
    throw new Error('offline');
  });
  await f.service.updatePreferences({ enabled: true, intervalMinutes: 1440 });
  await f.clock.advance(30_000);
  assert.equal(f.service.getStatus().nextCheckAt! - f.clock.now(), 1440 * 60_000);
  f.setBehavior(async () => f.reviews());
  f.clock.time += 7 * 24 * 60 * 60_000;
  f.service.notifyReadinessChanged();
  await flush();
  assert.equal(f.calls.length, 2);
  assert.equal(f.service.getStatus().nextCheckAt! - f.clock.now(), 1440 * 60_000);
});

test('partial errors remain visible alongside successful review rows without automatic apply', async (t) => {
  const f = await fixture(t);
  f.setBehavior(async () => ({
    ...addRow(f.reviews(), f.course.id),
    messages: [{ connectionID: f.connection.id, text: '另一活动暂时不可用', isIssue: true }],
  }));
  await f.service.updatePreferences({ enabled: true });
  await f.clock.advance(30_000);
  assert.equal(f.service.getStatus().phase, 'review');
  assert.equal(f.service.getStatus().review!.messages[0].isIssue, true);
  assert.equal(f.service.getStatus().failureCount, 0);
  assert.equal(f.repo.state.materials.length, 0);
  assert.equal(f.repo.state.tasks.length, 0);
});

test('account change cancels active work and invalidates an unreviewed result', async (t) => {
  const f = await fixture(t);
  let resolve!: (value: BatchReview) => void;
  f.setBehavior(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  f.setCancel(() => resolve(addRow(f.reviews(), f.course.id)));
  await f.service.updatePreferences({ enabled: true });
  await f.clock.advance(30_000);
  f.setReadiness({ accountID: '456' });
  await flush();
  assert.equal(f.cancels, 1);
  assert.equal(f.service.getStatus().review, undefined);
  f.setReadiness({ accountID: '123' });
  await f.service.pauseForForeground();
  f.service.resumeAfterForeground(addRow(f.reviews(), f.course.id));
  f.setReadiness({ loginState: 'needsLogin', accountID: undefined });
  assert.equal(f.service.getStatus().review, undefined);
  assert.equal(f.service.getStatus().phase, 'blocked');
});

test('configuration validation, concurrent partial updates, and corrupt-file preservation', async (t) => {
  const f = await fixture(t);
  await assert.rejects(f.service.updatePreferences({ intervalMinutes: 0 }));
  await assert.rejects(f.service.updatePreferences({ enabled: 'true' } as never));
  await assert.rejects(f.service.updatePreferences({ extra: true } as never));
  await Promise.all([
    f.service.updatePreferences({ enabled: true }),
    f.service.updatePreferences({ intervalMinutes: 15 }),
  ]);
  assert.deepEqual(f.service.getStatus().preferences, { enabled: true, intervalMinutes: 15 });
  const file = path.join(f.options.settingsRoot, `background-sync-${digest(f.repo.root)}.json`);
  assert.deepEqual(JSON.parse(await fs.readFile(file, 'utf8')), {
    version: 1,
    enabled: true,
    intervalMinutes: 15,
  });
  await f.service.stop();
  await fs.writeFile(file, '{invalid');
  await f.service.start();
  assert.equal(f.service.getStatus().phase, 'error');
  await f.clock.advance(60 * 60_000);
  assert.equal(f.calls.length, 0);
  assert.equal(await fs.readFile(file, 'utf8'), '{invalid');
});

test('preferences refuse a symlink without reading or overwriting its target', async (t) => {
  const f = await fixture(t);
  const target = path.join(f.root, 'outside.json');
  const bytes = '{"version":1,"enabled":true,"intervalMinutes":5}';
  await fs.writeFile(target, bytes);
  await f.service.stop();
  const file = path.join(f.options.settingsRoot, `background-sync-${digest(f.repo.root)}.json`);
  await fs.symlink(target, file);
  await f.service.start();
  assert.equal(f.service.getStatus().phase, 'error');
  await assert.rejects(f.service.updatePreferences({ enabled: false }));
  assert.equal(await fs.readFile(target, 'utf8'), bytes);
});

test('real batch discovery matches Swift no-download/no-mutation sample and hands off a review', async (t) => {
  const f = await fixture(t);
  await f.service.stop();
  const requests: string[] = [];
  const batch = new TeachingBatchService({
    repository: () => f.repo,
    cacheRoot: path.join(f.root, 'Cache'),
    now: f.clock.now,
    transport: () => ({
      async readTeaching(url) {
        requests.push(url);
        const course = url.includes('/course/');
        return {
          url,
          title: '数据库',
          data: {
            kind: course ? 'course' : 'assign',
            accountID: '123',
            courseID: '411',
            title: '数据库',
            activities: course
              ? [
                  {
                    id: '5302',
                    kind: 'assign',
                    title: '作业09',
                    sectionID: '2',
                    section: '作业',
                    url: 'https://selearning.nju.edu.cn/mod/assign/view.php?id=5302',
                  },
                ]
              : [],
            files: course
              ? []
              : [
                  {
                    key: 'notes.txt',
                    name: 'notes.txt',
                    subfolders: [],
                    url: 'https://selearning.nju.edu.cn/pluginfile.php/1/mod_assign/introattachment/0/notes.txt',
                  },
                ],
            intro: '完成第九题',
            deadlineText: course ? '' : '2099-10-26 18:00',
            submitted: false,
          },
        };
      },
      fetch: (async () => {
        assert.fail('background check downloaded an attachment');
      }) as typeof fetch,
    }),
  });
  const service = new BackgroundTeachingSyncService({ ...f.options, batch });
  t.after(() => service.stop());
  const before = await fs.readFile(path.join(f.repo.root, 'library.json'), 'utf8');
  await service.start();
  await service.updatePreferences({ enabled: true });
  await f.clock.advance(30_000);
  await waitUntil(() => service.getStatus().phase !== 'checking');
  assert.equal(service.getStatus().phase, 'review');
  assert.equal(service.getStatus().review?.rows.length, 2);
  assert.deepEqual(
    requests.map((url) => new URL(url).pathname),
    ['/course/view.php', '/mod/assign/view.php', '/course/view.php'],
  );
  assert.equal(f.repo.state.materials.length, 0);
  assert.equal(f.repo.state.tasks.length, 0);
  assert.equal(await fs.readFile(path.join(f.repo.root, 'library.json'), 'utf8'), before);
});
