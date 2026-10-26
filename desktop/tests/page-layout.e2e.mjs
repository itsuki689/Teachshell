/** Browser plugin not available. Layout QA uses real Electron and disposable files only. */
import { _electron } from 'playwright';
import electron from 'electron';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'teachshell-layout-'));
const evidence = process.env.TEACHSHELF_SCREENSHOT_DIR || path.join(root, 'screenshots');
await fs.mkdir(evidence, { recursive: true });
const errors = [],
  checks = [];
let app, page;
const button = (name) => page.getByRole('button', { name, exact: true });
const nav = (name) => page.locator('.sidebar').getByRole('button', { name, exact: true }).click();
async function check(name, fn) {
  await fn();
  checks.push(name);
  console.log('PASS', name);
}
async function capture(name) {
  assert.equal(await page.locator('vite-error-overlay').count(), 0);
  assert.ok(await page.locator('.workspace:visible').count());
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: path.join(evidence, 'layout-' + name + '.png') });
}
async function settings(tab) {
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+,' : 'Control+,');
  await page.getByRole('tab', { name: tab, exact: true }).click();
}
try {
  app = await _electron.launch({
    executablePath: process.env.TEACHSHELF_EXECUTABLE || electron,
    args: process.env.TEACHSHELF_EXECUTABLE ? [] : [desktop],
    env: { ...process.env, TEACHSHELF_TEST_ROOT: root },
    cwd: desktop,
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(10000);
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.waitForSelector('.app-body');
  assert.match(page.url(), /^file:/);
  assert.match(await page.title(), /Teachshell/);
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setBounds({ width: 1260, height: 800 }),
  );
  const source = path.join(root, '课堂笔记.txt');
  await fs.writeFile(source, '页面布局验证资料，保留原文件。');
  const course = await page.evaluate(
    async () =>
      (
        await window.teachshelf.createCourse({
          name: '软件工程',
          teacher: '陈老师',
          semester: '2026 秋季',
        })
      ).state.courses[0],
  );
  await app.evaluate(({ dialog }, source) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [source] });
  }, source);
  await page.evaluate(async (id) => {
    await window.teachshelf.importFiles({ courseID: id, copy: true });
    await window.teachshelf.savePlan({
      title: '准备课堂报告',
      content: '整理课件与阅读记录',
      courseID: id,
      startsAt: (Date.now() - Date.UTC(2001, 0, 1)) / 1000,
    });
  }, course.id);
  await check(
    'Library inspector overlays the unchanged canvas; grid and collection pages render',
    async () => {
      await nav('全部资料');
      const canvas = await page.locator('.material-canvas').boundingBox();
      await page.locator('.materials-table tbody tr[data-browser-id]').first().click();
      await page.locator('.inspector').waitFor();
      const after = await page.locator('.material-canvas').boundingBox(),
        inspector = await page.locator('.inspector').boundingBox();
      assert.equal(after.width, canvas.width);
      assert.ok(Math.abs(inspector.width - 320) < 2);
      await capture('library-inspector');
      await button('封面视图').click();
      await capture('library-grid');
      await page
        .locator('.course-list')
        .getByRole('button')
        .filter({ has: page.getByText('软件工程', { exact: true }) })
        .click();
      await capture('course');
      await page.locator('.sidebar').getByRole('button', { name: '新建课程', exact: true }).click();
      const courseEditor = page.getByRole('dialog', { name: '新建课程', exact: true });
      assert.equal((await courseEditor.boundingBox()).width, 460);
      await capture('course-editor');
      await courseEditor.getByRole('button', { name: '取消', exact: true }).click();
      for (const name of ['我的收藏', '最近打开', '未分类']) {
        await nav(name);
        await capture(name);
      }
    },
  );
  await check(
    'All seven settings tabs expose one category and retain real model edits across tabs',
    async () => {
      await settings('外观');
      for (const tab of ['外观', '顶栏', '资料库', '备份', 'AI 助手', 'MCP', '关于']) {
        await page.getByRole('tab', { name: tab, exact: true }).click();
        assert.equal(await page.getByRole('tabpanel').count(), 1);
        assert.equal(await page.getByRole('tab', { selected: true }).innerText(), tab);
        await capture('settings-' + tab);
      }
      await page.getByRole('tab', { name: 'AI 助手', exact: true }).click();
      await page.getByLabel('模型名称', { exact: true }).fill('layout-draft');
      await page.getByRole('tab', { name: '外观', exact: true }).click();
      assert.equal(await page.getByLabel('模型名称', { exact: true }).isVisible(), false);
      await page.getByRole('tab', { name: 'AI 助手', exact: true }).click();
      assert.equal(await page.getByLabel('模型名称', { exact: true }).inputValue(), 'layout-draft');
    },
  );
  await check(
    'Teaching website uses a 225px course sidebar and isolated login controls',
    async () => {
      await page.getByRole('tab', { name: '资料库', exact: true }).click();
      await button('打开教学网站工具').click();
      const dialog = page.getByRole('dialog', { name: '教学网站', exact: true });
      const side = await dialog.locator('.website-sidebar').boundingBox(),
        main = await dialog.locator('.website-main').boundingBox();
      assert.equal(side.width, 225);
      assert.ok(main.x >= side.x + side.width - 2);
      await dialog.getByLabel('记住此资料库的教学网站登录', { exact: true }).waitFor();
      await capture('website');
      await dialog.getByRole('button', { name: '关闭', exact: true }).click();
    },
  );
  await check(
    'Homework columns display filesystem metadata and search filters real imported files',
    async () => {
      await nav('作业文件夹');
      await page
        .getByRole('dialog', { name: '丢弃未保存的设置？', exact: true })
        .getByRole('button', { name: '丢弃修改', exact: true })
        .click();
      await page.getByLabel('作业所属课程').selectOption(course.id);
      await button('导入文件').click();
      await page.locator('.homework-entry').filter({ hasText: '课堂笔记.txt' }).waitFor();
      assert.match(await page.locator('.homework-row').innerText(), /TXT/);
      assert.match(await page.locator('.homework-row').innerText(), /\d{4}\/\d{2}\/\d{2}/);
      await page.getByLabel('搜索当前作业文件夹').fill('不存在');
      assert.equal(await page.locator('.homework-row').count(), 0);
      await page.getByLabel('搜索当前作业文件夹').fill('课堂');
      await capture('homework');
      assert.equal(await fs.readFile(source, 'utf8'), '页面布局验证资料，保留原文件。');
    },
  );
  await check(
    'Plan list retains a permanent detail pane; month and agenda controls occupy the right side',
    async () => {
      await nav('计划');
      if (await button('计划列表视图').isVisible()) await button('计划列表视图').click();
      await button('计划列表视图').click();
      const detail = await page.locator('.plan-detail').boundingBox();
      assert.ok(detail.width >= 230 && detail.width <= 290);
      await page.locator('.plan-row').click({ position: { x: 35, y: 12 } });
      await page.locator('.plan-detail').getByRole('heading', { name: '准备课堂报告' }).waitFor();
      const headings = await page
        .locator('.plan-columns > span')
        .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().x));
      const dates = await page
        .locator('.plan-row')
        .first()
        .locator('.plan-date')
        .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().x));
      assert.ok(Math.abs(headings[2] - dates[0]) < 2, JSON.stringify({ headings, dates }));
      assert.ok(Math.abs(headings[3] - dates[1]) < 2, JSON.stringify({ headings, dates }));
      await capture('plans-list');
      await button('新建计划').first().click();
      const planEditor = page.getByRole('dialog', { name: '新建计划', exact: true });
      assert.equal((await planEditor.boundingBox()).width, 650);
      await capture('plan-editor');
      await planEditor.getByRole('button', { name: '取消', exact: true }).click();
      await button('计划月历视图').click();
      const board = await page.locator('.month-board').boundingBox(),
        controls = await page.locator('.schedule-options .schedule-filters').boundingBox();
      assert.ok(controls.x >= board.x + board.width - 2);
      await capture('plans-month');
      await button('计划日程视图').click();
      await capture('plans-agenda');
    },
  );
  await check(
    'Week view has a 48px date bar and a separate right inspector; minimum dark pages stay reachable',
    async () => {
      await button('查看课表').click();
      await app.evaluate(
        ({ dialog }, source) => {
          dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [source] });
        },
        path.join(desktop, '../Resources/Timetable/Sample-undergraduate.json'),
      );
      await button('导入课表 JSON').first().click();
      const editor = page.getByRole('dialog', { name: '学期设置' });
      await editor.waitFor();
      await editor.getByLabel('第一周周一（北京时间）').fill('2026-09-07');
      await editor.getByRole('button', { name: '保存学期设置' }).click();
      await button('课表时间网格').click();
      const bar = await page.locator('.schedule-datebar').boundingBox(),
        options = await page.locator('.schedule-options').boundingBox();
      assert.equal(bar.height, 48);
      assert.ok(options.x >= bar.x + bar.width - 2);
      await capture('week');
      await settings('外观');
      await page.getByRole('button', { name: '深色显示模式', exact: true }).click();
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].setBounds({ width: 1020, height: 680 }),
      );
      await page.waitForFunction(
        () =>
          document.documentElement.dataset.theme === 'dark' &&
          !document.querySelector('.appearance-curtain'),
      );
      await capture('settings-dark-minimum');
      await nav('计划');
      if (await button('计划列表视图').isVisible()) await button('计划列表视图').click();
      await button('计划月历视图').click();
      await capture('month-dark-minimum');
      await button('查看课表').click();
      await capture('week-dark-minimum');
      await nav('作业文件夹');
      await capture('homework-dark-minimum');
      await nav('AI 助手');
      await capture('chat-dark-minimum');
      await button('模型设置').click();
      assert.equal(await page.getByRole('tab', { selected: true }).innerText(), 'AI 助手');
    },
  );
  assert.deepEqual(errors, []);
} finally {
  await fs.writeFile(
    path.join(evidence, 'page-layout-report.json'),
    JSON.stringify(
      {
        checks,
        errors,
        root,
        executable: process.env.TEACHSHELF_EXECUTABLE || 'development Electron',
      },
      null,
      2,
    ),
  );
  if (app) {
    // Only this isolated fixture's drafts are discarded, including failure cleanup.
    await app
      .evaluate(({ dialog }) => {
        dialog.showMessageBoxSync = () => 1;
      })
      .catch(() => {});
    await app.close();
  }
}
