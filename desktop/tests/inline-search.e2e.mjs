/** Browser plugin not available. Real Electron UI, isolated temporary library and actual persistence. */
import { _electron } from 'playwright';
import electron from 'electron';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Repository } from '../electron/services/storage/repository.ts';
const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'teachshell-inline-')));
const evidence = process.env.TEACHSHELF_SCREENSHOT_DIR ?? os.tmpdir();
await fs.mkdir(evidence, { recursive: true });
const repo = await Repository.open(path.join(root, 'library'), { create: true });
await repo.createCourse({ name: '栏内搜索课程', teacher: '测试教师', semester: '2026 秋季' });
await repo.createCourse({ name: '第二课程' });
const course = repo.state.courses.find((c) => c.name === '栏内搜索课程');
const source = path.join(root, '栏内搜索笔记.txt');
await fs.writeFile(source, '搜索真实资料，原文件保持不变');
await repo.importFiles([source], { courseID: course.id, copy: true });
await repo.saveTask({ title: '栏内搜索计划', courseID: course.id, content: '保留的计划正文' });
await repo.close();
const alternate = await Repository.open(path.join(root, 'alternate'), { create: true });
await alternate.close();
let app, page;
const checks = [],
  errors = [],
  geometry = [];
const input = () => page.getByRole('combobox', { name: '搜索课程、资料和计划', exact: true });
const options = () => page.getByRole('listbox', { name: '全局搜索结果', exact: true });
const search = async (text) => {
  await input().click();
  await input().fill(text);
};
const toolbar = (action) => page.locator(`[data-toolbar-action="${action}"]`);
async function check(name, run) {
  await run();
  checks.push(name);
  console.log('PASS', name);
}
async function aligned(label) {
  const boxes = await page.evaluate(() =>
    ['.workspace-search-field', '.day-night-art', '.workspace-shortcuts'].map((selector) => {
      const r = document.querySelector(selector).getBoundingClientRect();
      return {
        selector,
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
        centerY: r.y + r.height / 2,
      };
    }),
  );
  for (const box of boxes)
    assert.ok(Math.abs(box.centerY - boxes[2].centerY) < 0.6, JSON.stringify(boxes));
  assert.ok(boxes[0].x + boxes[0].width <= boxes[1].x);
  assert.ok(boxes[1].x + boxes[1].width <= boxes[2].x);
  geometry.push({ label, boxes });
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
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setBounds({ width: 1260, height: 800 }),
  );
  await check(
    'Loaded brand uses exactly the packaged app icon; titlebar controls share a vertical center',
    async () => {
      assert.match(page.url(), /^file:.*index\.html$/);
      assert.equal(await page.title(), 'Teachshell · 课屿');
      assert.equal(await page.locator('vite-error-overlay').count(), 0);
      const bytes = await page.locator('.brand-app-icon').evaluate(async (img) => {
        await img.decode();
        return Array.from(new Uint8Array(await (await fetch(img.src)).arrayBuffer()));
      });
      const sha = (v) => createHash('sha256').update(v).digest('hex');
      assert.equal(
        sha(Buffer.from(bytes)),
        sha(await fs.readFile(path.join(desktop, 'build-assets/icon.png'))),
      );
      await aligned('desktop-light');
      await page
        .locator('.brand')
        .screenshot({ path: path.join(evidence, 'inline-brand-app-icon.png') });
    },
  );
  await check(
    'Typing directly in the titlebar searches courses, files and plans without a modal',
    async () => {
      await input().click();
      assert.equal(await page.getByRole('dialog').count(), 0);
      await input().fill('栏内搜索');
      await options().waitFor();
      assert.equal(await options().getByRole('option').count(), 3);
      assert.equal(await page.locator('.modal-backdrop').count(), 0);
      assert.equal(await input().getAttribute('aria-expanded'), 'true');
      const box = await options().boundingBox(),
        field = await input().boundingBox();
      assert.ok(box.y > field.y + field.height);
      await page.screenshot({ path: path.join(evidence, 'inline-search-light.png') });
    },
  );
  await check(
    'Course and material selections reveal actual records and retain the original file',
    async () => {
      await search('栏内搜索课程 测试教师');
      await options().getByRole('option', { name: '打开课程 栏内搜索课程', exact: true }).click();
      await page.getByRole('heading', { name: '栏内搜索课程', exact: true }).waitFor();
      assert.equal(await input().inputValue(), '');
      await search('栏内搜索笔记');
      await input().press('Enter');
      await page.locator('.inspector').getByLabel('实际文件名', { exact: false }).waitFor();
      assert.equal(
        await page.locator('.inspector').getByLabel('实际文件名', { exact: false }).inputValue(),
        '栏内搜索笔记.txt',
      );
      assert.equal(await fs.readFile(source, 'utf8'), '搜索真实资料，原文件保持不变');
    },
  );
  await check(
    'Chinese IME Enter does not open a result; ordinary Enter opens the stored plan',
    async () => {
      await search('栏内搜索计划');
      await input().dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true });
      assert.equal(await page.getByRole('dialog').count(), 0);
      assert.equal(await input().inputValue(), '栏内搜索计划');
      await input().press('Enter');
      const dialog = page.getByRole('dialog', { name: '编辑计划', exact: true });
      await dialog.waitFor();
      assert.equal(
        await dialog.getByLabel('计划名称', { exact: true }).inputValue(),
        '栏内搜索计划',
      );
      await dialog.getByRole('button', { name: '取消', exact: true }).click();
    },
  );
  await check(
    'Search respects unsaved edits and cancellation keeps both the draft and query',
    async () => {
      await toolbar('settings').click();
      await page.getByRole('tab', { name: 'AI 助手', exact: true }).click();
      await page.getByLabel('模型名称', { exact: true }).fill('不可丢失的搜索草稿');
      await search('第二课程');
      await input().press('Enter');
      const dialog = page.getByRole('dialog', { name: '丢弃未保存的设置？', exact: true });
      await dialog.getByRole('button', { name: '取消', exact: true }).click();
      assert.equal(
        await page.getByLabel('模型名称', { exact: true }).inputValue(),
        '不可丢失的搜索草稿',
      );
      assert.equal(await input().inputValue(), '第二课程');
      await input().press('Enter');
      await dialog.getByRole('button', { name: '丢弃修改', exact: true }).click();
      await page.getByRole('heading', { name: '第二课程', exact: true }).waitFor();
      assert.equal(await input().inputValue(), '');
    },
  );
  await check(
    'Native search shortcut focuses the same bar; arrows, Escape, clear and outside dismissal work',
    async () => {
      await app.evaluate(({ Menu, BrowserWindow }) => {
        const item = Menu.getApplicationMenu()
          .items.flatMap((i) => i.submenu?.items ?? [])
          .find((i) => i.label === '全局搜索');
        if (!item) throw Error('Missing native search command');
        item.click(item, BrowserWindow.getAllWindows()[0]);
      });
      await page.waitForFunction(
        () => document.activeElement?.getAttribute('aria-label') === '搜索课程、资料和计划',
      );
      await input().fill('栏内搜索');
      const first = await input().getAttribute('aria-activedescendant');
      await input().press('ArrowDown');
      assert.notEqual(await input().getAttribute('aria-activedescendant'), first);
      await input().press('ArrowUp');
      assert.equal(await input().getAttribute('aria-activedescendant'), first);
      await input().press('Escape');
      assert.equal(await input().inputValue(), '');
      assert.equal(await input().getAttribute('aria-expanded'), 'false');
      await search('没有匹配的条目');
      await page
        .getByRole('status')
        .getByText('没有匹配的课程、资料或计划。', { exact: true })
        .waitFor();
      await page.getByRole('button', { name: '清除全局搜索', exact: true }).click();
      assert.equal(await input().inputValue(), '');
      await search('栏内搜索');
      await page.getByRole('heading', { name: '第二课程', exact: true }).click();
      assert.equal(await options().count(), 0);
      assert.equal(await input().inputValue(), '栏内搜索');
      await input().click();
      await input().press('Tab');
      assert.equal(await options().count(), 0);
    },
  );
  await check(
    'Minimum dark titlebar and long results remain aligned, readable and inside the viewport',
    async () => {
      await page.locator('.day-night-toggle').click({ button: 'right' });
      await page.getByRole('menuitemradio', { name: '深色', exact: true }).click();
      await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].setBounds({ width: 1020, height: 680 }),
      );
      await page.evaluate(async () => {
        for (let i = 0; i < 8; i++)
          await window.teachshelf.createCourse({
            name: `很长的课程名称用于搜索结果排版检查与省略处理 ${i}`,
          });
      });
      await aligned('minimum-dark');
      await search('很长的课程');
      assert.equal(await options().getByRole('option').count(), 6);
      const box = await page.locator('.workspace-search-results').boundingBox();
      assert.ok(box.x >= 0 && box.x + box.width <= 1020 && box.y + box.height <= 680);
      assert.ok(
        await page
          .locator('.workspace-search-results')
          .evaluate((el) => el.scrollWidth <= el.clientWidth),
      );
      await page.screenshot({ path: path.join(evidence, 'inline-search-minimum-dark.png') });
      await input().press('Escape');
      await page.locator('.day-night-toggle').click({ button: 'right' });
      const menu = page.getByRole('menu', { name: '外观模式菜单', exact: true });
      const menuBox = await menu.boundingBox(),
        control = await page.locator('.day-night-control').boundingBox();
      assert.ok(menuBox.y >= control.y + control.height);
      await page.keyboard.press('Escape');
    },
  );
  await check(
    'Switching libraries clears the query and stale suggestions without a search dialog',
    async () => {
      await search('栏内搜索');
      await app.evaluate(
        ({ dialog }, target) => {
          dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] });
        },
        path.join(root, 'alternate'),
      );
      await page.evaluate(() => window.teachshelf.openLibrary());
      await page.waitForFunction(
        () => document.querySelector('.workspace-search input')?.value === '',
      );
      assert.equal(await options().count(), 0);
      await search('栏内搜索');
      await page.getByText('没有匹配的课程、资料或计划。', { exact: true }).waitFor();
      assert.equal(await page.getByRole('dialog').count(), 0);
    },
  );
  assert.deepEqual(errors, []);
  await fs.writeFile(
    path.join(evidence, 'inline-search-report.json'),
    JSON.stringify(
      { checks, errors, geometry, packaged: !!process.env.TEACHSHELF_EXECUTABLE },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed: checks.length, rendererErrors: errors.length }));
} catch (error) {
  await page
    ?.screenshot({ path: path.join(evidence, 'inline-search-failure.png') })
    .catch(() => {});
  throw error;
} finally {
  await app
    ?.evaluate(({ app, dialog }) => {
      dialog.showMessageBoxSync = () => 1;
      app.quit();
    })
    .catch(() => {});
  await app?.close().catch(() => {});
  await fs.rm(root, { recursive: true, force: true });
}
