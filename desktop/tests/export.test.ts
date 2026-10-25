import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Repository } from '../electron/services/storage/repository.ts';
import { exportMaterials } from '../electron/services/resource/export.ts';
test('export preserves original names, collision contents and the library index for managed and reference files', async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'teachshelf-export-')));
  const repo = await Repository.open(path.join(root, 'library'), { create: true });
  try {
    const source = path.join(root, '章一.txt'),
      target = path.join(root, 'out');
    await fs.writeFile(source, '课程内容');
    await fs.mkdir(target);
    await fs.writeFile(path.join(target, '章一.txt'), '已有资料');
    await repo.importFiles([source]);
    await repo.createCourse({ name: '外部引用' });
    await repo.importFiles([source], { courseID: repo.state.courses[0].id, copy: false });
    await repo.sync();
    const before = await fs.readFile(path.join(repo.root, 'library.json'));
    const result = await exportMaterials(
      repo,
      repo.state.materials.map((m) => m.id),
      target,
    );
    assert.equal(result.exported, 2);
    assert.equal(await fs.readFile(path.join(target, '章一.txt'), 'utf8'), '已有资料');
    assert.equal(await fs.readFile(path.join(target, '章一 2.txt'), 'utf8'), '课程内容');
    assert.equal(await fs.readFile(path.join(target, '章一 3.txt'), 'utf8'), '课程内容');
    assert.deepEqual(await fs.readFile(path.join(repo.root, 'library.json')), before);
    assert.equal(await fs.readFile(source, 'utf8'), '课程内容');
    await assert.rejects(
      exportMaterials(
        repo,
        repo.state.materials.map((m) => m.id),
        repo.root,
      ),
      /资料库以外/,
    );
  } finally {
    await repo.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
test('failed export rolls back only newly-created copies and rejects symbolic destinations', async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'teachshelf-export-')));
  const repo = await Repository.open(path.join(root, 'library'), { create: true });
  try {
    const a = path.join(root, 'a.txt'),
      b = path.join(root, 'b.txt'),
      out = path.join(root, 'out');
    await fs.writeFile(a, 'A');
    await fs.writeFile(b, 'B');
    await fs.mkdir(out);
    await fs.writeFile(path.join(out, 'keep.txt'), 'keep');
    await repo.importFiles([a, b], { copy: false });
    await fs.rm(b);
    await assert.rejects(
      exportMaterials(
        repo,
        repo.state.materials.map((m) => m.id),
        out,
      ),
    );
    assert.deepEqual(await fs.readdir(out), ['keep.txt']);
    const link = path.join(root, 'link');
    await fs.symlink(out, link, process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(exportMaterials(repo, [repo.state.materials[0].id], link), /符号链接/);
  } finally {
    await repo.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
test('failed export preserves concurrent edits to an already exported file and still cleans unchanged copies', async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'teachshelf-export-'))),
    repo = await Repository.open(path.join(root, 'library'), { create: true });
  try {
    const sources = ['a', 'b', 'c'].map((name) => path.join(root, name + '.txt')),
      out = path.join(root, 'out');
    await fs.mkdir(out);
    for (const file of sources) await fs.writeFile(file, 'original ' + path.basename(file));
    await repo.importFiles(sources, { copy: false });
    const items = repo.state.materials,
      resolve = repo.resolveMaterial.bind(repo);
    repo.resolveMaterial = async (id) => {
      if (id === items[2].id) {
        await fs.writeFile(path.join(out, 'b.txt'), 'concurrent user edit');
        throw new Error('third source unavailable');
      }
      return resolve(id);
    };
    await assert.rejects(
      exportMaterials(
        repo,
        items.map((m) => m.id),
        out,
      ),
      /已保留.*b\.txt/,
    );
    assert.deepEqual(await fs.readdir(out), ['b.txt']);
    assert.equal(await fs.readFile(path.join(out, 'b.txt'), 'utf8'), 'concurrent user edit');
    for (const file of sources)
      assert.equal(await fs.readFile(file, 'utf8'), 'original ' + path.basename(file));
  } finally {
    await repo.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
test('failed export preserves a replacement file with the same original bytes', async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'teachshelf-export-'))),
    repo = await Repository.open(path.join(root, 'library'), { create: true });
  try {
    const a = path.join(root, 'a.txt'),
      b = path.join(root, 'b.txt'),
      out = path.join(root, 'out');
    await fs.writeFile(a, 'A');
    await fs.writeFile(b, 'B');
    await fs.mkdir(out);
    await repo.importFiles([a, b], { copy: false });
    const items = repo.state.materials,
      resolve = repo.resolveMaterial.bind(repo);
    repo.resolveMaterial = async (id) => {
      if (id === items[1].id) {
        await fs.rename(path.join(out, 'a.txt'), path.join(root, 'saved-export.txt'));
        await fs.writeFile(path.join(out, 'a.txt'), 'A');
        throw new Error('second source unavailable');
      }
      return resolve(id);
    };
    await assert.rejects(
      exportMaterials(
        repo,
        items.map((m) => m.id),
        out,
      ),
      /已保留.*a\.txt/,
    );
    assert.equal(await fs.readFile(path.join(out, 'a.txt'), 'utf8'), 'A');
    assert.equal(await fs.readFile(path.join(root, 'saved-export.txt'), 'utf8'), 'A');
  } finally {
    await repo.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
