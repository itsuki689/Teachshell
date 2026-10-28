/** Browser plugin not available. Real keyboard events against isolated Electron data. */
import { _electron } from 'playwright';
import electron from 'electron';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'teachshell-keys-')));
const evidence = process.env.TEACHSHELF_SCREENSHOT_DIR ?? os.tmpdir();
await fs.mkdir(evidence, { recursive: true });
const steps = [],
  failures = [],
  errors = [];
let app, page, material;
const toolbar = (action) => page.locator(`[data-toolbar-action=${action}]`);
const row = () => page.locator(`tr[data-browser-id="${material.id}"]`);
const snapshot = () => page.evaluate(() => window.teachshelf.snapshot());
const idle = () => page.waitForFunction(() => !document.querySelector('.statusbar .spinning'));
async function selected() {
  await page.locator('.sidebar').getByRole('button', { name: '全部资料', exact: true }).click();
  await page.getByRole('button', { name: '列表视图', exact: true }).click();
  await row().click();
  await page.waitForFunction(
    (id) =>
      document.querySelector(`tr[data-browser-id="${id}"]`)?.getAttribute('aria-selected') ===
      'true',
    material.id,
  );
}
async function check(name, action) {
  try {
    await selected();
    await action();
    steps.push(name);
    console.log('PASS', name);
  } catch (error) {
    failures.push({ name, error: String(error) });
    console.error('FAIL', name, String(error));
  } finally {
    await idle();
    if (await page.getByRole('dialog').count()) await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
  }
}
try {
  app = await _electron.launch({
    executablePath: process.env.TEACHSHELF_EXECUTABLE || electron,
    args: process.env.TEACHSHELF_EXECUTABLE ? [] : [desktop],
    cwd: desktop,
    env: { ...process.env, TEACHSHELF_TEST_ROOT: root },
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(5000);
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.locator('.app-body').waitFor();
  await idle();
  assert.match(page.url(), /^file:.*index\.html$/);
  assert.equal(await page.title(), 'Teachshell · 课屿');
  const sources = ['键盘资料甲.txt', '键盘资料乙.txt'].map((name) => path.join(root, name));
  await Promise.all(sources.map((source) => fs.writeFile(source, 'keyboard routing fixture')));
  await app.evaluate(({ dialog, shell }, sources) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: sources });
    globalThis.keyboardOpened = [];
    shell.openPath = async (file) => {
      globalThis.keyboardOpened.push(file);
      return '';
    };
  }, sources);
  await page.evaluate(() => window.teachshelf.importFiles({ category: '课件', copy: true }));
  material = (await snapshot()).state.materials.find((m) => m.title === '键盘资料甲');
  assert.ok(material);
  await check('Selected materials do not steal Space from the settings button', async () => {
    await toolbar('settings').focus();
    await page.keyboard.press('Space');
    await page.getByRole('heading', { name: '设置', exact: true }).waitFor();
    assert.equal(await page.getByRole('dialog').count(), 0);
    await page
      .locator('.titlebar')
      .screenshot({ path: path.join(evidence, 'keyboard-settings.png') });
  });
  await check(
    'Enter on a row favorite button only toggles favorite and never opens the file',
    async () => {
      const before = (await snapshot()).state.materials.find((m) => m.id === material.id);
      const count = await app.evaluate(() => globalThis.keyboardOpened.length);
      await row().getByRole('button').focus();
      await page.keyboard.press('Enter');
      await idle();
      assert.equal(
        (await snapshot()).state.materials.find((m) => m.id === material.id).isFavorite,
        !before.isFavorite,
      );
      assert.equal(await app.evaluate(() => globalThis.keyboardOpened.length), count);
    },
  );
  await check(
    'Arrow keys and Delete on unrelated controls do not change file selection or remove files',
    async () => {
      const favorite = row().getByRole('button');
      await favorite.focus();
      await page.keyboard.press('ArrowDown');
      assert.equal(await favorite.evaluate((el) => el === document.activeElement), true);
      assert.equal(await row().getAttribute('aria-selected'), 'true');
      await toolbar('settings').focus();
      await page.keyboard.press('Delete');
      assert.equal(await page.getByRole('dialog').count(), 0);
    },
  );
  await check(
    'Space activates a create-menu item without opening the selected material preview',
    async () => {
      await toolbar('create').click();
      const menu = page.getByRole('menu', { name: '快捷新建菜单', exact: true });
      await menu.getByRole('menuitem', { name: '新建课程…', exact: true }).focus();
      await page.keyboard.press('Space');
      await page.getByRole('dialog', { name: '新建课程', exact: true }).waitFor();
      assert.equal(await page.getByRole('dialog').count(), 1);
    },
  );
  await check(
    'Material row Space preview, Enter open and selection shortcuts remain functional',
    async () => {
      await row().focus();
      await page.keyboard.press('Space');
      await page.getByRole('dialog', { name: material.originalName, exact: true }).waitFor();
      await page.keyboard.press('Escape');
      const count = await app.evaluate(() => globalThis.keyboardOpened.length);
      await row().focus();
      await page.keyboard.press('Enter');
      await idle();
      assert.equal(await app.evaluate(() => globalThis.keyboardOpened.length), count + 1);
      await row().focus();
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
      await page.getByText('已选择 2 份', { exact: true }).waitFor();
      await page.keyboard.press('Delete');
      await page.getByRole('dialog', { name: '移除 2 份资料记录？', exact: true }).waitFor();
      await page.keyboard.press('Escape');
      assert.equal((await snapshot()).state.materials.length, 2);
    },
  );
  await check('Grid keyboard navigation and selected-cover preview remain functional', async () => {
    await page.getByRole('button', { name: '封面视图', exact: true }).click();
    const cards = page.locator('.material-cover');
    await cards.first().focus();
    await page.keyboard.press('End');
    assert.equal(await cards.last().evaluate((el) => el === document.activeElement), true);
    assert.equal(await cards.last().getAttribute('aria-selected'), 'true');
    await page.keyboard.press('Home');
    assert.equal(await cards.first().evaluate((el) => el === document.activeElement), true);
    await page.keyboard.press('Space');
    await page.getByRole('dialog').waitFor();
    await page
      .frameLocator('.preview-stage iframe')
      .getByText('keyboard routing fixture')
      .waitFor();
    await page.screenshot({ path: path.join(evidence, 'keyboard-grid-preview.png') });
  });
  await check(
    'An already handled Space event is not reused as a file preview shortcut',
    async () => {
      await row().evaluate((el) =>
        el.addEventListener('keydown', (event) => event.preventDefault(), { once: true }),
      );
      await row().focus();
      await page.keyboard.press('Space');
      await idle();
      assert.equal(await page.getByRole('dialog').count(), 0);
    },
  );
  assert.equal(
    await page.locator('vite-error-overlay, #webpack-dev-server-client-overlay').count(),
    0,
  );
  assert.deepEqual(errors, []);
  await fs.writeFile(
    path.join(evidence, 'keyboard-routing-report.json'),
    JSON.stringify(
      {
        platform: process.platform,
        packaged: !!process.env.TEACHSHELF_EXECUTABLE,
        steps,
        failures,
        errors,
      },
      null,
      2,
    ),
  );
  assert.deepEqual(failures, []);
} finally {
  await app?.close().catch(() => {});
  await fs.rm(root, { recursive: true, force: true });
}
