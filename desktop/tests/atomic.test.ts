import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  atomicWrite,
  commitTransaction,
  recoverTransaction,
  digest,
} from '../electron/services/storage/atomic.ts';
import { identity } from '../electron/services/filesystem/paths.ts';

async function fixture(t: { after: (f: () => Promise<void>) => void }) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'teachshelf-atomic-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'files'));
  await atomicWrite(root, 'library.json', JSON.stringify({ value: 'before' }));
  await fs.writeFile(path.join(root, 'files', 'before.bin'), Buffer.from([0, 128, 255, 10]));
  return root;
}
const next = { value: 'after' };
test('atomic JSON replacement keeps exact previous bytes as backup', async (t) => {
  const root = await fixture(t);
  const before = await fs.readFile(path.join(root, 'library.json'));
  await atomicWrite(root, 'library.json', '{"new":1}\n', true);
  assert.deepEqual(await fs.readFile(path.join(root, 'library.json.bak')), before);
  assert.equal(await fs.readFile(path.join(root, 'library.json'), 'utf8'), '{"new":1}\n');
  assert.ok(!(await fs.readdir(root)).some((n) => n.endsWith('.tmp')));
});
for (const point of ['journal', 'files', 'index'])
  test(`interruption at ${point} recovers according to committed index`, async (t) => {
    const root = await fixture(t);
    const before = await fs.readFile(path.join(root, 'library.json'));
    const bytes = await fs.readFile(path.join(root, 'files', 'before.bin'));
    await assert.rejects(
      commitTransaction(
        root,
        next,
        [{ kind: 'move', from: 'files/before.bin', to: 'files/after.bin' }],
        (p) => {
          if (p === point) throw new Error('injected crash');
        },
      ),
      /injected/,
    );
    await recoverTransaction(root);
    await recoverTransaction(root);
    const committed = point === 'index';
    assert.deepEqual(
      await fs.readFile(path.join(root, 'files', committed ? 'after.bin' : 'before.bin')),
      bytes,
    );
    if (committed)
      assert.deepEqual(
        JSON.parse(await fs.readFile(path.join(root, 'library.json'), 'utf8')),
        next,
      );
    else assert.deepEqual(await fs.readFile(path.join(root, 'library.json')), before);
    await assert.rejects(fs.access(path.join(root, '.desktop-transaction.json')));
  });
test('rollback after nested directory rename restores child bytes', async (t) => {
  const root = await fixture(t);
  await fs.mkdir(path.join(root, 'files', 'parent'));
  await fs.rename(
    path.join(root, 'files', 'before.bin'),
    path.join(root, 'files', 'parent', 'child.bin'),
  );
  await assert.rejects(
    commitTransaction(
      root,
      next,
      [{ kind: 'move', from: 'files/parent', to: 'files/renamed' }],
      (p) => {
        if (p === 'files') throw new Error('crash');
      },
    ),
  );
  assert.deepEqual(
    await fs.readFile(path.join(root, 'files', 'parent', 'child.bin')),
    Buffer.from([0, 128, 255, 10]),
  );
});
test('copy rollback removes only its owned copy and retains source bytes', async (t) => {
  const root = await fixture(t);
  const source = path.join(root, 'source.bin');
  await fs.writeFile(source, 'source');
  await assert.rejects(
    commitTransaction(root, next, [{ kind: 'copy', from: source, to: 'files/copy.bin' }], (p) => {
      if (p === 'files') throw new Error('crash');
    }),
  );
  assert.equal(await fs.readFile(source, 'utf8'), 'source');
  await assert.rejects(fs.access(path.join(root, 'files', 'copy.bin')));
  assert.ok(!(await fs.readdir(root)).some((n) => n.startsWith('.desktop-copy-')));
});
test('preparation failure cleans already staged copies without touching source or index', async (t) => {
  const root = await fixture(t);
  const before = await fs.readFile(path.join(root, 'library.json'));
  const source = path.join(root, 'source.bin');
  await fs.writeFile(source, 'source');
  await assert.rejects(
    commitTransaction(root, next, [
      { kind: 'copy', from: source, to: 'files/copy.bin' },
      { kind: 'copy', from: path.join(root, 'absent.bin'), to: 'files/absent.bin' },
    ]),
  );
  assert.equal(await fs.readFile(source, 'utf8'), 'source');
  assert.deepEqual(await fs.readFile(path.join(root, 'library.json')), before);
  assert.ok(!(await fs.readdir(root)).some((n) => n.startsWith('.desktop-copy-')));
});
test('occupied targets are never overwritten', async (t) => {
  const root = await fixture(t);
  await fs.writeFile(path.join(root, 'files', 'occupied.bin'), 'unrelated');
  await assert.rejects(
    commitTransaction(root, next, [
      { kind: 'move', from: 'files/before.bin', to: 'files/occupied.bin' },
    ]),
    /目标已存在/,
  );
  assert.equal(await fs.readFile(path.join(root, 'files', 'occupied.bin'), 'utf8'), 'unrelated');
  assert.deepEqual(
    await fs.readFile(path.join(root, 'files', 'before.bin')),
    Buffer.from([0, 128, 255, 10]),
  );
});
test('unknown index revision retains journal and does not attempt rollback', async (t) => {
  const root = await fixture(t);
  const before = await fs.readFile(path.join(root, 'library.json'));
  const old = path.join(root, 'files', 'before.bin');
  const ident = identity(await fs.stat(old));
  await fs.rename(old, path.join(root, 'files', 'after.bin'));
  await atomicWrite(
    root,
    '.desktop-transaction.json',
    JSON.stringify({
      version: 1,
      before: digest(before),
      after: digest('not-current'),
      ops: [{ kind: 'move', from: 'files/before.bin', to: 'files/after.bin', identity: ident }],
    }),
  );
  await atomicWrite(root, 'library.json', '{"third":1}');
  await assert.rejects(recoverTransaction(root), /不匹配/);
  assert.ok(await fs.stat(path.join(root, '.desktop-transaction.json')));
  assert.ok(await fs.stat(path.join(root, 'files', 'after.bin')));
});
test('invalid recovery paths are rejected before any file is touched', async (t) => {
  const root = await fixture(t);
  const before = await fs.readFile(path.join(root, 'library.json'));
  await atomicWrite(
    root,
    '.desktop-transaction.json',
    JSON.stringify({
      version: 1,
      before: digest(before),
      after: 'x',
      ops: [{ kind: 'move', from: 'files/before.bin', to: '../escape' }],
    }),
  );
  await assert.rejects(recoverTransaction(root), /不安全/);
  assert.deepEqual(
    await fs.readFile(path.join(root, 'files', 'before.bin')),
    Buffer.from([0, 128, 255, 10]),
  );
});
test('oversized operations are rejected before writing an unrecoverable journal', async (t) => {
  const root = await fixture(t);
  const before = await fs.readFile(path.join(root, 'library.json'));
  await assert.rejects(
    commitTransaction(
      root,
      next,
      Array.from({ length: 100001 }, (_, i) => ({
        kind: 'mkdir' as const,
        to: `files/folder-${i}`,
      })),
    ),
    /分批/,
  );
  assert.deepEqual(await fs.readFile(path.join(root, 'library.json')), before);
  await assert.rejects(fs.access(path.join(root, '.desktop-transaction.json')));
});
test('a target created after the existence check cannot be overwritten by file movement', async (t) => {
  const root = await fixture(t),
    target = path.join(root, 'files', 'after.bin'),
    original = fs.link,
    before = await fs.readFile(path.join(root, 'library.json'));
  t.mock.method(
    fs,
    'link',
    async (from: Parameters<typeof fs.link>[0], to: Parameters<typeof fs.link>[1]) => {
      if (String(to) === target)
        await fs.writeFile(target, 'concurrent destination', { flag: 'wx' });
      return original(from, to);
    },
  );
  await assert.rejects(
    commitTransaction(root, next, [
      { kind: 'move', from: 'files/before.bin', to: 'files/after.bin' },
    ]),
    { code: 'EEXIST' },
  );
  assert.equal(await fs.readFile(target, 'utf8'), 'concurrent destination');
  assert.deepEqual(
    await fs.readFile(path.join(root, 'files', 'before.bin')),
    Buffer.from([0, 128, 255, 10]),
  );
  assert.deepEqual(await fs.readFile(path.join(root, 'library.json')), before);
});
test('failure immediately after linking restores the source without losing bytes', async (t) => {
  const root = await fixture(t),
    source = path.join(root, 'files', 'before.bin');
  await assert.rejects(
    commitTransaction(
      root,
      next,
      [{ kind: 'move', from: 'files/before.bin', to: 'files/after.bin' }],
      (point) => {
        if (point === 'move-linked') throw new Error('half move');
      },
    ),
    /half move/,
  );
  assert.deepEqual(await fs.readFile(source), Buffer.from([0, 128, 255, 10]));
  await assert.rejects(fs.access(path.join(root, 'files', 'after.bin')));
  await assert.rejects(fs.access(path.join(root, '.desktop-transaction.json')));
});
test('next-open recovery handles a process death with both hard links present', async (t) => {
  const root = await fixture(t),
    source = path.join(root, 'files', 'before.bin'),
    destination = path.join(root, 'files', 'after.bin'),
    before = await fs.readFile(path.join(root, 'library.json')),
    fileIdentity = identity(await fs.stat(source));
  await fs.link(source, destination);
  await atomicWrite(
    root,
    '.desktop-transaction.json',
    JSON.stringify({
      version: 1,
      before: digest(before),
      after: 'future-index',
      ops: [
        {
          kind: 'move',
          from: 'files/before.bin',
          to: 'files/after.bin',
          identity: fileIdentity,
          linkMove: true,
        },
      ],
    }),
  );
  await recoverTransaction(root);
  await recoverTransaction(root);
  assert.deepEqual(await fs.readFile(source), Buffer.from([0, 128, 255, 10]));
  await assert.rejects(fs.access(destination));
});
test('rollback file movement cannot overwrite a concurrently recreated original path', async (t) => {
  const root = await fixture(t),
    source = path.join(root, 'files', 'before.bin'),
    destination = path.join(root, 'files', 'after.bin'),
    original = fs.link;
  t.mock.method(
    fs,
    'link',
    async (from: Parameters<typeof fs.link>[0], to: Parameters<typeof fs.link>[1]) => {
      if (String(to) === source)
        await fs.writeFile(source, 'new original occupant', { flag: 'wx' });
      return original(from, to);
    },
  );
  await assert.rejects(
    commitTransaction(
      root,
      next,
      [{ kind: 'move', from: 'files/before.bin', to: 'files/after.bin' }],
      (point) => {
        if (point === 'files') throw new Error('trigger rollback');
      },
    ),
    /恢复未完成/,
  );
  assert.equal(await fs.readFile(source, 'utf8'), 'new original occupant');
  assert.deepEqual(await fs.readFile(destination), Buffer.from([0, 128, 255, 10]));
  assert.ok(await fs.stat(path.join(root, '.desktop-transaction.json')));
});
