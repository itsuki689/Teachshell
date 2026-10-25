/** Browser plugin not available. Real Electron clicks and animation observations; isolated data only. */
import { _electron } from 'playwright';
import electron from 'electron';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Repository } from '../electron/services/storage/repository.ts';
import { dateMs } from '../shared/model.ts';
const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'teachshell-feedback-')));
const evidence = process.env.TEACHSHELF_SCREENSHOT_DIR ?? os.tmpdir();
await fs.mkdir(evidence, { recursive: true });
const initial = await Repository.open(path.join(root, 'library'), { create: true });
await initial.createCourse({ name: '按钮交互验收课程' });
await initial.connectTeachingCourse({
  courseID: initial.state.courses[0].id,
  remoteCourseID: '411',
  remoteTitle: '按钮交互验收课程',
  accountID: '123',
});
await initial.close();
const alternate = await Repository.open(path.join(root, 'alternate'), { create: true });
await alternate.close();
let app, page;
const steps = [],
  errors = [];
const button = (action) => page.locator(`[data-toolbar-action="${action}"]`);
const art = (action) => page.locator(`[data-toolbar-artwork="${action}"]`);
const snapshot = () => page.evaluate(() => window.teachshelf.snapshot());
async function check(name, run) {
  await run();
  steps.push(name);
  console.log('PASS', name);
}
async function closeDialog(title) {
  const dialog = page.getByRole('dialog', { name: title, exact: true });
  await dialog
    .locator(':scope > header')
    .getByRole('button', { name: '关闭', exact: true })
    .click();
  await dialog.waitFor({ state: 'hidden' });
}
async function records(action) {
  return page.evaluate(
    (action) => window.feedbackAnimations.filter((a) => a.action === action),
    action,
  );
}
async function edgeClick(action) {
  const box = await button(action).boundingBox();
  assert.equal(box.width, 36);
  assert.equal(box.height, 36);
  await page.mouse.click(box.x + box.width - 4, box.y + box.height / 2);
}
async function openLibrary(target) {
  await app.evaluate(({ dialog }, target) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] });
  }, target);
  await page.evaluate(() => window.teachshelf.openLibrary());
}
async function settledCreate() {
  await page.waitForFunction(
    () =>
      !document
        .querySelector('[data-toolbar-artwork=create]')
        .getAnimations()
        .some((a) => a.playState === 'running'),
  );
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
  await page.waitForSelector('.app-body');
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setBounds({ width: 1260, height: 800 }),
  );
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate(() => {
    window.feedbackAnimations = [];
    const original = Element.prototype.animate;
    Element.prototype.animate = function (frames, options) {
      const animation = original.call(this, frames, options);
      const action = this.closest('[data-toolbar-artwork]')?.getAttribute('data-toolbar-artwork');
      if (action)
        window.feedbackAnimations.push({
          action,
          frames,
          duration: animation.effect.getTiming().duration,
          part: this.getAttribute('data-icon-part'),
        });
      return animation;
    };
  });
  await check(
    'Application brand artwork and every toolbar hit area render without clipping or drag interception',
    async () => {
      assert.match(page.url(), /^file:.*index\.html$/);
      assert.equal(await page.title(), 'Teachshell · 课屿');
      assert.equal(
        await page.locator('vite-error-overlay, #webpack-dev-server-client-overlay').count(),
        0,
      );
      assert.equal(
        await page
          .locator('.brand-app-icon')
          .evaluate((img) => img.complete && img.naturalWidth > 0),
        true,
      );
      for (const action of ['update', 'settings', 'import', 'create']) {
        const box = await button(action).boundingBox();
        assert.equal(box.width, 36);
        assert.equal(box.height, 36);
        const area = await button(action).evaluate((el) =>
          getComputedStyle(el).getPropertyValue('-webkit-app-region'),
        );
        assert.equal(area, 'no-drag');
      }
      await page.locator('.brand').screenshot({ path: path.join(evidence, 'brand-app-icon.png') });
      await page
        .locator('.titlebar')
        .screenshot({ path: path.join(evidence, 'toolbar-feedback-light.png') });
    },
  );
  await check(
    'Settings responds to edge clicks, rotates 360 degrees and returns to the previous page',
    async () => {
      await edgeClick('settings');
      await page.getByRole('heading', { name: '设置', exact: true }).waitFor();
      assert.equal(await button('settings').getAttribute('aria-pressed'), 'true');
      const events = await records('settings');
      assert.equal(events.length, 1);
      assert.equal(events[0].duration, 420);
      assert.equal(events[0].frames.at(-1).transform, 'rotate(360deg)');
      await edgeClick('settings');
      await page.getByRole('heading', { name: '全部资料', exact: true }).waitFor();
      assert.equal((await records('settings')).length, 2);
    },
  );
  await check(
    'Rejected settings navigation retains the draft and does not play a success animation',
    async () => {
      await edgeClick('settings');
      await page.getByRole('tab', { name: 'AI 助手', exact: true }).click();
      await page.getByLabel('模型名称', { exact: true }).fill('需要保留的草稿');
      const count = (await records('settings')).length;
      await button('settings').click();
      const confirm = page.getByRole('dialog', { name: '丢弃未保存的设置？', exact: true });
      await confirm.getByRole('button', { name: '取消', exact: true }).click();
      assert.equal((await records('settings')).length, count);
      assert.equal(
        await page.getByLabel('模型名称', { exact: true }).inputValue(),
        '需要保留的草稿',
      );
      await button('settings').click();
      await confirm.getByRole('button', { name: '丢弃修改', exact: true }).click();
      await page.getByRole('heading', { name: '全部资料', exact: true }).waitFor();
      assert.equal((await records('settings')).length, count + 1);
    },
  );
  await check(
    'Create rotates into a close mark, supports Escape and creates a persisted course',
    async () => {
      await edgeClick('create');
      await settledCreate();
      assert.equal(await button('create').getAttribute('aria-label'), '关闭新建菜单');
      assert.equal(await button('create').getAttribute('aria-expanded'), 'true');
      const matrix = await art('create').evaluate((el) => {
        const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
        return [m.a, m.b];
      });
      assert.ok(
        Math.abs(matrix[0] - Math.SQRT1_2) < 0.01 && Math.abs(matrix[1] - Math.SQRT1_2) < 0.01,
      );
      await page.screenshot({ path: path.join(evidence, 'toolbar-create-open.png') });
      await page.keyboard.press('Escape');
      await settledCreate();
      assert.equal(await button('create').getAttribute('aria-label'), '快捷新建');
      assert.equal(await button('create').evaluate((el) => el === document.activeElement), true);
      await page.keyboard.press('Enter');
      await page.getByRole('menuitem', { name: '新建课程…', exact: true }).click();
      const editor = page.getByRole('dialog', { name: '新建课程', exact: true });
      await editor.getByLabel('课程名称', { exact: true }).fill('由右上角新建的课程');
      await editor.getByRole('button', { name: '保存', exact: true }).click();
      await editor.waitFor({ state: 'hidden' });
      assert.ok((await snapshot()).state.courses.some((c) => c.name === '由右上角新建的课程'));
    },
  );
  await check(
    'Import arrow animates inside its clip while the real dialog imports and preserves original bytes',
    async () => {
      const source = path.join(root, '右上角导入验证.txt');
      await fs.writeFile(source, '真实文件导入测试内容');
      await app.evaluate(({ dialog }, source) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [source] });
      }, source);
      await edgeClick('import');
      const dialog = page.getByRole('dialog', { name: '导入资料', exact: true });
      await dialog.waitFor();
      const events = await records('import');
      assert.equal(events.length, 1);
      assert.equal(events[0].duration, 400);
      assert.equal(events[0].part, 'import-arrows');
      assert.equal(events[0].frames.at(-1).transform, 'translateY(16px)');
      await dialog.getByRole('button', { name: '选择文件…', exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
      assert.ok(
        (await snapshot()).state.materials.some((m) => m.originalName === '右上角导入验证.txt'),
      );
      assert.equal(await fs.readFile(source, 'utf8'), '真实文件导入测试内容');
    },
  );
  await check(
    'Refresh gives one full-turn response before opening one update sheet despite repeated clicks',
    async () => {
      const count = (await records('update')).length;
      await edgeClick('update');
      assert.equal(await button('update').getAttribute('aria-busy'), 'true');
      assert.equal(await page.getByRole('dialog', { name: '教学网站', exact: true }).count(), 0);
      await button('update').click();
      assert.equal((await records('update')).length, count + 1);
      assert.equal((await records('update')).at(-1).duration, 400);
      await page.getByRole('dialog', { name: '教学网站', exact: true }).waitFor();
      assert.equal(await page.getByRole('dialog', { name: '教学网站', exact: true }).count(), 1);
      await closeDialog('教学网站批量更新审核');
      await closeDialog('教学网站');
    },
  );
  await check(
    'Switching actions cancels a delayed refresh rather than opening a stale sheet',
    async () => {
      await edgeClick('update');
      await edgeClick('settings');
      await page.waitForTimeout(500);
      assert.equal(await page.getByRole('dialog', { name: '教学网站', exact: true }).count(), 0);
      await page.getByRole('heading', { name: '设置', exact: true }).waitFor();
      assert.equal(await button('update').getAttribute('aria-busy'), 'false');
      await button('settings').click();
    },
  );
  await check(
    'Reduced motion keeps real actions and expanded-state feedback without ornamental animations',
    async () => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const count = (await records('update')).length;
      await edgeClick('update');
      await page.getByRole('dialog', { name: '教学网站', exact: true }).waitFor();
      assert.equal((await records('update')).length, count);
      await closeDialog('教学网站批量更新审核');
      await closeDialog('教学网站');
      await edgeClick('create');
      await settledCreate();
      assert.equal(
        await art('create').evaluate((el) => getComputedStyle(el).transitionProperty),
        'none',
      );
      assert.equal(await button('create').getAttribute('aria-expanded'), 'true');
      await page.keyboard.press('Escape');
      await page.emulateMedia({ reducedMotion: 'no-preference' });
    },
  );
  await check(
    'Toolbar plan creation uses the selected calendar day and saves that actual date',
    async () => {
      await page.locator('.sidebar').getByRole('button', { name: '计划', exact: true }).click();
      await page.getByLabel('跳转日期', { exact: true }).fill('2031-04-17');
      await button('create').click();
      await page.getByRole('menuitem', { name: '新建计划…', exact: true }).click();
      const editor = page.getByRole('dialog', { name: '新建计划', exact: true });
      assert.equal(
        await editor.getByLabel('开始时间', { exact: false }).inputValue(),
        '2031-04-17T09:00',
      );
      await editor.getByLabel('计划名称', { exact: true }).fill('沿用所选日期的计划');
      await editor.getByRole('button', { name: '保存', exact: true }).click();
      await editor.waitFor({ state: 'hidden' });
      const task = (await snapshot()).state.tasks.find((t) => t.title === '沿用所选日期的计划');
      assert.ok(task);
      assert.equal(dateMs(task.startsAt), Date.parse('2031-04-17T09:00:00+08:00'));
    },
  );
  await check(
    'A library switch cancels refresh; an unconnected library has an explicit disabled reason',
    async () => {
      await edgeClick('update');
      await openLibrary(path.join(root, 'alternate'));
      await page.waitForTimeout(500);
      assert.equal(await page.getByRole('dialog', { name: '教学网站', exact: true }).count(), 0);
      assert.equal(await button('update').isDisabled(), true);
      assert.match(await button('update').getAttribute('title'), /先连接教学网站/);
      const box = await button('update').boundingBox();
      await page.mouse.click(box.x + 18, box.y + 18);
      assert.equal(await page.locator('[role=dialog]').count(), 0);
    },
  );
  await check(
    'Dark minimum-size toolbar retains icon contrast, unclipped menus and keyboard activation',
    async () => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.locator('.day-night-toggle').click({ button: 'right' });
      await page.getByRole('menuitemradio', { name: '深色', exact: true }).click();
      await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].setBounds({ width: 1020, height: 680 }),
      );
      await page.waitForFunction(
        () => !document.querySelector('[data-toolbar-action=create]').disabled,
      );
      for (const action of ['settings', 'import', 'create']) {
        const box = await button(action).boundingBox();
        assert.ok(box.x >= 0 && box.x + box.width <= 1020);
      }
      await button('create').focus();
      await page.keyboard.press('Space');
      await settledCreate();
      const menu = page.getByRole('menu', { name: '快捷新建菜单', exact: true });
      const box = await menu.boundingBox();
      const viewport = await page.evaluate(() => [innerWidth, innerHeight]);
      assert.ok(
        box.x >= 0 && box.x + box.width <= viewport[0] && box.y + box.height <= viewport[1],
      );
      await page.screenshot({ path: path.join(evidence, 'toolbar-feedback-dark-minimum.png') });
      await page.keyboard.press('Escape');
      assert.equal(
        await page.locator('vite-error-overlay, #webpack-dev-server-client-overlay').count(),
        0,
      );
    },
  );
  assert.deepEqual(errors, []);
  await fs.writeFile(
    path.join(evidence, 'toolbar-feedback-report.json'),
    JSON.stringify({ steps, errors, packaged: !!process.env.TEACHSHELF_EXECUTABLE }, null, 2),
  );
  console.log(JSON.stringify({ passed: steps.length, rendererErrors: errors.length }));
} catch (error) {
  if (page) {
    await page
      .screenshot({ path: path.join(evidence, 'toolbar-feedback-failure.png') })
      .catch(() => {});
    await fs.writeFile(
      path.join(evidence, 'toolbar-feedback-failure.json'),
      JSON.stringify(
        await page
          .evaluate(() => ({
            focus: document.activeElement?.outerHTML,
            toolbar: document.querySelector('.workspace-shortcuts')?.outerHTML,
            status: document.querySelector('.statusbar')?.textContent,
          }))
          .catch(() => ({})),
        null,
        2,
      ),
    );
  }
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
