import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Repository, copyLibrary } from '../electron/services/storage/repository.ts';
import { prepareLegacyHomework } from '../electron/services/storage/legacy-homework.ts';
import {
  commitTransaction,
  recoverTransaction,
  digest,
} from '../electron/services/storage/atomic.ts';
import type { FileOp } from '../electron/services/storage/atomic.ts';
import { decodeLibrary } from '../shared/model.ts';
import { courseDirectory } from '../electron/services/filesystem/paths.ts';
import { HomeworkService } from '../electron/services/resource/homework.ts';

const contract = JSON.parse(
  await fs.readFile(new URL('./fixtures/swift-homework-migration.json', import.meta.url), 'utf8'),
);
async function fixture(t: { after: (f: () => Promise<void>) => void }) {
  const dir = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), 'teachshelf-legacy-homework-')),
  );
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const source = path.join(dir, 'Swift');
  await fs.mkdir(source);
  await fs.writeFile(path.join(source, 'library.json'), JSON.stringify(contract.library, null, 2));
  for (const entry of contract.entries) {
    const file = path.join(source, entry.path);
    await fs.mkdir(entry.directory ? file : path.dirname(file), { recursive: true });
    if (!entry.directory) await fs.writeFile(file, Buffer.from(entry.dataBase64, 'base64'));
  }
  return { dir, source, destination: path.join(dir, 'Desktop') };
}
async function checkOriginals(root: string) {
  for (const entry of contract.entries)
    if (!entry.directory)
      assert.deepEqual(
        await fs.readFile(path.join(root, entry.path)),
        Buffer.from(entry.dataBase64, 'base64'),
        entry.path,
      );
}
async function migratedFiles(root: string) {
  const result: string[] = [];
  const visit = async (relative: string) => {
    result.push(relative);
    for (const e of await fs.readdir(path.join(root, relative), { withFileTypes: true })) {
      const child = relative + '/' + e.name;
      if (e.isDirectory()) await visit(child);
      else result.push(child);
    }
  };
  await visit(courseDirectory(contract.library.courses[0]) + '/作业');
  await visit('files/未分类/作业');
  return result.sort();
}

test('native Swift fixture merges old course/public/renamed trees with byte-identical results and retained originals', async (t) => {
  const { source, destination } = await fixture(t),
    original = await fs.readFile(path.join(source, 'library.json'));
  await copyLibrary(source, destination);
  const repo = await Repository.open(destination);
  t.after(() => repo.close());
  assert.equal(repo.state.schemaVersion, 9);
  assert.equal((repo.state.desktopLegacyHomeworkMigration as any).version, 1);
  assert.deepEqual(
    await migratedFiles(destination),
    contract.expected.map((e: any) => e.path).sort(),
  );
  for (const entry of contract.expected) {
    const file = path.join(destination, entry.path);
    if (entry.directory) assert.ok((await fs.stat(file)).isDirectory());
    else {
      const bytes = await fs.readFile(file);
      assert.equal(digest(bytes), entry.sha256);
      assert.deepEqual(bytes, Buffer.from(entry.dataBase64, 'base64'));
    }
  }
  await checkOriginals(source);
  await checkOriginals(destination);
  assert.deepEqual(await fs.readFile(path.join(source, 'library.json')), original);
  assert.equal(
    decodeLibrary(JSON.parse(await fs.readFile(path.join(destination, 'library.json.bak'), 'utf8')))
      .courses[0].id,
    contract.library.courses[0].id,
  );
  assert.equal(repo.state.materials.length, 0);
  assert.equal(repo.state.materialFolders.length, 0);
  assert.ok(repo.warnings.some((w) => w.includes('旧作业')));
});
test('schema-9 copies containing unmigrated homework are repaired only once, even after editing the destination', async (t) => {
  const { source, destination } = await fixture(t);
  const state = structuredClone(contract.library);
  state.schemaVersion = 9;
  await fs.writeFile(path.join(source, 'library.json'), JSON.stringify(state));
  await copyLibrary(source, destination);
  const first = await Repository.open(destination);
  await first.close();
  const file = path.join(
    destination,
    courseDirectory(state.courses[0]),
    '作业',
    '实验',
    'answer 2.txt',
  );
  await fs.writeFile(file, 'new user edit');
  const before = await migratedFiles(destination),
    second = await Repository.open(destination);
  t.after(() => second.close());
  assert.deepEqual(await migratedFiles(destination), before);
  assert.equal(await fs.readFile(file, 'utf8'), 'new user edit');
  await checkOriginals(source);
});
test('external mounts stay untouched while legacy internal fallback remains available after unmounting', async (t) => {
  const { dir, source, destination } = await fixture(t),
    outside = path.join(dir, 'Outside');
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, 'external.txt'), 'untouched');
  const state = structuredClone(contract.library);
  state.courses[0].homeworkFolder = outside;
  await fs.writeFile(path.join(source, 'library.json'), JSON.stringify(state));
  await copyLibrary(source, destination);
  const repo = await Repository.open(destination);
  t.after(() => repo.close());
  const homework = new HomeworkService(() => repo),
    id = state.courses[0].id;
  assert.equal((await homework.list(id)).mounted, true);
  assert.deepEqual(await fs.readdir(outside), ['external.txt']);
  await repo.setHomeworkFolder(id, undefined);
  assert.ok((await homework.list(id, '实验')).entries.some((e) => e.name === 'answer 2.txt'));
  assert.equal(await fs.readFile(path.join(outside, 'external.txt'), 'utf8'), 'untouched');
});
test('a blocked backup write rolls back copied homework while retaining all source and preexisting destination bytes', async (t) => {
  const { source, destination } = await fixture(t);
  await copyLibrary(source, destination);
  const before = await fs.readFile(path.join(destination, 'library.json'));
  await fs.mkdir(path.join(destination, 'library.json.bak'));
  await assert.rejects(Repository.open(destination));
  await checkOriginals(source);
  await checkOriginals(destination);
  assert.deepEqual(await fs.readFile(path.join(destination, 'library.json')), before);
  await assert.rejects(
    fs.access(
      path.join(
        destination,
        courseDirectory(contract.library.courses[0]),
        '作业',
        '实验',
        'answer 2.txt',
      ),
    ),
  );
  assert.ok(!(await fs.readdir(destination)).some((n) => n.startsWith('.desktop-copy-')));
});
test('symlinks and occupied homework roots abort before index or source changes', async (t) => {
  const { source, destination } = await fixture(t);
  await copyLibrary(source, destination);
  const before = await fs.readFile(path.join(destination, 'library.json')),
    target = path.join(destination, courseDirectory(contract.library.courses[0]), '作业');
  await fs.rename(target, target + ' saved');
  await fs.writeFile(target, 'keep root occupant');
  await assert.rejects(Repository.open(destination), /作业|ENOTDIR/);
  assert.equal(await fs.readFile(target, 'utf8'), 'keep root occupant');
  assert.deepEqual(await fs.readFile(path.join(destination, 'library.json')), before);
  if (process.platform === 'win32') return;
  await fs.unlink(target);
  await fs.rename(target + ' saved', target);
  await fs.symlink(
    path.join(source, 'library.json'),
    path.join(destination, 'HomeworkFiles', contract.library.courses[0].id, 'link'),
  );
  await assert.rejects(Repository.open(destination), /符号链接/);
  assert.deepEqual(await fs.readFile(path.join(destination, 'library.json')), before);
  await checkOriginals(source);
});
test('portable case-fold collisions merge folders and preserve conflicting file contents', async (t) => {
  const { source, destination } = await fixture(t),
    legacy = path.join(source, 'HomeworkFiles', contract.library.courses[0].id);
  await fs.writeFile(path.join(legacy, 'README.txt'), 'legacy');
  const target = path.join(source, courseDirectory(contract.library.courses[0]), '作业');
  await fs.writeFile(path.join(target, 'readme.TXT'), 'existing');
  await copyLibrary(source, destination);
  const repo = await Repository.open(destination);
  t.after(() => repo.close());
  assert.equal(
    await fs.readFile(
      path.join(destination, courseDirectory(contract.library.courses[0]), '作业', 'readme.TXT'),
      'utf8',
    ),
    'existing',
  );
  assert.equal(
    await fs.readFile(
      path.join(destination, courseDirectory(contract.library.courses[0]), '作业', 'README 2.txt'),
      'utf8',
    ),
    'legacy',
  );
});
test('nonportable legacy names fail clearly without removing the originals', async (t) => {
  if (process.platform === 'win32') return;
  const { source, destination } = await fixture(t),
    name = path.join(source, 'HomeworkFiles', contract.library.courses[0].id, 'CON');
  await fs.writeFile(name, 'retained');
  await copyLibrary(source, destination);
  const before = await fs.readFile(path.join(destination, 'library.json'));
  await assert.rejects(Repository.open(destination), /跨平台/);
  assert.equal(await fs.readFile(name, 'utf8'), 'retained');
  assert.deepEqual(await fs.readFile(path.join(destination, 'library.json')), before);
});
test('source changes between planning and copy staging abort without installing torn contents', async (t) => {
  const { source } = await fixture(t),
    state = decodeLibrary(contract.library),
    ops: FileOp[] = [];
  await prepareLegacyHomework(source, state, ops);
  assert.ok(ops.some((op) => op.kind === 'copy'));
  const selected = ops.find((op) => op.kind === 'copy')!;
  await fs.writeFile(selected.from!, 'changed after planning');
  const before = await fs.readFile(path.join(source, 'library.json'));
  state.schemaVersion = 9;
  await assert.rejects(commitTransaction(source, state, ops), /原文件已变化/);
  assert.deepEqual(await fs.readFile(path.join(source, 'library.json')), before);
  assert.equal(await fs.readFile(selected.from!, 'utf8'), 'changed after planning');
  assert.ok(!(await fs.readdir(source)).some((n) => n.startsWith('.desktop-copy-')));
});
test('POSIX executable and read-only permissions are preserved by legacy copies', async (t) => {
  if (process.platform === 'win32') return;
  const { source, destination } = await fixture(t),
    relative = 'HomeworkFiles/' + contract.library.courses[0].id + '/代码/main.py';
  await fs.chmod(path.join(source, relative), 0o750);
  await copyLibrary(source, destination);
  const repo = await Repository.open(destination);
  t.after(() => repo.close());
  const target = path.join(
    destination,
    courseDirectory(contract.library.courses[0]),
    '作业',
    '代码 2',
    'main.py',
  );
  assert.equal((await fs.stat(target)).mode & 0o777, 0o750);
  assert.equal((await fs.stat(path.join(source, relative))).mode & 0o777, 0o750);
  await repo.close();
  const readonly = path.join(source, relative);
  await fs.chmod(readonly, 0o440);
  const next = path.join(path.dirname(destination), 'Read-only');
  await copyLibrary(source, next);
  const reopened = await Repository.open(next);
  t.after(() => reopened.close());
  assert.equal(
    (
      await fs.stat(
        path.join(next, courseDirectory(contract.library.courses[0]), '作业', '代码 2', 'main.py'),
      )
    ).mode & 0o777,
    0o440,
  );
});
for (const checkpoint of ['journal', 'files', 'index'])
  test(`legacy homework interruption at ${checkpoint} preserves original trees and recovers the committed version`, async (t) => {
    const { source } = await fixture(t),
      state = decodeLibrary(contract.library),
      ops: FileOp[] = [];
    const report = await prepareLegacyHomework(source, state, ops);
    state.schemaVersion = 9;
    state.desktopLegacyHomeworkMigration = { version: 1, sourceRoots: report.sourceRoots };
    await assert.rejects(
      commitTransaction(source, state, ops, (point) => {
        if (point === checkpoint) throw new Error('simulated crash');
      }),
      /simulated/,
    );
    await recoverTransaction(source);
    await checkOriginals(source);
    const result = JSON.parse(await fs.readFile(path.join(source, 'library.json'), 'utf8'));
    assert.equal(result.schemaVersion, checkpoint === 'index' ? 9 : 8);
    const copied = path.join(
      source,
      courseDirectory(state.courses[0]),
      '作业',
      '实验',
      'answer 2.txt',
    );
    if (checkpoint === 'index') assert.equal(await fs.readFile(copied, 'utf8'), 'old answer');
    else await assert.rejects(fs.access(copied));
  });
