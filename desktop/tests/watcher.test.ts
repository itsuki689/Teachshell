import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { watchLibrary } from '../electron/services/filesystem/watch.ts';
import { Repository } from '../electron/services/storage/repository.ts';

// Exercise the Windows polling backend on every host, plus the host's default.
for (const platform of new Set([process.platform, 'win32' as const]))
  test(`active ${platform} watcher permits nested course renames and observes external moves`, async (t) => {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'teachshell-watch-')));
    const repo = await Repository.open(path.join(root, 'library'), { create: true });
    let watcher: ReturnType<typeof watchLibrary> | undefined;
    t.after(async () => {
      await watcher?.close();
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
    const seen = new Set<string>();
    const errors: Error[] = [];
    watcher.on('all', (_event, file) => seen.add(file));
    watcher.on('error', (e) => errors.push(e as Error));
    await once(watcher, 'ready');
    await repo.updateCourse(course.id, { name: '内部改名' });
    const first = path.join(repo.root, repo.state.courses[0].storageDirectory!);
    const second = path.join(path.dirname(first), '外部改名 [' + course.id + ']');
    // Allow the watcher to register descendants at the new location before Explorer-style rename.
    const until = async (predicate: () => boolean) => {
      for (let i = 0; i < 100 && !predicate(); i++)
        await new Promise((resolve) => setTimeout(resolve, 50));
      assert.ok(predicate(), 'watcher did not observe the moved directory');
    };
    await until(() => seen.has(first));
    await fs.rename(first, second);
    await until(() => seen.has(second));
    await repo.sync();
    assert.equal(repo.state.courses[0].id, course.id);
    assert.equal(repo.state.courses[0].name, '外部改名');
    assert.equal(repo.state.materials[0].id, materialID);
    assert.equal(await fs.readFile(await repo.resolveMaterial(materialID), 'utf8'), 'source bytes');
    assert.equal(await fs.readFile(source, 'utf8'), 'source bytes');
    assert.deepEqual(errors, []);
  });
