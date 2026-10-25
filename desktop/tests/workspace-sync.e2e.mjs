/** Browser plugin unavailable: real Electron IPC, menus and temporary on-disk libraries. */
import { _electron } from 'playwright';
import electronPath from 'electron';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Repository } from '../electron/services/storage/repository.ts';
const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const executable = process.env.TEACHSHELF_EXECUTABLE;
const root = await fs.realpath(
  await fs.mkdtemp(path.join(os.tmpdir(), 'teachshell-workspace-ui-')),
);
const evidence = process.env.TEACHSHELF_SCREENSHOT_DIR ?? os.tmpdir();
await fs.mkdir(evidence, { recursive: true });
const second = await Repository.open(path.join(root, 'second'), { create: true });
await second.createCourse({ name: '乙资料库课程' });
await second.close();
let app, page;
const steps = [],
  errors = [];
async function check(name, fn) {
  await fn();
  steps.push({ name, status: 'passed' });
  console.log('PASS', name);
}
async function menu(action) {
  await app.evaluate(
    ({ BrowserWindow }, action) =>
      BrowserWindow.getAllWindows()[0].webContents.send('teachshelf:menu', action),
    action,
  );
}
const snap = () => page.evaluate(() => window.teachshelf.snapshot());
try {
  app = await _electron.launch({
    executablePath: executable ?? electronPath,
    args: executable ? [] : [desktop],
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
  const source = path.join(root, '未保存检查.txt');
  await fs.writeFile(source, 'workspace UI fixture');
  await app.evaluate(({ dialog }, source) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [source] });
  }, source);
  await page.evaluate(() => window.teachshelf.importFiles({ category: '课件', copy: true }));
  const item = (await snap()).state.materials[0];
  await check(
    'A delayed real sync reply cannot overwrite a subsequent course change event',
    async () => {
      await app.evaluate(({ ipcMain }) => {
        const key = 'teachshelf:sync',
          original = ipcMain._invokeHandlers.get(key);
        globalThis.__workspaceHeld = false;
        ipcMain.removeHandler(key);
        ipcMain.handle(key, async (...args) => {
          const result = await original(...args);
          globalThis.__workspaceHeld = true;
          await new Promise((resolve) => {
            globalThis.__workspaceRelease = resolve;
          });
          return result;
        });
        globalThis.__workspaceRestore = () => {
          ipcMain.removeHandler(key);
          ipcMain.handle(key, original);
        };
      });
      await page.getByRole('button', { name: '同步文件', exact: true }).click();
      for (let n = 0; !(await app.evaluate(() => globalThis.__workspaceHeld)); n++) {
        if (n > 100) throw Error('Sync did not reach the response gate');
        await page.waitForTimeout(25);
      }
      await page.evaluate(() => window.teachshelf.createCourse({ name: '后续更新课程' }));
      await page.locator('.sidebar').getByText('后续更新课程', { exact: true }).waitFor();
      await app.evaluate(() => {
        globalThis.__workspaceRelease();
        globalThis.__workspaceRestore();
      });
      await page.waitForFunction(() => !document.querySelector('[aria-label="同步文件"]').disabled);
      assert.equal(
        await page.locator('.sidebar').getByText('后续更新课程', { exact: true }).count(),
        1,
      );
    },
  );
  await check(
    'Native new/open menu actions respect the inspector unsaved-change confirmation',
    async () => {
      await app.evaluate(({ dialog }) => {
        globalThis.__workspaceChoosers = 0;
        dialog.showOpenDialog = async () => {
          globalThis.__workspaceChoosers++;
          return { canceled: true, filePaths: [] };
        };
      });
      await page.getByRole('table').getByText(item.title, { exact: true }).click();
      await page
        .locator('.inspector')
        .getByLabel('备注', { exact: true })
        .fill('不能被菜单丢失的草稿');
      for (const action of ['new-course', 'open-library']) {
        await menu(action);
        const confirmation = page.getByRole('dialog', {
          name: '丢弃未保存的资料修改？',
          exact: true,
        });
        await confirmation.waitFor();
        await confirmation.getByRole('button', { name: '取消', exact: true }).click();
        assert.equal(
          await page.locator('.inspector').getByLabel('备注', { exact: true }).inputValue(),
          '不能被菜单丢失的草稿',
        );
        assert.equal(await page.getByRole('dialog').count(), 0);
      }
      assert.equal(await app.evaluate(() => globalThis.__workspaceChoosers), 0);
      await page.locator('.inspector').getByRole('button', { name: '还原', exact: true }).click();
    },
  );
  await check(
    'Native menu and shortcuts cannot stack editors or switch libraries under a modal',
    async () => {
      await menu('new-course');
      const editor = page.getByRole('dialog', { name: '新建课程', exact: true });
      await editor.waitFor();
      await editor.getByLabel('课程名称', { exact: true }).fill('仍在编辑中的课程');
      await menu('import');
      await menu('open-library');
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+n' : 'Control+Shift+n');
      assert.equal(await page.getByRole('dialog').count(), 1);
      assert.equal(
        await editor.getByLabel('课程名称', { exact: true }).inputValue(),
        '仍在编辑中的课程',
      );
      assert.equal(await app.evaluate(() => globalThis.__workspaceChoosers), 0);
    },
  );
  await check(
    'A workspace change remounts views and dismisses editors from the previous library',
    async () => {
      const before = await snap();
      await app.evaluate(({ dialog }) => {
        dialog.showSaveDialog = () =>
          new Promise((resolve) => {
            globalThis.__workspaceSaveRelease = resolve;
          });
      });
      await page.evaluate(() => {
        window.__workspaceBackup = window.teachshelf.backupLibrary().then(
          () => 'unexpected success',
          (error) => String(error),
        );
      });
      for (let n = 0; !(await app.evaluate(() => !!globalThis.__workspaceSaveRelease)); n++) {
        if (n > 100) throw Error('Backup did not reach its directory dialog');
        await page.waitForTimeout(25);
      }
      await app.evaluate(
        ({ dialog }, next) => {
          dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [next] });
        },
        path.join(root, 'second'),
      );
      const after = await page.evaluate(() => window.teachshelf.openLibrary());
      const backupTarget = path.join(root, 'must-not-backup-new-library');
      await app.evaluate(
        (_electron, filePath) => globalThis.__workspaceSaveRelease({ canceled: false, filePath }),
        backupTarget,
      );
      assert.match(await page.evaluate(() => window.__workspaceBackup), /资料库已切换/);
      await assert.rejects(fs.access(backupTarget), { code: 'ENOENT' });
      assert.notEqual(after.workspaceID, before.workspaceID);
      await page.getByRole('heading', { name: '全部资料', exact: true }).waitFor();
      await page.locator('.sidebar').getByText('乙资料库课程', { exact: true }).waitFor();
      assert.equal(await page.getByRole('dialog').count(), 0);
      assert.equal(await page.locator('.inspector').count(), 0);
      assert.equal(await page.getByText('后续更新课程', { exact: true }).count(), 0);
      assert.equal(after.state.courses.length, 1);
      const original = JSON.parse(
        await fs.readFile(path.join(before.root, 'library.json'), 'utf8'),
      );
      assert.equal(
        original.courses.some((c) => c.name === '仍在编辑中的课程'),
        false,
      );
      await page.screenshot({ path: path.join(evidence, 'teachshell-workspace-switch.png') });
    },
  );
  await check(
    'Changing libraries from a course homework view leaves no old-course request errors',
    async () => {
      const secondState = await snap();
      await page
        .locator('.sidebar')
        .getByRole('button', { name: '作业文件夹', exact: true })
        .click();
      await page
        .getByLabel('作业所属课程', { exact: true })
        .selectOption(secondState.state.courses[0].id);
      await page.waitForFunction(() => !document.querySelector('[aria-label="同步文件"]').disabled);
      await app.evaluate(
        ({ dialog }, previous) => {
          dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [previous] });
        },
        path.join(root, 'library'),
      );
      await page.evaluate(() => window.teachshelf.openLibrary());
      await page.getByRole('heading', { name: '全部资料', exact: true }).waitFor();
      await page.waitForFunction(() => !document.querySelector('[aria-label="同步文件"]').disabled);
      assert.equal(await page.locator('.error-toast').count(), 0);
    },
  );
  await check(
    'No stale editor, blank page, framework overlay or renderer exception remains',
    async () => {
      assert.match(await page.title(), /Teachshell|课屿/);
      assert.match(page.url(), /^file:.*\/dist\/index.html$/);
      assert.equal(await page.locator('vite-error-overlay').count(), 0);
      assert.deepEqual(errors, []);
    },
  );
  console.log(`PASS ${steps.length} workspace UI checks`);
} catch (error) {
  if (page && !page.isClosed())
    await page
      .screenshot({ path: path.join(evidence, 'teachshell-workspace-failure.png') })
      .catch(() => {});
  throw error;
} finally {
  await fs.writeFile(
    path.join(evidence, 'teachshell-workspace-e2e.json'),
    JSON.stringify({ steps, errors }, null, 2),
  );
  if (app) await app.evaluate(() => globalThis.__workspaceRelease?.()).catch(() => {});
  if (app)
    await app
      .evaluate(({ dialog }) => {
        globalThis.__workspaceSaveRelease?.({ canceled: true });
        dialog.showMessageBoxSync = () => 1; // Discard only synthetic unsaved test fields during cleanup.
      })
      .catch(() => {});
  await app?.close().catch(() => {});
  await fs.rm(root, { recursive: true, force: true });
}
