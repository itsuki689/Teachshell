/** Real renderer/main regressions; synthetic local data and model only. */
import { _electron } from 'playwright';
import electronPath from 'electron';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const executable = process.env.TEACHSHELF_EXECUTABLE;
if (executable && !path.isAbsolute(executable)) throw new Error('Executable path must be absolute');
const root = await fs.realpath(
  await fs.mkdtemp(path.join(os.tmpdir(), 'teachshell-component-sync-')),
);
const evidence = process.env.TEACHSHELF_SCREENSHOT_DIR ?? os.tmpdir();
await fs.mkdir(evidence, { recursive: true });
const errors = [],
  steps = [];
let app, page;
const server = http.createServer(async (request, response) => {
  for await (const _chunk of request) {
    /* Consume the synthetic local request. */
  }
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(
    JSON.stringify({ choices: [{ message: { role: 'assistant', content: '合成模型回答' } }] }),
  );
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
async function check(name, action) {
  await action();
  steps.push(name);
  console.log('PASS', name);
}
async function snapshot() {
  return page.evaluate(() => window.teachshelf.snapshot());
}
async function holdNextReply(method, beforeOperation = false) {
  await app.evaluate(
    ({ ipcMain }, { method, beforeOperation }) => {
      const key = 'teachshelf:' + method,
        original = ipcMain._invokeHandlers.get(key);
      if (!original) throw new Error('Missing actual IPC handler: ' + method);
      globalThis.componentSyncHeld = false;
      ipcMain.removeHandler(key);
      ipcMain.handle(key, async (...args) => {
        ipcMain.removeHandler(key);
        ipcMain.handle(key, original);
        const pause = async () => {
          globalThis.componentSyncHeld = true;
          await new Promise((resolve) => {
            globalThis.componentSyncRelease = resolve;
          });
        };
        if (beforeOperation) await pause();
        const result = await original(...args);
        if (!beforeOperation) await pause();
        return result;
      });
    },
    { method, beforeOperation },
  );
}
async function held() {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await app.evaluate(() => globalThis.componentSyncHeld)) return;
    await page.waitForTimeout(20);
  }
  throw new Error('Expected actual IPC result did not reach reply barrier');
}
async function releaseReply() {
  await app.evaluate(() => globalThis.componentSyncRelease?.());
}
try {
  app = await _electron.launch({
    executablePath: executable ?? electronPath,
    args: executable ? [] : [desktop],
    cwd: desktop,
    env: { ...process.env, TEACHSHELF_TEST_ROOT: root },
    timeout: 30000,
  });
  page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.waitForSelector('.app-body');
  const [a, b] = await page.evaluate(async () => {
    await window.teachshelf.createCourse({ name: '审查课程甲' });
    return (await window.teachshelf.createCourse({ name: '审查课程乙' })).state.courses;
  });
  const source = path.join(root, '同步验收课件.txt');
  await fs.writeFile(source, 'Synthetic component synchronization fixture.');
  await app.evaluate(({ dialog }, source) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [source] });
  }, source);
  await page.evaluate(() => window.teachshelf.importFiles({ category: '课件', copy: true }));
  const material = (await snapshot()).state.materials[0];
  await page.getByRole('table').getByText(material.title, { exact: true }).click();
  const inspector = page.locator('.inspector');
  await inspector.waitFor();
  await check('Inspector keeps edits typed while a previous save response is pending', async () => {
    await holdNextReply('updateMaterial');
    await inspector.getByLabel('备注', { exact: true }).fill('点击保存时的备注');
    await inspector.getByRole('button', { name: '保存', exact: true }).click();
    await held();
    await inspector.getByLabel('备注', { exact: true }).fill('保存返回前继续输入的新草稿');
    await releaseReply();
    await page.waitForFunction(() => !document.querySelector('.statusbar .spinning'));
    assert.equal(
      await inspector.getByLabel('备注', { exact: true }).inputValue(),
      '保存返回前继续输入的新草稿',
    );
    assert.equal((await snapshot()).state.materials[0].notes, '点击保存时的备注');
    await inspector.getByRole('button', { name: '保存', exact: true }).click();
    await inspector.getByRole('button', { name: '保存', exact: true }).waitFor({ state: 'hidden' });
    assert.equal((await snapshot()).state.materials[0].notes, '保存返回前继续输入的新草稿');
  });
  await check(
    'Continued drafts keep conflict protection for submitted and untouched fields',
    async () => {
      for (const alreadySubmitted of [true, false]) {
        await holdNextReply('updateMaterial', !alreadySubmitted);
        await inspector
          .getByLabel(alreadySubmitted ? '备注' : '显示标题', { exact: true })
          .fill(alreadySubmitted ? '本次提交的备注' : '本次只提交标题');
        await inspector.getByRole('button', { name: '保存', exact: true }).click();
        await held();
        await inspector.getByLabel('备注', { exact: true }).fill('不应静默覆盖其他操作的续写');
        await page.evaluate(
          (id) => window.teachshelf.updateMaterial(id, { notes: '另一操作的最新备注' }),
          material.id,
        );
        await releaseReply();
        await page.waitForFunction(() => !document.querySelector('.statusbar .spinning'));
        assert.equal(
          await inspector.getByLabel('备注', { exact: true }).inputValue(),
          '不应静默覆盖其他操作的续写',
        );
        await inspector.getByRole('button', { name: '保存', exact: true }).click();
        await page.getByRole('alert').waitFor();
        assert.equal((await snapshot()).state.materials[0].notes, '另一操作的最新备注');
        await inspector.getByRole('button', { name: '还原', exact: true }).click();
        await page.getByRole('button', { name: '关闭错误提示', exact: true }).click();
        await inspector.getByLabel('备注', { exact: true }).fill('保存返回前继续输入的新草稿');
        await inspector.getByRole('button', { name: '保存', exact: true }).click();
        await inspector
          .getByRole('button', { name: '保存', exact: true })
          .waitFor({ state: 'hidden' });
      }
    },
  );
  await check(
    'Inspector close asks before discarding a draft and cancel preserves it',
    async () => {
      await inspector.getByLabel('备注', { exact: true }).fill('关闭前未保存草稿');
      await inspector.getByRole('button', { name: '关闭资料信息', exact: true }).click();
      const confirm = page.getByRole('dialog', { name: '丢弃未保存的资料修改？', exact: true });
      await confirm.getByRole('button', { name: '取消', exact: true }).click();
      assert.equal(
        await inspector.getByLabel('备注', { exact: true }).inputValue(),
        '关闭前未保存草稿',
      );
      await inspector.getByRole('button', { name: '关闭资料信息', exact: true }).click();
      await confirm.getByRole('button', { name: '丢弃修改', exact: true }).click();
      await inspector.waitFor({ state: 'hidden' });
      assert.equal((await snapshot()).state.materials[0].notes, '保存返回前继续输入的新草稿');
    },
  );
  await page.evaluate(
    async ([a, b]) => {
      await window.teachshelf.createHomeworkFolder(a.id, '', '共同作业目录');
      await window.teachshelf.createHomeworkFolder(b.id, '', '共同作业目录');
    },
    [a, b],
  );
  await page.locator('.sidebar').getByRole('button', { name: '作业文件夹', exact: true }).click();
  await page.getByLabel('作业所属课程', { exact: true }).selectOption(a.id);
  await page.getByRole('button', { name: '重命名 共同作业目录', exact: true }).waitFor();
  await check('Homework switch clears old rows before the new course listing returns', async () => {
    const previous = await page.locator('.homework-location .path-text').textContent();
    await holdNextReply('listHomework');
    await page.getByLabel('作业所属课程', { exact: true }).selectOption(b.id);
    await held();
    assert.equal(
      await page.getByRole('button', { name: '重命名 共同作业目录', exact: true }).count(),
      0,
    );
    assert.equal(
      await page.getByRole('button', { name: '新建文件夹', exact: true }).isDisabled(),
      true,
    );
    assert.equal(await page.locator('.homework-location').textContent(), '');
    await releaseReply();
    await page.getByRole('button', { name: '重命名 共同作业目录', exact: true }).waitFor();
    const next = await page.locator('.homework-location .path-text').textContent();
    assert.notEqual(next, previous);
    assert.match(next, /审查课程乙/);
    await page.getByRole('button', { name: '重命名 共同作业目录', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '重命名', exact: true });
    await dialog.getByLabel('名称', { exact: true }).fill('乙课程新名称');
    await dialog.getByRole('button', { name: '保存名称', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    await fs.access(path.join(previous, '共同作业目录'));
    await fs.access(path.join(next, '乙课程新名称'));
  });
  await check('Homework location follows a course rename without manual refresh', async () => {
    await page.evaluate(
      (id) => window.teachshelf.updateCourse(id, { name: '乙课程目录已更新' }),
      b.id,
    );
    await page.waitForFunction(() =>
      document.querySelector('.homework-location')?.textContent.includes('乙课程目录已更新'),
    );
    await page.getByRole('button', { name: '重命名 乙课程新名称', exact: true }).waitFor();
  });
  await page.evaluate(
    (port) =>
      window.teachshelf.saveSettings({
        baseURL: 'http://127.0.0.1:' + port + '/v1',
        model: 'synthetic',
      }),
    server.address().port,
  );
  await page
    .locator('.titlebar-actions')
    .getByRole('button', { name: '打开设置', exact: true })
    .click();
  await page.getByRole('tab', { name: 'AI 助手', exact: true }).click();
  await page.getByLabel('模型名称', { exact: true }).waitFor();
  await page.locator('.sidebar').getByRole('button', { name: 'AI 助手', exact: true }).click();
  await check('An old history reply cannot resurrect a cleared conversation', async () => {
    await holdNextReply('chatHistory');
    await page.getByLabel('给 AI 助手的消息', { exact: true }).fill('合成消息');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await held();
    await page.getByText('合成模型回答', { exact: true }).waitFor();
    await page.getByRole('button', { name: '新对话', exact: true }).click();
    await page.getByRole('button', { name: '清除并开始', exact: true }).click();
    await page.getByRole('heading', { name: '把想做的事告诉课屿', exact: true }).waitFor();
    assert.equal((await page.evaluate(() => window.teachshelf.chatHistory())).length, 0);
    await releaseReply();
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    assert.equal(await page.locator('.chat-message').count(), 0);
    assert.equal((await page.evaluate(() => window.teachshelf.chatHistory())).length, 0);
  });
  assert.deepEqual(errors, []);
  await fs.writeFile(
    path.join(evidence, 'teachshell-component-sync.json'),
    JSON.stringify({ steps, rendererErrors: errors, packaged: !!executable }, null, 2),
  );
  console.log(JSON.stringify({ passed: steps.length, rendererErrors: errors.length }));
} finally {
  if (app) {
    await app.evaluate(() => globalThis.componentSyncRelease?.()).catch(() => {});
    await app
      .evaluate(({ app, dialog }) => {
        // The fixture owns its unsaved drafts, including failure cleanup.
        dialog.showMessageBoxSync = () => 1;
        app.quit();
      })
      .catch(() => {});
    await app.close().catch(() => {});
  }
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(root, { recursive: true, force: true });
}
