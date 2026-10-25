/** Browser plugin not available: exercise the real Electron toolbar with isolated on-disk data. */
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
if (executable && !path.isAbsolute(executable))
  throw new Error('TEACHSHELF_EXECUTABLE must be absolute');
const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'teachshell-toolbar-')));
const evidence = process.env.TEACHSHELF_SCREENSHOT_DIR ?? os.tmpdir();
await fs.mkdir(evidence, { recursive: true });
const initial = await Repository.open(path.join(root, 'library'), { create: true });
await initial.createCourse({ name: '顶栏验收课程' });
await initial.connectTeachingCourse({
  courseID: initial.state.courses[0].id,
  remoteCourseID: '411',
  remoteTitle: '顶栏验收课程',
  accountID: '123',
});
await initial.close();
let app, page;
const steps = [],
  errors = [],
  warnings = [];
const defaults = ['update', 'settings', 'import', 'create'];
const snapshot = () => page.evaluate(() => window.teachshelf.snapshot());
const toolbar = () => page.locator('.workspace-shortcuts');
const settings = () => page.locator('.toolbar-settings');
const button = (action) => toolbar().locator(`[data-toolbar-action="${action}"]`);
async function launch() {
  app = await _electron.launch({
    executablePath: executable ?? electronPath,
    args: executable ? [] : [desktop],
    cwd: desktop,
    env: { ...process.env, TEACHSHELF_TEST_ROOT: root },
    timeout: 30000,
  });
  page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
    if (message.type() === 'warning') warnings.push(message.text());
  });
  await page.waitForSelector('.app-body');
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setBounds({ width: 1300, height: 900 }),
  );
}
async function check(name, fn) {
  const start = Date.now();
  await fn();
  steps.push({ name, status: 'passed', durationMs: Date.now() - start });
  console.log('PASS', name);
}
async function waitActions(expected) {
  await page.waitForFunction(
    (expected) =>
      JSON.stringify(
        [...document.querySelectorAll('[data-toolbar-action]')].map((el) =>
          el.getAttribute('data-toolbar-action'),
        ),
      ) === JSON.stringify(expected),
    expected,
  );
  assert.deepEqual((await snapshot()).state.toolbarSettings.actions, expected);
}
async function openSettings() {
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+,' : 'Control+,');
  await page.getByRole('tab', { name: '顶栏', exact: true }).click();
  await settings().getByRole('heading', { name: '自定义顶栏' }).waitFor();
}
async function closeDialog(title) {
  const dialog = page.getByRole('dialog', { name: title, exact: true });
  await dialog
    .locator(':scope > header')
    .getByRole('button', { name: '关闭', exact: true })
    .click();
  await dialog.waitFor({ state: 'hidden' });
}
async function replaceActions(actions) {
  await openSettings();
  let current = (await snapshot()).state.toolbarSettings.actions;
  while (current.length) {
    await settings().locator('.toolbar-selected li').first().getByRole('button').last().click();
    current = current.slice(1);
    await waitActions(current);
  }
  const titles = {
    update: '全局更新',
    settings: '设置',
    import: '导入资料',
    create: '新建',
    schedule: '计划',
    allMaterials: '全部资料',
    favorites: '收藏',
    recent: '最近打开',
    homework: '作业文件夹',
    pendingTasks: '待完成计划',
  };
  for (const action of actions) {
    await settings()
      .getByRole('button', { name: '添加' + titles[action], exact: true })
      .click();
    current = [...current, action];
    await waitActions(current);
  }
}
try {
  await launch();
  await check(
    'Shipped page identity, nonblank layout, isolated renderer and original four toolbar actions',
    async () => {
      assert.match(await page.title(), /Teachshell|课屿/);
      assert.match(page.url(), /^file:.*\/dist\/index.html$/);
      await page.getByRole('heading', { name: '全部资料', exact: true }).waitFor();
      assert.equal(
        await page.locator('vite-error-overlay, #webpack-dev-server-client-overlay').count(),
        0,
      );
      assert.deepEqual(await page.evaluate(() => [typeof window.require, typeof window.process]), [
        'undefined',
        'undefined',
      ]);
      await waitActions(defaults);
      assert.equal(await page.locator('.titlebar [data-symbol="refresh"]').count(), 1);
      assert.equal(await page.getByRole('button', { name: '同步文件', exact: true }).count(), 0);
      assert.equal(await page.locator('.titlebar .lucide-refresh-cw').count(), 0);
      assert.equal(await page.locator('.sidebar-settings').count(), 0);
      assert.equal(await page.locator('.sidebar [data-symbol="gear"]').count(), 0);
      await page.screenshot({ path: path.join(evidence, 'teachshell-toolbar-default.png') });
    },
  );
  await check(
    'Native sync menu remains usable and modal protection blocks background sync',
    async () => {
      await app.evaluate(({ ipcMain }) => {
        const key = 'teachshelf:sync',
          original = ipcMain._invokeHandlers.get(key);
        globalThis.toolbarSyncCalls = 0;
        ipcMain.removeHandler(key);
        ipcMain.handle(key, async (...args) => {
          globalThis.toolbarSyncCalls++;
          return original(...args);
        });
      });
      const sync = () =>
        app.evaluate(({ Menu }) => {
          const item = Menu.getApplicationMenu().getMenuItemById('sync-files');
          if (item?.accelerator !== 'CmdOrCtrl+R') throw Error('Missing native sync accelerator');
          item.click();
        });
      await sync();
      await page.locator('.statusbar').getByText('资料库已同步', { exact: true }).waitFor();
      assert.equal(await app.evaluate(() => globalThis.toolbarSyncCalls), 1);
      await button('create').click();
      await page.getByRole('menuitem', { name: '新建课程…', exact: true }).click();
      await page.getByRole('dialog', { name: '新建课程', exact: true }).waitFor();
      await sync();
      await page.waitForTimeout(150);
      assert.equal(await app.evaluate(() => globalThis.toolbarSyncCalls), 1);
      await closeDialog('新建课程');
      await sync();
      await page.waitForFunction(() => document.querySelector('.statusbar .status-dot'));
      assert.equal(await app.evaluate(() => globalThis.toolbarSyncCalls), 2);
    },
  );
  await check(
    'Settings adds two actions, enforces maximum six, then reorders and removes real persisted shortcuts',
    async () => {
      await button('settings').click();
      await page.getByRole('tab', { name: '顶栏', exact: true }).click();
      await settings().getByRole('heading', { name: '自定义顶栏' }).waitFor();
      await settings().getByRole('button', { name: '添加计划', exact: true }).click();
      await waitActions([...defaults, 'schedule']);
      await settings().getByRole('button', { name: '添加收藏', exact: true }).click();
      await waitActions([...defaults, 'schedule', 'favorites']);
      assert.equal(await settings().locator('.toolbar-available button:not(:disabled)').count(), 0);
      await settings().getByRole('button', { name: '上移收藏', exact: true }).click();
      await waitActions([...defaults, 'favorites', 'schedule']);
      await settings().getByRole('button', { name: '移除全局更新', exact: true }).click();
      await waitActions(['settings', 'import', 'create', 'favorites', 'schedule']);
      await page.screenshot({ path: path.join(evidence, 'teachshell-toolbar-settings.png') });
    },
  );
  await check(
    'Custom toolbar order survives app restart and stale IPC revision cannot overwrite it',
    async () => {
      const before = await snapshot();
      await app.close();
      await launch();
      await waitActions(['settings', 'import', 'create', 'favorites', 'schedule']);
      await openSettings();
      await settings().getByRole('button', { name: '移除收藏', exact: true }).click();
      await waitActions(['settings', 'import', 'create', 'schedule']);
      const rejected = await page.evaluate(
        async (guard) => {
          try {
            await window.teachshelf.saveToolbarSettings([], guard);
            return '';
          } catch (error) {
            return String(error);
          }
        },
        { root: before.root, revision: before.revision },
      );
      assert.match(rejected, /资料库.*变化/);
      await waitActions(['settings', 'import', 'create', 'schedule']);
    },
  );
  await check(
    'Removing every shortcut hides the capsule; keyboard settings and restore defaults remain usable',
    async () => {
      await replaceActions([]);
      assert.equal(await toolbar().count(), 0);
      await page.screenshot({ path: path.join(evidence, 'teachshell-toolbar-empty.png') });
      await app.close();
      await launch();
      assert.equal(await toolbar().count(), 0);
      await openSettings();
      await settings().getByRole('button', { name: '恢复默认顶栏', exact: true }).click();
      await waitActions(defaults);
    },
  );
  await check(
    'Original update/import/create shortcuts open their real approval or editor dialogs',
    async () => {
      await button('update').click();
      await page.getByRole('dialog', { name: '教学网站批量更新审核', exact: true }).waitFor();
      await closeDialog('教学网站批量更新审核');
      await closeDialog('教学网站');
      await button('import').click();
      await page.getByRole('dialog', { name: '导入资料', exact: true }).waitFor();
      await closeDialog('导入资料');
      for (const [name, title] of [
        ['新建课程…', '新建课程'],
        ['新建计划…', '新建计划'],
        ['连接教学网站…', '教学网站'],
      ]) {
        await button('create').click();
        await page
          .getByRole('menu', { name: '快捷新建菜单' })
          .getByRole('menuitem', { name, exact: true })
          .click();
        await page.getByRole('dialog', { name: title, exact: true }).waitFor();
        await closeDialog(title);
        assert.equal(await page.getByRole('menu', { name: '快捷新建菜单' }).count(), 0);
      }
    },
  );
  await check('Six navigation shortcuts each show the corresponding real view', async () => {
    const actions = ['schedule', 'allMaterials', 'favorites', 'recent', 'homework', 'pendingTasks'];
    await replaceActions(actions);
    for (const [action, heading] of [
      ['schedule', '计划'],
      ['allMaterials', '全部资料'],
      ['favorites', '我的收藏'],
      ['recent', '最近打开'],
      ['homework', '作业文件夹'],
      ['pendingTasks', '待完成计划'],
    ]) {
      await button(action).click();
      await page.getByRole('heading', { name: heading, exact: true, level: 1 }).waitFor();
    }
  });
  await check(
    'Create menu dismisses on Escape and outside click; settings toggles back to previous route',
    async () => {
      await openSettings();
      await settings().getByRole('button', { name: '恢复默认顶栏', exact: true }).click();
      await waitActions(defaults);
      await button('settings').click();
      await page.getByRole('heading', { name: '待完成计划', exact: true, level: 1 }).waitFor();
      await button('create').click();
      await page.getByRole('menu', { name: '快捷新建菜单' }).waitFor();
      await page.keyboard.press('Escape');
      assert.equal(await page.getByRole('menu', { name: '快捷新建菜单' }).count(), 0);
      await button('create').click();
      await page.getByRole('heading', { name: '待完成计划', exact: true, level: 1 }).click();
      assert.equal(await page.getByRole('menu', { name: '快捷新建菜单' }).count(), 0);
    },
  );
  await check('No framework overlay or renderer runtime errors', async () => {
    assert.equal(
      await page.locator('vite-error-overlay, #webpack-dev-server-client-overlay').count(),
      0,
    );
    assert.deepEqual(errors, []);
  });
  await fs.writeFile(
    path.join(evidence, 'teachshell-toolbar-e2e.json'),
    JSON.stringify(
      {
        platform: process.platform,
        viewport: await page.evaluate(() => ({ width: innerWidth, height: innerHeight })),
        browser: 'Browser plugin not available; Playwright Electron',
        steps,
        errors,
        warnings,
      },
      null,
      2,
    ),
  );
  console.log(`PASS ${steps.length} toolbar UI checks; evidence: ${evidence}`);
} catch (error) {
  if (page && !page.isClosed())
    await page
      .screenshot({ path: path.join(evidence, 'teachshell-toolbar-failure.png') })
      .catch(() => {});
  await fs.writeFile(
    path.join(evidence, 'teachshell-toolbar-e2e.json'),
    JSON.stringify({ steps, errors, warnings, error: String(error) }, null, 2),
  );
  throw error;
} finally {
  await app?.close().catch(() => {});
  await fs.rm(root, { recursive: true, force: true });
}
