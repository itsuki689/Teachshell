import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Repository, copyLibrary } from '../electron/services/storage/repository.ts';
import { installWebsiteUpdateIPC } from '../electron/main/website-update-ipc.ts';
import type { WebsiteBrowser } from '../electron/services/website/browser.ts';

test('version restore authorization binds the listed revision and library identity, including identical copied libraries', async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'version-ipc-')));
  const repo = await Repository.open(path.join(root, 'library'), { create: true });
  let active = repo;
  let copied: Repository | undefined;
  try {
    await repo.createCourse({ name: '版本课程' });
    const { connection } = await repo.connectTeachingCourse({
      courseID: repo.state.courses[0].id,
      remoteCourseID: '17',
      remoteTitle: '版本课程',
      accountID: '99',
    });
    const activity = {
      id: '91',
      kind: 'resource',
      title: '讲义',
      sectionID: '1',
      section: '资料',
      url: 'https://selearning.nju.edu.cn/mod/resource/view.php?id=91',
    };
    const file = {
      key: 'lecture.txt',
      name: 'lecture.txt',
      url: 'https://selearning.nju.edu.cn/pluginfile.php/1/mod_resource/content/0/lecture.txt',
      subfolders: [],
    };
    const payload = path.join(root, 'payload.txt');
    await fs.writeFile(payload, 'first');
    const first = await repo.syncTeachingFile(connection.id, activity, file, payload);
    await fs.writeFile(payload, 'second');
    const second = await repo.syncTeachingFile(connection.id, activity, file, payload);
    const before = repo.snapshot().revision;
    const list = repo.listMaterialVersions.bind(repo);
    repo.listMaterialVersions = async (id) => {
      const result = await list(id);
      // A different client commits after the serial read and before IPC returns.
      await repo.updateMaterial(id, { notes: 'Concurrent note must survive' });
      return result;
    };
    const handlers = new Map<string, (...args: any[]) => unknown>();
    const clear = installWebsiteUpdateIPC({
      handle: (name, schema, fn) =>
        handlers.set(name, (...args) => fn(...(schema.parse(args) as unknown[]))),
      repository: () => active,
      browser: () => ({}) as WebsiteBrowser,
      cacheRoot: path.join(root, 'cache'),
    });
    const listing = (await handlers.get('listMaterialVersions')!(second.materialID!)) as {
      revision: string;
      proposalID: string;
    };
    assert.equal(listing.revision, before);
    assert.notEqual(listing.revision, repo.snapshot().revision);
    await assert.rejects(
      async () =>
        handlers.get('restoreMaterialVersion')!(
          second.materialID!,
          first.materialID!,
          listing.revision,
          listing.proposalID,
        ),
      /资料库已变化/,
    );
    assert.equal(repo.state.materials.length, 2);
    assert.equal(
      repo.state.materials.find((m) => m.id === second.materialID)?.notes,
      'Concurrent note must survive',
    );
    repo.listMaterialVersions = list;
    const approved = (await handlers.get('listMaterialVersions')!(second.materialID!)) as {
      revision: string;
      proposalID: string;
    };
    const destination = path.join(root, 'copy');
    await copyLibrary(repo.root, destination, true);
    copied = await Repository.open(destination);
    assert.equal(copied.snapshot().revision, approved.revision);
    active = copied;
    clear();
    await assert.rejects(
      async () =>
        handlers.get('restoreMaterialVersion')!(
          second.materialID!,
          first.materialID!,
          approved.revision,
          approved.proposalID,
        ),
      /资料库或版本审核已变化/,
    );
    assert.equal(copied.state.materials.length, 2);
    assert.equal(repo.state.materials.length, 2);
  } finally {
    await copied?.close();
    await repo.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
