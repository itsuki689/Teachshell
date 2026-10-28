import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Repository } from '../electron/services/storage/repository.ts';
import { HomeworkService } from '../electron/services/resource/homework.ts';

async function fixture() {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'teachshelf-homework-'))),
    repo = await Repository.open(path.join(root, 'Library'), { create: true }),
    id = randomUUID().toUpperCase();
  await repo.createCourse({ id, name: '程序设计' });
  return {
    root,
    repo,
    id,
    service: new HomeworkService(() => repo),
    cleanup: async () => {
      await repo.close();
      await fs.rm(root, { recursive: true, force: true });
    },
  };
}
async function file(root: string, relative: string, content: string) {
  const result = path.join(root, relative);
  await fs.mkdir(path.dirname(result), { recursive: true });
  await fs.writeFile(result, content);
  return result;
}
async function holdListing(service: HomeworkService, courseID: string, folder: string, rel = '') {
  let entered!: () => void, release!: () => void;
  const begun = new Promise<void>((r) => (entered = r)),
    gate = new Promise<void>((r) => (release = r)),
    original = fs.readdir;
  const stub = mock.method(fs, 'readdir', async (...args: Parameters<typeof fs.readdir>) => {
    if (args[0] === folder && args.length === 1) {
      entered();
      await gate;
    }
    return original(...args);
  });
  const pending = service.list(courseID, rel);
  await begun;
  return { pending, release, restore: () => stub.mock.restore() };
}
async function whileListingHeld<T>(operation: Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('旧目录枚举阻塞了新读取或无关写入')), 2000);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

test('homework has separate course and unassigned roots and preserves ordinary nested and hidden files', async () => {
  const f = await fixture();
  try {
    const listed = await f.service.list(f.id);
    assert.equal(listed.mounted, false);
    assert.equal(path.basename(listed.root), '作业');
    assert.ok(listed.root.includes(f.id));
    assert.equal((await f.service.list()).root, path.join(f.repo.root, 'files', '未分类', '作业'));
    const source = path.join(f.root, '实验');
    await file(source, '代码/main.py', 'print(1)');
    await file(source, '.config', 'preserved');
    await fs.mkdir(path.join(source, '空目录'));
    assert.deepEqual(await f.service.importFiles(f.id, '', [source]), {
      imported: 1,
      skipped: 0,
      errors: [],
    });
    assert.equal(
      await fs.readFile(await f.service.resolve(f.id, '实验/代码/main.py'), 'utf8'),
      'print(1)',
    );
    assert.equal(await fs.readFile(path.join(listed.root, '实验/.config'), 'utf8'), 'preserved');
    assert.deepEqual(
      (await f.service.list(f.id, '实验')).entries.map((e) => e.name),
      ['代码', '空目录'],
    );
    assert.equal(f.repo.state.materials.length, 0);
    assert.equal(await fs.readFile(path.join(source, '代码/main.py'), 'utf8'), 'print(1)');
  } finally {
    await f.cleanup();
  }
});

test('duplicates get numbered without overwriting; rename and folder creation preserve contents', async () => {
  const f = await fixture();
  try {
    const source = await file(f.root, 'solution.py', 'print(1)');
    await f.service.importFiles(f.id, '', [source, source]);
    const names = (await f.service.list(f.id)).entries.map((e) => e.name);
    assert.deepEqual(new Set(names), new Set(['solution.py', 'solution 2.py']));
    const folder = await f.service.createFolder(f.id, '', '实验');
    assert.equal(folder.relativePath, '实验');
    assert.equal((await f.service.createFolder(f.id, '', '实验')).name, '实验 2');
    await f.service.rename(f.id, 'solution.py', '答案.py');
    assert.equal(await fs.readFile(await f.service.resolve(f.id, '答案.py'), 'utf8'), 'print(1)');
    await assert.rejects(f.service.rename(f.id, 'solution 2.py', '答案.py'), /已存在/);
    assert.equal(
      await fs.readFile(await f.service.resolve(f.id, 'solution 2.py'), 'utf8'),
      'print(1)',
    );
    await f.service.importFiles(f.id, '实验', [source]);
    await f.service.rename(f.id, '实验', '实验完成');
    assert.equal(
      await fs.readFile(await f.service.resolve(f.id, '实验完成/solution.py'), 'utf8'),
      'print(1)',
    );
  } finally {
    await f.cleanup();
  }
});

test('traversal, reserved names, symlink nodes and default symlink roots cannot escape the workspace', async () => {
  const f = await fixture();
  try {
    for (const rel of ['../outside', '/etc', 'a/../b', 'a\\b', 'C:/Windows', 'a//b', './a', 'a\0b'])
      await assert.rejects(f.service.list(f.id, rel));
    for (const name of ['..', 'CON', 'NUL.txt', 'folder.', 'a/b', 'a\\b'])
      await assert.rejects(f.service.createFolder(f.id, '', name));
    const base = (await f.service.list(f.id)).root,
      outside = path.join(f.root, 'private');
    await file(outside, 'secret.txt', 'preserve');
    await fs.symlink(outside, path.join(base, 'link'), 'dir');
    assert.ok(!(await f.service.list(f.id)).entries.some((e) => e.name === 'link'));
    await assert.rejects(f.service.resolve(f.id, 'link/secret.txt'), /符号链接/);
    await assert.rejects(f.service.createFolder(f.id, 'link', 'new'), /符号链接/);
    await fs.unlink(path.join(base, 'link'));
    await fs.rmdir(base);
    await fs.symlink(outside, base, 'dir');
    await assert.rejects(f.service.list(f.id), /符号链接/);
    assert.equal(await fs.readFile(path.join(outside, 'secret.txt'), 'utf8'), 'preserve');
  } finally {
    await f.cleanup();
  }
});

test('external mounts persist through course edits and reopen without writing mount metadata', async () => {
  const f = await fixture();
  try {
    const mount = path.join(f.root, 'External');
    await file(mount, 'answer.txt', 'external');
    assert.equal(await f.service.mountPath(f.id, mount), mount);
    await f.repo.setHomeworkFolder(f.id, mount);
    assert.equal((await f.service.list(f.id)).root, mount);
    await f.repo.updateCourse(f.id, { teacher: '陈老师', name: '新课程名' });
    assert.equal(f.repo.state.courses[0].homeworkFolder, mount);
    assert.deepEqual(await fs.readdir(mount), ['answer.txt']);
    await f.repo.close();
    const reopened = await Repository.open(f.repo.root);
    try {
      assert.equal((await new HomeworkService(() => reopened).list(f.id)).root, mount);
      await reopened.setHomeworkFolder(f.id);
      const fallback = await new HomeworkService(() => reopened).list(f.id);
      assert.equal(fallback.mounted, false);
      assert.ok(fallback.root.startsWith(reopened.root + path.sep));
      assert.equal(await fs.readFile(path.join(mount, 'answer.txt'), 'utf8'), 'external');
    } finally {
      await reopened.close();
    }
  } finally {
    await f.cleanup();
  }
});

test('mounts reject library containment, overlap and disconnected reserved locations', async () => {
  const f = await fixture();
  try {
    const otherID = randomUUID().toUpperCase();
    await f.repo.createCourse({ id: otherID, name: '其他课程' });
    const mount = path.join(f.root, 'Mounted');
    await fs.mkdir(path.join(mount, 'Child'), { recursive: true });
    await f.repo.setHomeworkFolder(f.id, mount);
    for (const candidate of [
      f.repo.root,
      f.root,
      path.join(f.repo.root, 'files'),
      mount,
      path.join(mount, 'Child'),
    ])
      await assert.rejects(f.repo.setHomeworkFolder(otherID, candidate));
    const original = f.repo.state.courses.find((c) => c.id === f.id)!.homeworkFolder;
    await fs.rm(mount, { recursive: true });
    await assert.rejects(f.service.list(f.id));
    assert.equal(f.repo.state.courses.find((c) => c.id === f.id)!.homeworkFolder, original);
    await assert.rejects(fs.stat(mount), { code: 'ENOENT' });
    // A missing child mount still prevents claiming its existing parent.
    await assert.rejects(f.repo.setHomeworkFolder(otherID, f.root), /资料库|重叠/);
    const safeParent = path.join(f.root, 'Independent');
    await fs.mkdir(path.join(safeParent, 'Child'), { recursive: true });
    await f.repo.setHomeworkFolder(f.id, path.join(safeParent, 'Child'));
    await fs.rmdir(path.join(safeParent, 'Child'));
    await assert.rejects(f.repo.setHomeworkFolder(otherID, safeParent), /重叠/);
  } finally {
    await f.cleanup();
  }
});

test('unsafe directory imports roll back their temporary tree and report independent successes', async () => {
  const f = await fixture();
  try {
    const base = (await f.service.list(f.id)).root,
      bad = path.join(f.root, 'Bad');
    await file(bad, 'good.txt', 'good');
    const privateFile = await file(f.root, 'private.txt', 'private');
    await fs.symlink(privateFile, path.join(bad, 'link.txt'));
    const valid = await file(f.root, 'valid.txt', 'valid');
    const result = await f.service.importFiles(f.id, '', [bad, base, valid]);
    assert.equal(result.imported, 1);
    assert.equal(result.skipped, 2);
    assert.equal(result.errors.length, 2);
    assert.deepEqual(await fs.readdir(base), ['valid.txt']);
    assert.equal(await fs.readFile(privateFile, 'utf8'), 'private');
    assert.equal(await fs.readFile(path.join(bad, 'good.txt'), 'utf8'), 'good');
  } finally {
    await f.cleanup();
  }
});

test('homework import and course rename share the repository queue and retain the same files', async () => {
  const f = await fixture();
  try {
    const source = await file(f.root, 'answer.txt', 'answer');
    const [result] = await Promise.all([
      f.service.importFiles(f.id, '', [source]),
      f.repo.updateCourse(f.id, { name: '重命名课程' }),
    ]);
    assert.equal(result.imported, 1);
    assert.equal(await fs.readFile(await f.service.resolve(f.id, 'answer.txt'), 'utf8'), 'answer');
    assert.ok((await f.service.list(f.id)).root.includes('重命名课程'));
    assert.equal(f.repo.state.materials.length, 0);
  } finally {
    await f.cleanup();
  }
});

test('slow homework enumeration leaves new listings and unrelated writes available', async () => {
  const f = await fixture();
  let held: Awaited<ReturnType<typeof holdListing>> | undefined;
  try {
    const base = (await f.service.list(f.id)).root;
    held = await holdListing(f.service, f.id, base);
    const [listing, snapshot] = await whileListingHeld(
      Promise.all([f.service.list(), f.repo.updateCourse(f.id, { teacher: '读取期间保存' })]),
    );
    assert.equal(listing.courseID, undefined);
    assert.equal(snapshot.state.courses[0].teacher, '读取期间保存');
  } finally {
    held?.release();
    await held?.pending;
    held?.restore();
    await f.cleanup();
  }
});

test('detached homework listing rejects a changed mount or course directory', async (t) => {
  for (const change of ['mount', 'course-directory'] as const) {
    await t.test(change, async () => {
      const f = await fixture();
      let held: Awaited<ReturnType<typeof holdListing>> | undefined;
      try {
        const mount = path.join(f.root, 'External');
        if (change === 'mount') {
          await fs.mkdir(mount);
          await f.repo.setHomeworkFolder(f.id, mount);
        }
        const base = (await f.service.list(f.id)).root;
        held = await holdListing(f.service, f.id, base);
        await whileListingHeld(
          change === 'mount'
            ? f.repo.setHomeworkFolder(f.id)
            : f.repo.updateCourse(f.id, { name: '新的课程目录' }),
        );
        held.release();
        await assert.rejects(held.pending, /已变化|ENOENT/);
      } finally {
        held?.release();
        await held?.pending.catch(() => {});
        held?.restore();
        await f.cleanup();
      }
    });
  }
});

test('detached homework listing rejects workspace switches and replaced directory paths', async (t) => {
  for (const change of ['workspace', 'directory', 'symlink'] as const) {
    await t.test(change, async () => {
      const f = await fixture(),
        next = await Repository.open(path.join(f.root, 'OtherLibrary'), { create: true });
      let active = f.repo;
      const service = new HomeworkService(() => active);
      let held: Awaited<ReturnType<typeof holdListing>> | undefined;
      try {
        const base = (await service.list(f.id)).root,
          folder = path.join(base, 'nested');
        await file(folder, 'answer.txt', 'answer');
        held = await holdListing(service, f.id, folder, 'nested');
        if (change === 'workspace') active = next;
        else {
          await fs.rename(folder, path.join(base, 'previous'));
          if (change === 'directory') await fs.mkdir(folder);
          else {
            const outside = path.join(f.root, 'Private');
            await file(outside, 'secret.txt', 'private');
            await fs.symlink(outside, folder, process.platform === 'win32' ? 'junction' : 'dir');
          }
        }
        held.release();
        await assert.rejects(held.pending, /已切换|已变化|符号链接/);
      } finally {
        held?.release();
        await held?.pending.catch(() => {});
        held?.restore();
        await next.close();
        await f.cleanup();
      }
    });
  }
});

test('queued homework access rejects a library switch before touching either workspace', async () => {
  const f = await fixture(),
    next = await Repository.open(path.join(f.root, 'OtherLibrary'), { create: true });
  let active = f.repo;
  const service = new HomeworkService(() => active);
  let release!: () => void, entered!: () => void;
  const begun = new Promise<void>((r) => (entered = r));
  try {
    const blocking = f.repo.withWorkspace(async () => {
      entered();
      await new Promise<void>((r) => (release = r));
    });
    await begun;
    const pending = service.createFolder(f.id, '', 'wrong');
    active = next;
    release();
    await blocking;
    await assert.rejects(pending, /已切换/);
    assert.equal((await f.service.list(f.id)).entries.length, 0);
    assert.equal((await new HomeworkService(() => next).list()).entries.length, 0);
  } finally {
    release?.();
    await next.close();
    await f.cleanup();
  }
});

test('external volumes without hard links use exclusive copying and preserve the source', async () => {
  const f = await fixture();
  let stub: ReturnType<typeof mock.method> | undefined;
  try {
    const mount = path.join(f.root, 'ExternalVolume');
    await fs.mkdir(mount);
    await f.repo.setHomeworkFolder(f.id, mount);
    const source = await file(f.root, 'answer.txt', 'answer');
    stub = mock.method(fs, 'link', async () => {
      throw Object.assign(new Error('hard links unavailable'), { code: 'ENOTSUP' });
    });
    const result = await f.service.importFiles(f.id, '', [source, source]);
    assert.equal(result.imported, 2);
    assert.equal(await fs.readFile(path.join(mount, 'answer.txt'), 'utf8'), 'answer');
    assert.equal(await fs.readFile(path.join(mount, 'answer 2.txt'), 'utf8'), 'answer');
    assert.equal(await fs.readFile(source, 'utf8'), 'answer');
    assert.deepEqual((await fs.readdir(mount)).sort(), ['answer 2.txt', 'answer.txt']);
  } finally {
    stub?.mock.restore();
    await f.cleanup();
  }
});
