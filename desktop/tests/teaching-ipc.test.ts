import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Repository } from '../electron/services/storage/repository.ts';
import { installTeachingIPC } from '../electron/main/teaching-ipc.ts';
import type { WebsiteProposal } from '../electron/main/teaching-ipc.ts';
import type { WebsiteBrowser } from '../electron/services/website/browser.ts';
import type { WebsiteResult } from '../shared/api.ts';
test('website IPC binds only observed identity, previews without writes, and confirms a re-observed assignment', async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'teachshelf-web-ipc-'))),
    repo = await Repository.open(path.join(root, 'library'), { create: true });
  try {
    await repo.createCourse({ name: '教学同步测试' });
    await repo.sync();
    const courseID = repo.state.courses[0].id,
      courseURL = 'https://selearning.nju.edu.cn/course/view.php?id=17',
      activity = {
        id: '91',
        kind: 'assign',
        title: '本周作业',
        sectionID: 'week1',
        section: '第一周',
        url: 'https://selearning.nju.edu.cn/mod/assign/view.php?id=91',
      };
    const base = {
      accountID: '99',
      courseID: '17',
      files: [],
      activities: [],
      intro: '',
      deadlineText: '',
      submitted: false,
    };
    let current: WebsiteResult = {
      url: courseURL,
      title: '网页课程',
      data: { ...base, kind: 'course', title: '网页课程', activities: [activity] },
    };
    const proposals = new Map<string, WebsiteProposal>(),
      handlers = new Map<string, (...args: any[]) => unknown>();
    const browser = { inspect: async () => structuredClone(current) } as unknown as WebsiteBrowser;
    installTeachingIPC({
      repository: () => repo,
      browser: () => browser,
      proposals,
      handle: (name, schema, fn) =>
        handlers.set(name, (...input) => fn(...(schema.parse(input) as unknown[]))),
    });
    async function call(name: string, ...input: unknown[]) {
      return (await handlers.get(name)!(...input)) as any;
    }
    function observe() {
      const id = randomUUID();
      proposals.set(id, {
        result: structuredClone(current),
        root: repo.root,
        revision: repo.snapshot().revision,
        created: Date.now(),
      });
      return id;
    }
    const courseProposal = observe();
    current.data = { ...(current.data as object), accountID: '100' };
    await assert.rejects(call('connectWebsite', courseProposal, courseID, false), /账号/);
    assert.equal(repo.state.teachingConnections.length, 0);
    current.data = { ...(current.data as object), accountID: '99' };
    const connected = await call('connectWebsite', courseProposal, courseID, false);
    const connectionID = connected.connection.id;
    current = {
      url: activity.url,
      title: activity.title,
      data: {
        ...base,
        kind: 'assign',
        title: activity.title,
        intro: '请认真完成。',
        deadlineText: '2099年10月30日 23:59',
      },
    };
    const assignmentProposal = observe(),
      before = await fs.readFile(path.join(repo.root, 'library.json'));
    const preview = await call('previewWebsiteAssignment', assignmentProposal, connectionID);
    assert.equal(preview.reviewable, true);
    assert.equal(preview.proposed.title, activity.title);
    assert.deepEqual(await fs.readFile(path.join(repo.root, 'library.json')), before);
    current.data = { ...(current.data as object), accountID: '100' };
    await assert.rejects(call('applyWebsiteAssignment', preview.proposalID), /变化/);
    assert.equal(repo.state.tasks.length, 0);
    current.data = { ...(current.data as object), accountID: '99' };
    const applied = await call('applyWebsiteAssignment', preview.proposalID);
    assert.equal(applied.snapshot.state.tasks.length, 1);
    assert.equal(repo.state.tasks[0].courseID, courseID);
    assert.match(repo.state.tasks[0].content, /请认真完成/);
    await assert.rejects(call('applyWebsiteAssignment', preview.proposalID), /过期/);
    const newPreview = await call('previewWebsiteAssignment', observe(), connectionID);
    await repo.updateCourse(courseID, { teacher: '人工编辑' });
    await assert.rejects(call('applyWebsiteAssignment', newPreview.proposalID));
    await call('disconnectWebsite', connectionID);
    assert.equal(repo.state.teachingConnections.length, 0);
    assert.equal(repo.state.tasks.length, 1);
  } finally {
    await repo.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
