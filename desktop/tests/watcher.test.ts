import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter, once } from 'node:events';
import type { watch as NativeWatch } from 'node:fs';
import { watchLibrary, watchMacLibrary } from '../electron/services/filesystem/watch.ts';
import { Repository } from '../electron/services/storage/repository.ts';

// Exercise the Windows polling backend on every host, plus the host's default.
for (const platform of new Set([process.platform, 'win32' as const]))
  test(`active ${platform} watcher permits nested course renames and observes external moves`, async (t) => {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'teachshell-watch-')));
    const repo = await Repository.open(path.join(root, 'library'), { create: true });
    let watcher: ReturnType<typeof watchLibrary> | undefined;
    let pending: ReturnType<typeof setTimeout> | undefined;
    let sync = Promise.resolve();
    t.after(async () => {
      await watcher?.close();
      clearTimeout(pending);
      await sync;
      await repo.close();
      await fs.rm(root, { recursive: true, force: true });
    });
    await repo.createCourse({ name: '原课程' });
    const course = repo.state.courses[0];
    const source = path.join(root, '资料.txt');
    await fs.writeFile(source, 'source bytes');
    await repo.importFiles([source], { courseID: course.id });
    const materialID = repo.state.materials[0].id;
    watcher = watchLibrary(repo.root, platform);
    const seen: string[] = [];
    const errors: Error[] = [];
    watcher.on('all', (_event, file) => {
      seen.push(file);
      clearTimeout(pending);
      pending = setTimeout(() => {
        sync = sync
          .then(() => repo.sync())
          .then(() => {})
          .catch((error) => {
            errors.push(error);
          });
      }, 100);
    });
    watcher.on('error', (e) => errors.push(e as Error));
    await once(watcher, 'ready');
    // Fault injection for the previous Chokidar backend: keep the parent's scan
    // open past its 1000ms readdir throttle. The native recursive backend has no
    // directory scan/registration gap, but runs the same filesystem operations.
    let releaseScan: (() => void) | undefined;
    const legacy = watcher as unknown as { _readdirp?: (...args: any[]) => any };
    if (platform === 'darwin' && legacy._readdirp) {
      const read = legacy._readdirp.bind(watcher);
      let armed = true;
      legacy._readdirp = (directory, ...args) => {
        const stream = read(directory, ...args);
        if (armed && directory === path.join(repo.root, 'files')) {
          armed = false;
          const emit = stream.emit.bind(stream);
          stream.emit = (event: string, ...values: unknown[]) => {
            if (event === 'end') {
              releaseScan = () => emit(event, ...values);
              return true;
            }
            return emit(event, ...values);
          };
        }
        return stream;
      };
    }
    t.after(() => releaseScan?.());
    await repo.updateCourse(course.id, { name: '内部改名' });
    const first = path.join(repo.root, repo.state.courses[0].storageDirectory!);
    const second = path.join(path.dirname(first), '外部改名 [' + course.id + ']');
    // An addDir notification does not mean its descendants have been registered.
    // Rename immediately and assert business convergence, not a platform event spelling.
    const until = async (predicate: () => boolean) => {
      for (let i = 0; i < 100 && !predicate(); i++)
        await new Promise((resolve) => setTimeout(resolve, 50));
      assert.ok(
        predicate(),
        `watcher failed to reconcile: ${JSON.stringify({ seen, errors: errors.map(String), courses: repo.state.courses })}`,
      );
    };
    if (platform === 'darwin' && legacy._readdirp) await until(() => seen.includes(first));
    await fs.rename(first, second);
    if (platform === 'darwin') {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      releaseScan?.();
    }
    await until(() => repo.state.courses[0].name === '外部改名');
    assert.equal(repo.state.courses[0].id, course.id);
    assert.equal(repo.state.courses[0].name, '外部改名');
    assert.equal(repo.state.materials[0].id, materialID);
    assert.equal(await fs.readFile(await repo.resolveMaterial(materialID), 'utf8'), 'source bytes');
    assert.equal(await fs.readFile(source, 'utf8'), 'source bytes');
    // The moved directory must still be watched after the original events settle.
    // Unknown files are intentionally not auto-imported; move the registered material.
    const nested = path.join(second, '资料', '后续目录-é-🌊');
    await fs.mkdir(nested);
    const late = path.join(nested, '后续资料.txt');
    await fs.rename(await repo.resolveMaterial(materialID), late);
    await until(
      () => repo.state.materials.find((m) => m.id === materialID)?.originalName === '后续资料.txt',
    );
    const renamed = path.join(nested, '再次改名.txt');
    await fs.rename(late, renamed);
    await until(
      () => repo.state.materials.find((m) => m.id === materialID)?.originalName === '再次改名.txt',
    );
    assert.equal(await fs.readFile(await repo.resolveMaterial(materialID), 'utf8'), 'source bytes');
    assert.equal(repo.state.materials.length, 1);
    assert.deepEqual(errors, []);
  });

test('macOS registers before ready, handles nameless events and ignores index/hidden paths', async () => {
  const handle = new EventEmitter() as EventEmitter & { close(): void };
  let closes = 0;
  handle.close = () => {
    closes++;
  };
  let notify!: (event: string, filename: string | Buffer | null) => void;
  const root = path.resolve('library');
  const watcher = watchMacLibrary(root, ((directory, options, listener) => {
    assert.equal(directory, root);
    assert.deepEqual(options, { recursive: true });
    notify = listener;
    return handle;
  }) as typeof NativeWatch);
  const events: string[] = [];
  const errors: Error[] = [];
  watcher.on('all', (_event, file) => events.push(file));
  watcher.on('error', (error) => errors.push(error));
  // Registration is synchronous, so even a notification before ready is retained.
  notify('rename', path.join('files', '课程', '资料.txt'));
  await once(watcher, 'ready');
  for (const file of [
    'library.json',
    '.desktop-observations.json',
    'files/.hidden/data',
    'files/a/.tmp',
    '../files/outside',
  ])
    notify('change', file);
  notify('rename', null);
  notify('rename', '');
  notify('change', Buffer.from('files/资料-é-🌊.txt'));
  assert.deepEqual(events, Array(4).fill(path.join(root, 'files')));
  const failure = new Error('watch failure');
  handle.emit('error', failure);
  assert.deepEqual(errors, [failure]);
  await watcher.close();
  await watcher.close();
  notify('rename', 'files/after-close');
  handle.emit('error', new Error('late error'));
  assert.equal(events.length, 4);
  assert.equal(errors.length, 1);
  assert.equal(closes, 1);
});

test('macOS reports registration failure without a false ready and closes before ready safely', async () => {
  const failure = new Error('permission denied');
  const watcher = watchMacLibrary('/missing', (() => {
    throw failure;
  }) as typeof NativeWatch);
  let ready = false;
  watcher.on('ready', () => {
    ready = true;
  });
  assert.deepEqual(await once(watcher, 'error'), [failure]);
  assert.equal(ready, false);
  await watcher.close();
  const closed = watchMacLibrary('/missing', (() => {
    throw failure;
  }) as typeof NativeWatch);
  await closed.close(); // queued errors/ready must not escape a disposed library
  await new Promise((resolve) => setImmediate(resolve));
});

test(
  'macOS keeps watching when the files directory is replaced',
  { skip: process.platform !== 'darwin' },
  async (t) => {
    const root = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), 'teachshell-watch-root-')),
    );
    await fs.mkdir(path.join(root, 'files'));
    const watcher = watchLibrary(root);
    t.after(async () => {
      await watcher.close();
      await fs.rm(root, { recursive: true, force: true });
    });
    await once(watcher, 'ready');
    await fs.rename(path.join(root, 'files'), path.join(root, 'old-files'));
    await fs.mkdir(path.join(root, 'files'));
    const invalidated = once(watcher, 'all');
    await fs.writeFile(path.join(root, 'files', 'replacement.txt'), 'replacement');
    const timeout = setTimeout(
      () => watcher.emit('error', new Error('replacement was not observed')),
      5000,
    );
    try {
      await invalidated;
    } finally {
      clearTimeout(timeout);
    }
  },
);
