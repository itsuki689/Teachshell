/** Browser plugin unavailable: real Electron UI + IPC + isolated local files. */
import { _electron } from 'playwright';
import electron from 'electron';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Repository } from '../electron/services/storage/repository.ts';

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'teachshell-refresh-')));
const evidence = process.env.TEACHSHELF_SCREENSHOT_DIR ?? os.tmpdir();
await fs.mkdir(evidence, { recursive: true });
const initial = await Repository.open(path.join(root, 'library'), { create: true });
await initial.createCourse({ name: '刷新验收课程' });
const courseID = initial.state.courses[0].id;
await initial.close();
let app, page;
const steps = [],
  errors = [];
const button = () => page.getByRole('button', { name: '刷新当前页面', exact: true });
const snapshot = () => page.evaluate(() => window.teachshelf.snapshot());
async function idle() {
  await page.waitForFunction(
    () =>
      !document.querySelector('.statusbar .spinning') &&
      document.querySelector('[data-toolbar-action=update]')?.getAttribute('aria-busy') === 'false',
  );
}
async function refresh() {
  await button().click();
  await idle();
  await page.locator('.statusbar').getByText('当前页面已刷新', { exact: true }).waitFor();
  assert.equal(await page.getByRole('dialog').count(), 0);
}
async function check(name, run) {
  await run();
  steps.push(name);
  console.log('PASS', name);
}
try {
  app = await _electron.launch({
    executablePath: process.env.TEACHSHELF_EXECUTABLE || electron,
    args: process.env.TEACHSHELF_EXECUTABLE ? [] : [desktop],
    cwd: desktop,
    env: { ...process.env, TEACHSHELF_TEST_ROOT: root },
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.waitForSelector('.app-body');
  await idle();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await check(
    'Course refresh rereads a renamed local file and preserves the course and search',
    async () => {
      const source = path.join(root, '刷新资料.txt');
      await fs.writeFile(source, 'unchanged original bytes');
      await app.evaluate(({ dialog }, source) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [source] });
      }, source);
      await page.evaluate(
        (courseID) => window.teachshelf.importFiles({ courseID, category: '课件', copy: true }),
        courseID,
      );
      await page.locator('.sidebar').getByText('刷新验收课程', { exact: true }).click();
      await page.getByLabel('搜索资料', { exact: true }).fill('刷新');
      const before = await snapshot(),
        material = before.state.materials[0];
      const renamed = path.join(
        path.dirname(path.join(before.root, material.storedPath)),
        '刷新后资料.txt',
      );
      await fs.rename(path.join(before.root, material.storedPath), renamed);
      await refresh();
      await page.getByRole('heading', { name: '刷新验收课程', exact: true }).waitFor();
      assert.equal(await page.getByLabel('搜索资料', { exact: true }).inputValue(), '刷新');
      assert.ok(
        (await snapshot()).state.materials.some(
          (m) => m.id === material.id && m.storedPath.endsWith('刷新后资料.txt'),
        ),
      );
      assert.equal(await fs.readFile(renamed, 'utf8'), 'unchanged original bytes');
      assert.equal(await fs.readFile(source, 'utf8'), 'unchanged original bytes');
    },
  );
  await check('Month, week and day refresh keeps the selected mode, date and filters', async () => {
    await page.locator('.sidebar').getByRole('button', { name: '计划', exact: true }).click();
    for (const name of ['计划月历视图', '查看课表', '计划日程视图']) {
      await page.getByRole('button', { name, exact: true }).click();
      const date = page.getByLabel(
        name === '计划月历视图' ? '月历月份' : name === '计划日程视图' ? '日程日期' : '跳转日期',
        {
          exact: true,
        },
      );
      await date.fill(name === '计划月历视图' ? '2031-04' : '2031-04-17');
      await page.getByLabel('搜索计划', { exact: true }).fill('刷新筛选');
      const value = await date.inputValue();
      const pressed = await page
        .getByRole('button', { name, exact: true })
        .getAttribute('aria-pressed');
      await refresh();
      assert.equal(await date.inputValue(), value);
      assert.equal(await page.getByLabel('搜索计划', { exact: true }).inputValue(), '刷新筛选');
      assert.equal(
        await page.getByRole('button', { name, exact: true }).getAttribute('aria-pressed'),
        pressed,
      );
    }
    await page.screenshot({ path: path.join(evidence, 'page-refresh-calendar.png') });
  });
  await check(
    'Homework refresh reads new files inside the selected subdirectory without resetting its search',
    async () => {
      await page.evaluate(() => window.teachshelf.createHomeworkFolder(undefined, '', '子目录'));
      await page
        .locator('.sidebar')
        .getByRole('button', { name: '作业文件夹', exact: true })
        .click();
      await page.getByRole('button', { name: '子目录', exact: true }).click();
      await idle();
      const listing = await page.evaluate(() =>
        window.teachshelf.listHomework(undefined, '子目录'),
      );
      await fs.writeFile(
        path.join(listing.root, '子目录', '新增作业.txt'),
        'homework refresh bytes',
      );
      await page.getByLabel('搜索当前作业文件夹', { exact: true }).fill('新增');
      await refresh();
      await page.locator('.homework-row').getByText('新增作业.txt', { exact: true }).waitFor();
      assert.equal(
        await page.getByLabel('搜索当前作业文件夹', { exact: true }).inputValue(),
        '新增',
      );
      assert.equal(
        await page
          .locator('.homework-crumb')
          .getByRole('button', { name: '子目录', exact: true })
          .count(),
        1,
      );
    },
  );
  await check(
    'Settings refresh protects a cancelled draft, then reads real saved settings in the same tab',
    async () => {
      await page.locator('[data-toolbar-action=settings]').click();
      await page.getByRole('tab', { name: 'AI 助手', exact: true }).click();
      await idle();
      await page.evaluate(() =>
        window.teachshelf.saveSettings({
          baseURL: 'http://127.0.0.1:12345/v1',
          model: 'saved-refresh-model',
        }),
      );
      const model = page.getByLabel('模型名称', { exact: true });
      await model.fill('保留的未保存草稿');
      await button().click();
      const confirm = page.getByRole('dialog', { name: '丢弃未保存的设置？', exact: true });
      await confirm.getByRole('button', { name: '取消', exact: true }).click();
      await idle();
      assert.equal(await model.inputValue(), '保留的未保存草稿');
      await button().click();
      await confirm.getByRole('button', { name: '丢弃修改', exact: true }).click();
      await idle();
      assert.equal(await model.inputValue(), 'saved-refresh-model');
      assert.equal(
        await page.getByRole('tab', { name: 'AI 助手', exact: true }).getAttribute('aria-selected'),
        'true',
      );
      await page.locator('.statusbar').getByText('当前页面已刷新', { exact: true }).waitFor();
    },
  );
  await check(
    'Chat refresh reloads persisted history through IPC without losing the composer',
    async () => {
      await page.locator('.sidebar').getByRole('button', { name: 'AI 助手', exact: true }).click();
      const composer = page.getByLabel('给 AI 助手的消息', { exact: true });
      await composer.fill('刷新后继续输入的草稿');
      await app.evaluate(({ ipcMain }) => {
        const key = 'teachshelf:chatHistory',
          original = ipcMain._invokeHandlers.get(key);
        globalThis.refreshHistoryCalls = 0;
        ipcMain.removeHandler(key);
        ipcMain.handle(key, (...args) => {
          globalThis.refreshHistoryCalls++;
          return original(...args);
        });
      });
      await refresh();
      assert.equal(await app.evaluate(() => globalThis.refreshHistoryCalls), 1);
      assert.equal(await composer.inputValue(), '刷新后继续输入的草稿');
      await page.screenshot({ path: path.join(evidence, 'page-refresh-chat.png') });
    },
  );
  assert.deepEqual(errors, []);
  assert.equal(await page.locator('vite-error-overlay').count(), 0);
  await fs.writeFile(
    path.join(evidence, 'page-refresh-report.json'),
    JSON.stringify({ steps, errors, packaged: !!process.env.TEACHSHELF_EXECUTABLE }, null, 2),
  );
} catch (error) {
  await page?.screenshot({ path: path.join(evidence, 'page-refresh-failure.png') }).catch(() => {});
  throw error;
} finally {
  if (app) {
    await app
      .evaluate(({ app, dialog }) => {
        dialog.showMessageBoxSync = () => 1;
        app.quit();
      })
      .catch(() => {});
    await app.close().catch(() => {});
  }
  await fs.rm(root, { recursive: true, force: true });
}
