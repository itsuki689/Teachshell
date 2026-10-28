/** Browser plugin not available. Exercise real Electron input with deterministic IO/animation barriers. */
import { _electron } from 'playwright';
import electron from 'electron';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'teachshell-input-')));
const evidence = process.env.TEACHSHELF_SCREENSHOT_DIR ?? os.tmpdir();
await fs.mkdir(evidence, { recursive: true });
const steps = [],
  failures = [],
  errors = [];
let app, page;
const toolbar = (action) => page.locator(`[data-toolbar-action=${action}]`);
const idle = () => page.waitForFunction(() => !document.querySelector('.statusbar .spinning'));
async function hold(method) {
  await app.evaluate(({ ipcMain }, method) => {
    const channel = 'teachshelf:' + method;
    const original = ipcMain._invokeHandlers.get(channel);
    globalThis.inputHeld = false;
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, async (...args) => {
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel, original);
      const result = await original(...args);
      globalThis.inputHeld = true;
      await new Promise((resolve) => {
        globalThis.inputRelease = resolve;
      });
      return result;
    });
  }, method);
}
async function held() {
  for (let i = 0; i < 200; i++) {
    if (await app.evaluate(() => globalThis.inputHeld)) return;
    await page.waitForTimeout(20);
  }
  throw Error('Real IPC did not reach the reply barrier');
}
async function release() {
  await app.evaluate(() => {
    globalThis.inputRelease?.();
    globalThis.inputRelease = undefined;
  });
}
async function check(name, action) {
  try {
    await action();
    steps.push(name);
    console.log('PASS', name);
  } catch (error) {
    failures.push({ name, error: String(error) });
    console.error('FAIL', name, String(error));
  } finally {
    await release();
    await page.evaluate(() => {
      window.inputPauseAnimation = false;
      for (const animation of document.getAnimations())
        if (Number.isFinite(animation.effect.getComputedTiming().endTime)) animation.finish();
    });
    await idle();
    await page.locator('.sidebar').getByRole('button', { name: '全部资料', exact: true }).click();
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
  page.setDefaultTimeout(10000);
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.locator('.app-body').waitFor();
  await idle();
  assert.match(page.url(), /^file:.*index\.html$/);
  assert.equal(await page.title(), 'Teachshell · 课屿');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate(() => {
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (...args) {
      const result = animate.apply(this, args);
      if (window.inputPauseAnimation && this.matches('[data-toolbar-artwork=update]')) {
        result.pause();
        window.inputAnimation = result;
      }
      return result;
    };
  });
  await check(
    'Refresh releases input when IO finishes even if its decorative animation is paused',
    async () => {
      await page.evaluate(() => {
        window.inputPauseAnimation = true;
      });
      await toolbar('update').click();
      await page.locator('.statusbar').getByText('当前页面已刷新', { exact: true }).waitFor();
      assert.equal(await page.evaluate(() => window.inputAnimation.playState), 'paused');
      assert.equal(
        await toolbar('update').isEnabled(),
        true,
        'A finished operation must not wait for animation.finished',
      );
      await toolbar('update').focus();
      await page.keyboard.press('Enter');
      await idle();
      assert.equal(await toolbar('update').getAttribute('aria-busy'), 'false');
    },
  );
  await check(
    'Pending settings reads allow immediate search typing and closing settings',
    async () => {
      await hold('settings');
      await toolbar('settings').click();
      await held();
      await page.getByRole('tab', { name: 'AI 助手', exact: true }).click();
      assert.equal(await page.getByLabel('模型名称', { exact: true }).isDisabled(), true);
      assert.equal(
        await toolbar('settings').isEnabled(),
        true,
        'Read-only loading must not disable navigation',
      );
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k');
      assert.equal(
        await page
          .getByRole('combobox', { name: '搜索课程、资料和计划', exact: true })
          .evaluate((el) => el === document.activeElement),
        true,
      );
      await page.keyboard.type('test');
      assert.equal(
        await page
          .getByRole('combobox', { name: '搜索课程、资料和计划', exact: true })
          .inputValue(),
        'test',
      );
      await page.keyboard.press('Escape');
      await toolbar('settings').click();
      await page.getByRole('heading', { name: '全部资料', exact: true }).waitFor();
      await page.screenshot({ path: path.join(evidence, 'input-response-settings.png') });
      const status = await page.locator('.statusbar').textContent();
      await release();
      await idle();
      assert.equal(
        await page.locator('.statusbar').textContent(),
        status,
        'An unmounted read must not post stale status',
      );
    },
  );
  await check(
    'Pending homework listing does not swallow the settings shortcut or close button',
    async () => {
      await hold('listHomework');
      await page
        .locator('.sidebar')
        .getByRole('button', { name: '作业文件夹', exact: true })
        .click();
      await held();
      assert.equal(await toolbar('settings').isEnabled(), true);
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+,' : 'Control+,');
      await page.getByRole('heading', { name: '设置', exact: true }).waitFor();
      await toolbar('settings').click();
      await page.getByRole('heading', { name: '作业文件夹', exact: true }).waitFor();
      await release();
      await idle();
    },
  );
  await check(
    'Actual refresh IO still prevents duplicate actions and releases after completion',
    async () => {
      await hold('sync');
      await toolbar('update').click();
      await held();
      assert.equal(await toolbar('update').isDisabled(), true);
      assert.equal(await toolbar('settings').isDisabled(), true);
      await release();
      await idle();
      assert.equal(await toolbar('update').isEnabled(), true);
      await page.screenshot({ path: path.join(evidence, 'input-response-refreshed.png') });
    },
  );
  assert.equal(
    await page.locator('vite-error-overlay, #webpack-dev-server-client-overlay').count(),
    0,
  );
  assert.deepEqual(errors, []);
  await fs.writeFile(
    path.join(evidence, 'input-response-report.json'),
    JSON.stringify(
      { steps, failures, errors, packaged: !!process.env.TEACHSHELF_EXECUTABLE },
      null,
      2,
    ),
  );
  assert.deepEqual(failures, []);
} finally {
  if (app) {
    await release().catch(() => {});
    await app.close().catch(() => {});
  }
  await fs.rm(root, { recursive: true, force: true });
}
