import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  trustedSender,
  courseInput,
  coursePatch,
  materialPatch,
  folderInput,
  taskInput,
  settingsInput,
} from '../electron/main/validation.ts';
test('IPC requires exact app window, trusted main frame and URL', () => {
  assert.equal(trustedSender(5, 'file:///app/index.html', true, 5, 'file:///app/index.html'), true);
  for (const args of [
    [6, 'file:///app/index.html', true],
    [5, 'https://selearning.nju.edu.cn', true],
    [5, 'file:///app/index.html', false],
    [5, 'file:///app/index.html#spoof', true],
  ] as const)
    assert.equal(trustedSender(...args, 5, 'file:///app/index.html'), false);
});
test('renderer cannot inject filesystem paths, IDs or unvalidated properties into metadata updates', () => {
  assert.throws(() => courseInput.parse({ name: '网络', storageDirectory: '../../' }));
  assert.throws(() => coursePatch.parse({ name: 'x', id: 'bad' }));
  assert.throws(() => materialPatch.parse({ storedPath: '/etc/passwd' }));
  assert.throws(() => folderInput.parse({ name: 'x', storageDirectory: 'files/x' }));
  assert.throws(() => taskInput.parse({ title: 'x', materialIDs: ['bad'] }));
  assert.throws(() => settingsInput.parse({ apiKey: 'secret\r\nInjected: true' }));
  assert.throws(() => settingsInput.parse({ mcpPort: 80 }));
});
