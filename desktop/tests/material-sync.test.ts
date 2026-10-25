import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Repository, copyLibrary } from '../electron/services/storage/repository.ts';
import {
  commitTransaction,
  recoverTransaction,
  digestFile,
} from '../electron/services/storage/atomic.ts';
import type { FileOp } from '../electron/services/storage/atomic.ts';
import {
  prepareTeachingFile,
  teachingFileState,
} from '../electron/services/website/material-sync.ts';
import type { TeachingFile } from '../electron/services/website/material-sync.ts';
import type { TeachingActivity } from '../electron/services/website/teaching.ts';
import { swiftNow } from '../shared/model.ts';
import { materialRoot } from '../electron/services/filesystem/paths.ts';

const activity: TeachingActivity = {
  id: '91',
  kind: 'assign',
  title: '本周作业',
  sectionID: 'section1',
  section: '第一周',
  url: 'https://selearning.nju.edu.cn/mod/assign/view.php?id=91',
};
const file: TeachingFile = {
  key: 'attachment/lecture.txt',
  name: 'lecture.txt',
  url: 'https://selearning.nju.edu.cn/pluginfile.php/1/mod_assign/introattachment/0/lecture.txt',
  subfolders: [],
};
async function setup(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), 'teachshelf-material-sync-')),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const repo = await Repository.open(path.join(root, 'library'), { create: true });
  t.after(() => repo.close());
  await repo.createCourse({ name: '教学同步' });
  const course = repo.state.courses[0];
  const connection = (
    await repo.connectTeachingCourse({
      courseID: course.id,
      remoteCourseID: '17',
      accountID: '99',
      remoteTitle: '网站课程',
    })
  ).connection;
  let n = 0;
  async function download(content = 'lecture') {
    const source = path.join(root, `download-${n++}.txt`);
    await fs.writeFile(source, content);
    return source;
  }
  async function sync(content = 'lecture', options = {}) {
    const source = await download(content);
    return {
      ...(await repo.syncTeachingFile(connection.id, activity, file, source, options)),
      source,
    };
  }
  return { root, repo, course, connection, download, sync };
}
test('first file import binds source folders and digest; identical remote bytes leave index and files unchanged', async (t) => {
  const f = await setup(t);
  assert.equal(teachingFileState(f.repo.state, f.connection.id, activity, file), 'new');
  const added = await f.sync();
  assert.equal(added.status, 'added');
  const material = f.repo.state.materials[0],
    link = (f.repo.state.teachingConnections[0].items as any[])[0];
  assert.equal(link.localID, material.id);
  assert.equal(link.digest, await digestFile(added.source));
  assert.equal(material.sourcePath, `teaching://${f.connection.id}/file:assign:91:${file.key}`);
  assert.equal(f.repo.state.materialFolders.length, 3);
  for (const folder of f.repo.state.materialFolders) assert.equal(folder.isMissing, undefined);
  const before = await fs.readFile(path.join(f.repo.root, 'library.json')),
    same = await f.sync();
  assert.equal(same.status, 'unchanged');
  assert.equal(f.repo.state.materials.length, 1);
  assert.deepEqual(await fs.readFile(path.join(f.repo.root, 'library.json')), before);
  assert.equal(await fs.readFile(added.source, 'utf8'), 'lecture');
});
test('remote updates preserve local metadata, moved folder and order while updating active and exception references only', async (t) => {
  const f = await setup(t),
    first = await f.sync(),
    old = f.repo.state.materials[0],
    originalPath = await f.repo.resolveMaterial(old.id);
  await f.repo.createFolder({ courseID: f.course.id, name: '我的分类' });
  const folder = f.repo.state.materialFolders.at(-1)!;
  await f.repo.updateMaterial(old.id, {
    title: '我的讲义',
    tags: '重点',
    notes: '本地笔记',
    isFavorite: true,
    category: '参考资料',
  });
  await f.repo.moveMaterials([old.id], f.course.id, folder.id);
  const movedPath = await f.repo.resolveMaterial(old.id),
    now = swiftNow();
  await f.repo.savePlan({
    title: '当前任务',
    materialIDs: [old.id],
    startsAt: now,
    repeatRule: { frequency: 'daily', interval: 1 },
    exceptions: [],
  });
  const active = f.repo.state.tasks[0];
  await f.repo.savePlan(
    { id: active.id, title: '单次任务', materialIDs: [old.id] },
    'thisOccurrence',
    now + 86400,
  );
  await f.repo.savePlan({
    title: '归档任务',
    materialIDs: [old.id],
    startsAt: now - 86400,
    completedAt: now,
    archivedAt: now,
  });
  const archived = f.repo.state.tasks[1];
  const result = await f.sync('new edition'),
    current = f.repo.state.materials.find((m) => m.id === result.materialID)!;
  assert.equal(result.status, 'updated');
  assert.notEqual(current.id, old.id);
  assert.equal(current.title, '我的讲义');
  assert.equal(current.tags, '重点');
  assert.equal(current.notes, '本地笔记');
  assert.equal(current.isFavorite, true);
  assert.equal(current.category, '参考资料');
  assert.equal(current.folderID, folder.id);
  assert.deepEqual(f.repo.state.tasks[0].materialIDs, [current.id]);
  assert.deepEqual((f.repo.state.tasks[0].exceptions![0].details as any).materialIDs, [current.id]);
  assert.deepEqual(f.repo.state.tasks.find((p) => p.id === archived.id)!.materialIDs, [old.id]);
  assert.equal(await fs.readFile(await f.repo.resolveMaterial(old.id), 'utf8'), 'lecture');
  assert.equal(await fs.readFile(movedPath, 'utf8'), 'lecture');
  assert.equal(await fs.readFile(first.source, 'utf8'), 'lecture');
  assert.notEqual(await f.repo.resolveMaterial(old.id), originalPath);
  const versions = await f.repo.listMaterialVersions(current.id);
  assert.equal(versions.versions.length, 2);
  assert.equal(versions.currentID, current.id);
  await f.repo.sync();
  assert.equal(f.repo.state.materials.length, 2);
  assert.equal(
    f.repo.state.materialFolders.some((v) => v.name === '历史版本'),
    true,
  );
});
test('local file edits require confirmation and are preserved as a historical version when accepted', async (t) => {
  const f = await setup(t),
    first = await f.sync(),
    old = f.repo.state.materials[0],
    location = await f.repo.resolveMaterial(old.id);
  await fs.writeFile(location, 'my edited contents');
  await f.repo.sync();
  const state = f.repo.state;
  assert.equal((await f.sync('new website')).status, 'local-modified');
  assert.deepEqual(f.repo.state, state);
  assert.equal(await fs.readFile(location, 'utf8'), 'my edited contents');
  const accepted = await f.sync('new website', { allowLocalChanges: true });
  assert.equal(accepted.status, 'updated');
  assert.equal(
    await fs.readFile(await f.repo.resolveMaterial(old.id), 'utf8'),
    'my edited contents',
  );
  assert.equal(await fs.readFile(location, 'utf8'), 'my edited contents');
  assert.equal(
    await fs.readFile(await f.repo.resolveMaterial(accepted.materialID!), 'utf8'),
    'new website',
  );
  assert.equal(await fs.readFile(first.source, 'utf8'), 'lecture');
});
test('missing bytes require explicit restoration and a same-name unrelated occupant is never stolen', async (t) => {
  const f = await setup(t);
  await f.sync();
  const old = f.repo.state.materials[0],
    location = await f.repo.resolveMaterial(old.id);
  await fs.rename(location, path.join(f.root, 'moved-away'));
  await f.repo.sync();
  await fs.writeFile(location, 'unrelated new file');
  assert.equal(await f.repo.teachingFileState(f.connection.id, activity, file), 'missing');
  assert.equal((await f.sync()).status, 'missing');
  assert.equal(f.repo.state.materials.length, 1);
  const result = await f.sync('restored website', { restoreMissing: true });
  assert.equal(result.status, 'updated');
  assert.equal(await fs.readFile(location, 'utf8'), 'unrelated new file');
  assert.equal(f.repo.state.materials.find((m) => m.id === old.id)!.isMissing, true);
  assert.equal(
    await fs.readFile(await f.repo.resolveMaterial(result.materialID!), 'utf8'),
    'restored website',
  );
});
test('deleted and transferred sources remain ignored until explicitly reset', async (t) => {
  const f = await setup(t);
  await f.sync();
  const old = f.repo.state.materials[0],
    original = await f.repo.resolveMaterial(old.id);
  await f.repo.removeMaterials([old.id]);
  assert.equal((await f.sync()).status, 'ignored');
  assert.equal(f.repo.state.materials.length, 0);
  assert.equal(await fs.readFile(original, 'utf8'), 'lecture');
  await f.repo.restoreIgnoredTeachingItems(f.connection.id);
  const reintroduced = await f.sync();
  assert.equal(reintroduced.status, 'added');
  await f.repo.createCourse({ name: '转移目标' });
  await f.repo.moveMaterials([reintroduced.materialID!], f.repo.state.courses[1].id);
  assert.equal((await f.sync('later')).status, 'ignored');
});
test('restoring history creates a third version and retains current bytes, selected history, and archived links', async (t) => {
  const f = await setup(t),
    first = await f.sync(),
    second = await f.sync('version two'),
    current = f.repo.state.materials.find((m) => m.id === second.materialID)!;
  const latestPath = await f.repo.resolveMaterial(current.id),
    historicalPath = await f.repo.resolveMaterial(first.materialID!);
  await f.repo.savePlan({ title: 'active', materialIDs: [current.id] });
  await f.repo.savePlan({
    title: 'archived',
    materialIDs: [current.id],
    startsAt: swiftNow() - 86400,
    completedAt: swiftNow(),
    archivedAt: swiftNow(),
  });
  const restored = await f.repo.restoreMaterialVersion(
    current.id,
    first.materialID!,
    f.repo.snapshot().revision,
  );
  assert.notEqual(restored.materialID, first.materialID);
  assert.notEqual(restored.materialID, current.id);
  assert.equal(f.repo.state.materials.length, 3);
  assert.equal(
    await fs.readFile(await f.repo.resolveMaterial(restored.materialID), 'utf8'),
    'lecture',
  );
  assert.equal(await fs.readFile(await f.repo.resolveMaterial(current.id), 'utf8'), 'version two');
  assert.equal(await fs.readFile(latestPath, 'utf8'), 'version two');
  assert.equal(await fs.readFile(historicalPath, 'utf8'), 'lecture');
  assert.deepEqual(f.repo.state.tasks[0].materialIDs, [restored.materialID]);
  assert.deepEqual(f.repo.state.tasks[1].materialIDs, [current.id]);
  assert.equal(
    (await f.repo.listMaterialVersions(first.materialID!)).currentID,
    restored.materialID,
  );
  assert.equal((await f.sync('version two')).status, 'local-modified');
});
test('disconnected source versions remain browsable and restorable offline', async (t) => {
  const f = await setup(t),
    first = await f.sync(),
    second = await f.sync('two');
  await f.repo.disconnectTeachingWebsite(f.connection.id);
  const result = await f.repo.restoreMaterialVersion(second.materialID!, first.materialID!);
  await f.repo.sync();
  assert.equal((await f.repo.listMaterialVersions(result.materialID)).versions.length, 3);
  assert.equal(
    await fs.readFile(await f.repo.resolveMaterial(result.materialID), 'utf8'),
    'lecture',
  );
  assert.equal(await fs.readFile(await f.repo.resolveMaterial(second.materialID!), 'utf8'), 'two');
});
test('backup and restart retain version history and source mappings without importing orphan recovery copies', async (t) => {
  const f = await setup(t),
    first = await f.sync(),
    second = await f.sync('two');
  const backup = path.join(f.root, 'backup');
  await f.repo.backup(backup);
  const reopened = await Repository.open(backup);
  t.after(() => reopened.close());
  assert.equal(reopened.state.materials.length, 2);
  assert.equal((await reopened.listMaterialVersions(second.materialID!)).versions.length, 2);
  assert.equal(
    await fs.readFile(await reopened.resolveMaterial(first.materialID!), 'utf8'),
    'lecture',
  );
  assert.equal(
    (await reopened.syncTeachingFile(f.connection.id, activity, file, await f.download('two')))
      .status,
    'unchanged',
  );
});
test('failed index write rolls back all new version files and leaves current and original downloads intact', async (t) => {
  const f = await setup(t),
    first = await f.sync(),
    source = await f.download('two');
  await f.repo.sync();
  const before = f.repo.state,
    currentFile = await f.repo.resolveMaterial(first.materialID!);
  await fs.rm(path.join(f.repo.root, 'library.json.bak'));
  await fs.mkdir(path.join(f.repo.root, 'library.json.bak'));
  await assert.rejects(f.repo.syncTeachingFile(f.connection.id, activity, file, source));
  assert.deepEqual(f.repo.state, before);
  assert.equal(await fs.readFile(currentFile, 'utf8'), 'lecture');
  assert.equal(await fs.readFile(source, 'utf8'), 'two');
  assert.ok(!(await fs.readdir(f.repo.root)).some((name) => name.startsWith('.desktop-copy-')));
});
test('commit-time source verification catches a local edit after approval and restores the old index', async (t) => {
  const f = await setup(t),
    first = await f.sync(),
    source = await f.download('two');
  await f.repo.sync();
  const state = f.repo.state,
    ops: FileOp[] = [],
    current = await f.repo.resolveMaterial(first.materialID!),
    before = await fs.readFile(path.join(f.repo.root, 'library.json'));
  await prepareTeachingFile(f.repo.root, state, f.connection.id, activity, file, source, {}, ops);
  // The files checkpoint is inside the transaction, before publishing its index.
  const handle = await fs.open(current, 'r+');
  try {
    await assert.rejects(
      commitTransaction(f.repo.root, state, ops, (point) => {
        if (point === 'files') {
          const data = Buffer.from('USER');
          requireWrite(handle.fd, data);
        }
      }),
      /原文件已变化/,
    );
  } finally {
    await handle.close();
  }
  await recoverTransaction(f.repo.root);
  assert.deepEqual(await fs.readFile(path.join(f.repo.root, 'library.json')), before);
  assert.match(await fs.readFile(current, 'utf8'), /^USER/);
});
import { writeSync as requireWrite } from 'node:fs';
test('invalid downloads, foreign version IDs, stale confirmation and unsafe source paths cannot write', async (t) => {
  const f = await setup(t),
    before = f.repo.state;
  await assert.rejects(
    f.repo.syncTeachingFile(
      f.connection.id,
      activity,
      file,
      await f.download('<html>login</html>'),
    ),
  );
  assert.deepEqual(f.repo.state, before);
  await assert.rejects(
    f.repo.syncTeachingFile(
      f.connection.id,
      activity,
      { ...file, name: '../escape.txt' },
      await f.download(),
    ),
  );
  const first = await f.sync(),
    second = await f.sync('two'),
    revision = f.repo.snapshot().revision;
  await f.repo.updateCourse(f.course.id, { teacher: 'changed' });
  await assert.rejects(
    f.repo.restoreMaterialVersion(second.materialID!, first.materialID!, revision),
    /变化/,
  );
  await assert.rejects(
    f.repo.restoreMaterialVersion(second.materialID!, '11111111-2222-4333-8444-000000000000'),
    /不存在/,
  );
});
test('same-named activity folders remain distinct and dissolved mappings are not recreated', async (t) => {
  const f = await setup(t),
    a = {
      ...activity,
      kind: 'folder',
      id: '101',
      url: 'https://selearning.nju.edu.cn/mod/folder/view.php?id=101',
      title: 'same name',
    },
    b = { ...a, id: '102', url: 'https://selearning.nju.edu.cn/mod/folder/view.php?id=102' },
    source = await f.download();
  const first = await f.repo.syncTeachingFile(f.connection.id, a, file, source),
    second = await f.repo.syncTeachingFile(f.connection.id, b, file, source);
  const one = f.repo.state.materials.find((m) => m.id === first.materialID)!,
    two = f.repo.state.materials.find((m) => m.id === second.materialID)!;
  assert.notEqual(one.folderID, two.folderID);
  await f.repo.dissolveFolder(one.folderID!);
  const count = f.repo.state.materialFolders.length;
  await f.repo.syncTeachingFile(
    f.connection.id,
    a,
    { ...file, key: 'new-file', name: 'second.txt' },
    source,
  );
  assert.equal(f.repo.state.materialFolders.length, count);
});
for (const checkpoint of ['journal', 'files', 'index'])
  test(`version transaction interruption at ${checkpoint} recovers all mappings and bytes together`, async (t) => {
    const f = await setup(t),
      first = await f.sync(),
      source = await f.download('second');
    await f.repo.sync();
    const state = f.repo.state,
      ops: FileOp[] = [],
      originalPath = await f.repo.resolveMaterial(first.materialID!);
    const change = await prepareTeachingFile(
      f.repo.root,
      state,
      f.connection.id,
      activity,
      file,
      source,
      {},
      ops,
    );
    await f.repo.close();
    await assert.rejects(
      commitTransaction(f.repo.root, state, ops, (point) => {
        if (point === checkpoint) throw new Error('simulated termination');
      }),
      /simulated/,
    );
    await recoverTransaction(f.repo.root);
    const reopened = await Repository.open(f.repo.root);
    t.after(() => reopened.close());
    assert.equal(reopened.state.materials.length, checkpoint === 'index' ? 2 : 1);
    assert.equal(await fs.readFile(originalPath, 'utf8'), 'lecture');
    assert.equal(await fs.readFile(source, 'utf8'), 'second');
    const currentID = (reopened.state.teachingConnections[0].items as any[])[0].localID;
    assert.equal(currentID, checkpoint === 'index' ? change.materialID : first.materialID);
    assert.ok(typeof currentID === 'string');
    assert.equal(
      await fs.readFile(await reopened.resolveMaterial(currentID), 'utf8'),
      checkpoint === 'index' ? 'second' : 'lecture',
    );
  });
test('failed version restoration retains the selected historical file and current file', async (t) => {
  const f = await setup(t),
    first = await f.sync(),
    second = await f.sync('second');
  await f.repo.sync();
  const before = f.repo.state;
  const historical = await f.repo.resolveMaterial(first.materialID!),
    current = await f.repo.resolveMaterial(second.materialID!);
  await fs.rm(path.join(f.repo.root, 'library.json.bak'));
  await fs.mkdir(path.join(f.repo.root, 'library.json.bak'));
  await assert.rejects(f.repo.restoreMaterialVersion(second.materialID!, first.materialID!));
  assert.deepEqual(f.repo.state, before);
  assert.equal(await fs.readFile(historical, 'utf8'), 'lecture');
  assert.equal(await fs.readFile(current, 'utf8'), 'second');
});
test('exports a schema-9 teaching-version state for unchanged production Swift decoding', async (t) => {
  const f = await setup(t),
    first = await f.sync(),
    second = await f.sync('second');
  await f.repo.restoreMaterialVersion(second.materialID!, first.materialID!);
  await f.repo.sync();
  if (process.env.TEACHSHELF_MATERIAL_ROUNDTRIP)
    await fs.writeFile(
      process.env.TEACHSHELF_MATERIAL_ROUNDTRIP,
      JSON.stringify(f.repo.state, null, 2),
    );
  assert.equal(f.repo.state.materials.length, 3);
});
test('history target collisions retain the chosen storage name across sync and reopening without reviving orphan copies', async (t) => {
  const f = await setup(t),
    first = await f.sync(),
    old = f.repo.state.materials[0],
    original = await f.repo.resolveMaterial(old.id);
  const collision = path.join(
    f.repo.root,
    materialRoot(f.repo.state, f.course.id),
    '教学网站',
    '历史版本',
    `${old.id}-${old.originalName}`,
  );
  await fs.mkdir(path.dirname(collision), { recursive: true });
  await fs.writeFile(collision, 'unindexed occupant');
  const second = await f.sync('two'),
    history = f.repo.state.materials.find((m) => m.id === first.materialID)!;
  assert.ok(history.storageName);
  const historicalPath = await f.repo.resolveMaterial(history.id);
  assert.notEqual(historicalPath, collision);
  await f.repo.sync();
  await f.repo.close();
  const reopened = await Repository.open(f.repo.root);
  t.after(() => reopened.close());
  await reopened.sync();
  assert.equal(reopened.state.materials.length, 2);
  assert.equal(await reopened.resolveMaterial(history.id), historicalPath);
  assert.equal(
    reopened.state.materials.find((m) => m.id === history.id)!.storageName,
    history.storageName,
  );
  assert.equal(await fs.readFile(collision, 'utf8'), 'unindexed occupant');
  assert.equal(await fs.readFile(original, 'utf8'), 'lecture');
  assert.equal(await fs.readFile(historicalPath, 'utf8'), 'lecture');
  assert.equal((await reopened.listMaterialVersions(second.materialID!)).versions.length, 2);
});
test('a cancellation guard is checked after staging copies and rolls back the version transaction', async (t) => {
  const f = await setup(t),
    first = await f.sync(),
    source = await f.download('two');
  await f.repo.sync();
  const before = f.repo.state,
    originalCopy = fs.copyFile;
  let cancelled = false;
  t.mock.method(fs, 'copyFile', async (...args: Parameters<typeof fs.copyFile>) => {
    await originalCopy(...args);
    if (path.basename(String(args[1])).startsWith('.desktop-copy-')) cancelled = true;
  });
  await assert.rejects(
    f.repo.withMutationGuard(
      () => {
        if (cancelled) throw new Error('cancelled during staging');
      },
      () => f.repo.syncTeachingFile(f.connection.id, activity, file, source),
    ),
    /cancelled/,
  );
  assert.equal(cancelled, true);
  assert.deepEqual(f.repo.state, before);
  assert.equal(
    await fs.readFile(await f.repo.resolveMaterial(first.materialID!), 'utf8'),
    'lecture',
  );
  await assert.rejects(fs.access(path.join(f.repo.root, '.desktop-transaction.json')));
});
test('an external index change during a version transaction is not overwritten', async (t) => {
  const f = await setup(t),
    source = await f.download('new'),
    state = f.repo.state,
    ops: FileOp[] = [];
  await prepareTeachingFile(f.repo.root, state, f.connection.id, activity, file, source, {}, ops);
  const external = { ...f.repo.state, externalEdit: 'must preserve' },
    index = path.join(f.repo.root, 'library.json');
  const handle = await fs.open(index, 'r+');
  try {
    await assert.rejects(
      commitTransaction(f.repo.root, state, ops, (point) => {
        if (point === 'files') {
          requireTruncate(handle.fd, 0);
          requireWrite(handle.fd, JSON.stringify(external));
        }
      }),
      /另一程序修改/,
    );
  } finally {
    await handle.close();
  }
  assert.deepEqual(JSON.parse(await fs.readFile(index, 'utf8')), external);
  assert.ok(await fs.stat(path.join(f.repo.root, '.desktop-transaction.json')));
  assert.equal(await fs.readFile(source, 'utf8'), 'new');
});
import { ftruncateSync as requireTruncate } from 'node:fs';
