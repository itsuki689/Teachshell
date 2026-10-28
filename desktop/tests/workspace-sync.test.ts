import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createPinia, setActivePinia } from 'pinia';
import { Repository } from '../electron/services/storage/repository.ts';
import { useLibrary } from '../src/stores/library.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function setup(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'teachshell-ui-order-')));
  const a = await Repository.open(path.join(root, 'A'), { create: true });
  const b = await Repository.open(path.join(root, 'B'), { create: true });
  t.after(async () => {
    await a.close();
    await b.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  setActivePinia(createPinia());
  const store = useLibrary();
  store.accept(a.snapshot());
  return { a, b, store };
}

test('IPC observation order is monotonic across workspaces without changing Swift JSON', async (t) => {
  const { a, b } = await setup(t);
  const first = a.snapshot(),
    next = b.snapshot();
  assert.notEqual(first.workspaceID, next.workspaceID);
  assert.ok(next.sequence > first.sequence);
  const again = a.snapshot();
  assert.ok(again.sequence > next.sequence);
  assert.equal(again.revision, first.revision);
  const disk = JSON.parse(await fs.readFile(path.join(a.root, 'library.json'), 'utf8'));
  assert.equal(disk.workspaceID, undefined);
  assert.equal(disk.sequence, undefined);
  await a.close();
  const reopened = await Repository.open(a.root);
  try {
    assert.notEqual(reopened.snapshot().workspaceID, first.workspaceID);
  } finally {
    await reopened.close();
  }
});

test('delayed mutation reply cannot roll back a newer published course or selection', async (t) => {
  const { a, store } = await setup(t);
  const gate = deferred<ReturnType<Repository['snapshot']>>();
  const pending = store.change(() => gate.promise);
  const older = await a.createCourse({ name: '早期课程' });
  const latest = await a.createCourse({ name: '后续课程' });
  store.accept(latest);
  const selected = latest.state.courses[1].id;
  await store.navigate('course:' + selected);
  gate.resolve(older);
  const result = await pending;
  assert.deepEqual(
    store.state.courses.map((c) => c.name),
    ['早期课程', '后续课程'],
  );
  assert.equal(store.courseID, selected);
  assert.equal(result?.revision, older.revision);
  assert.equal(store.snapshot?.revision, latest.revision);
  assert.equal(store.accept(older), false);
});

test('old workspace replies and errors cannot overwrite current content or notifications', async (t) => {
  const { a, b, store } = await setup(t);
  const gate = deferred<ReturnType<Repository['snapshot']>>();
  const failed = deferred<string>();
  const pending = store.change(() => gate.promise, '旧课程已保存');
  const error = store.run(() => failed.promise);
  const older = await a.createCourse({ name: '甲课程' });
  store.accept(await b.createCourse({ name: '乙课程' }));
  store.status = '当前乙资料库';
  gate.resolve(older);
  failed.reject(new Error('旧资料库错误'));
  assert.equal(await pending, undefined);
  assert.equal(await error, undefined);
  assert.deepEqual(
    store.state.courses.map((c) => c.name),
    ['乙课程'],
  );
  assert.equal(store.status, '当前乙资料库');
  assert.equal(store.error, '');
  assert.equal(store.busy, 0);
});

test('read-only loading leaves input available while writes retain their busy protection', async (t) => {
  const { store } = await setup(t);
  const reading = deferred<string>(),
    writing = deferred<string>();
  const read = store.read(() => reading.promise, '读取完成');
  assert.equal(store.reading, 1);
  assert.equal(store.busy, 0);
  const write = store.run(() => writing.promise);
  assert.equal(store.busy, 1);
  reading.resolve('read');
  assert.equal(await read, 'read');
  assert.equal(store.reading, 0);
  assert.equal(store.busy, 1);
  writing.resolve('write');
  assert.equal(await write, 'write');
  assert.equal(store.busy, 0);
});

test('unmounted and superseded reads discard both replies and errors without hiding current failures', async (t) => {
  const { store } = await setup(t);
  const old = deferred<string>(),
    failure = deferred<string>();
  let active = true;
  const read = store.read(
    () => old.promise,
    '旧读取完成',
    () => active,
  );
  const failed = store.read(
    () => failure.promise,
    '旧读取失败',
    () => active,
  );
  active = false;
  store.status = '当前页面';
  old.resolve('old');
  failure.reject(Error('旧页面错误'));
  assert.equal(await read, undefined);
  assert.equal(await failed, undefined);
  assert.equal(store.status, '当前页面');
  assert.equal(store.error, '');
  assert.equal(store.reading, 0);
  await store.read(async () => {
    throw Error('当前读取错误');
  });
  assert.equal(store.error, '当前读取错误');
  assert.equal(store.status, '操作未完成');
  assert.equal(store.reading, 0);
});

test('read replies from an old workspace do not reach the new workspace', async (t) => {
  const { b, store } = await setup(t);
  const gate = deferred<string>();
  const read = store.read(() => gate.promise, '旧库完成');
  store.accept(b.snapshot());
  store.status = '新资料库';
  gate.resolve('old');
  assert.equal(await read, undefined);
  assert.equal(store.status, '新资料库');
  assert.equal(store.reading, 0);
  assert.equal(store.busy, 0);
});

test('switching workspace dismisses confirmations and invalidates pending navigation', async (t) => {
  const { b, store } = await setup(t);
  store.registerLeaveGuard(() => store.confirm('未保存备注', '放弃草稿？'));
  const pending = store.navigate('settings');
  assert.ok(store.confirmRequest);
  store.accept(b.snapshot());
  assert.equal(await pending, false);
  assert.equal(store.confirmRequest, null);
  assert.equal(store.route, 'all');
  assert.equal(store.canGoBack, false);
});

test('navigation revalidates a course deleted while the leave confirmation is open', async (t) => {
  const { a, store } = await setup(t);
  store.accept(await a.createCourse({ name: '即将删除' }));
  const id = store.state.courses[0].id;
  const gate = deferred<boolean>();
  store.registerLeaveGuard(() => gate.promise);
  const pending = store.navigate('course:' + id);
  store.accept(await a.deleteCourse(id));
  gate.resolve(true);
  assert.equal(await pending, false);
  assert.equal(store.route, 'all');
});

test('library chooser respects unsaved changes and retains navigation when cancelled', async (t) => {
  const { store } = await setup(t);
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  let calls = 0;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      teachshelf: {
        openLibrary: async () => {
          calls++;
          return null;
        },
      },
    },
  });
  t.after(async () => {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  });
  await store.navigate('settings');
  const release = store.registerLeaveGuard(async () => false);
  await store.chooseLibrary(false);
  assert.equal(calls, 0);
  release();
  await store.chooseLibrary(false);
  assert.equal(calls, 1);
  assert.equal(store.route, 'settings');
});
