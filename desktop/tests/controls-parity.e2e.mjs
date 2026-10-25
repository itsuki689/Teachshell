/** Real Electron controls, native Swift dimensions, synthetic library only. */
import { _electron } from 'playwright';
import electron from 'electron';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'teachshell-controls-')));
const evidence = process.env.TEACHSHELF_SCREENSHOT_DIR || path.join(root, 'screenshots');
await fs.mkdir(evidence, { recursive: true });
const checks = [],
  errors = [];
let app, page;
const b = (name) => page.getByRole('button', { name, exact: true });
const nav = (name) => page.locator('.sidebar').getByRole('button', { name, exact: true }).click();
const popup = () => page.locator('.choice-popup:popover-open');
async function check(name, run) {
  await run();
  checks.push(name);
  console.log('PASS', name);
}
async function capture(name) {
  assert.match(page.url(), /^file:/);
  assert.match(await page.title(), /Teachshell/);
  assert.equal(await page.locator('vite-error-overlay').count(), 0);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: path.join(evidence, `controls-${name}.png`) });
}
async function select(name, option, within = page) {
  await within.getByRole('combobox', { name, exact: true }).click();
  await popup().getByRole('option', { name: option, exact: true }).click();
  assert.equal(await popup().count(), 0);
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
  const courses = await page.evaluate(async () => {
    for (let i = 0; i < 18; i++)
      await window.teachshelf.createCourse({
        name:
          i === 17
            ? '超长中文课程名称：软件工程与跨平台桌面交互设计、排版及教学资料同步验证'
            : i === 0
              ? 'Alpha 课程'
              : '课程' + String(i + 1).padStart(2, '0'),
        semester: i % 2 ? '2026 秋季' : '2026 春季',
      });
    return (await window.teachshelf.snapshot()).state.courses;
  });
  await check('Sidebar and toolbar symbols match native meanings and optical sizing', async () => {
    assert.equal(
      await page.locator('.brand-app-icon').evaluate((img) => img.complete && img.naturalWidth > 0),
      true,
    );
    const symbols = await page
      .locator('.shortcuts svg')
      .evaluateAll((nodes) => nodes.map((n) => n.dataset.symbol));
    assert.deepEqual(symbols, ['tray-full', 'star', 'clock', 'tray', 'folder', 'checklist']);
    assert.equal(
      await page.locator('[data-toolbar-action=settings] [data-symbol=gear]').count(),
      1,
    );
    await capture('library-light');
  });
  await check(
    'Mouse selection filters real courses and compact controls retain 12px type',
    async () => {
      await select('学期', '2026 秋季');
      assert.equal(await page.locator('.course-row').count(), 9);
      const style = await page.getByLabel('学期', { exact: true }).evaluate((n) => ({
        font: getComputedStyle(n).fontSize,
        appearance: getComputedStyle(n).appearance,
      }));
      assert.equal(style.font, '12px');
      assert.equal(style.appearance, 'none');
      await select('学期', '全部学期');
      assert.equal(await page.locator('.course-row').count(), 18);
    },
  );
  await check(
    'Arrow highlight is separate from selection; Escape, Home, End and Enter work',
    async () => {
      const control = page.getByLabel('课程状态', { exact: true });
      await control.focus();
      await page.keyboard.press('ArrowDown');
      assert.equal(await popup().count(), 1);
      assert.ok(await popup().evaluate((n) => n.scrollHeight <= n.clientHeight));
      await page.keyboard.press('End');
      assert.equal(await control.inputValue(), 'active');
      assert.equal(await popup().locator('.highlighted').textContent(), '全部课程');
      await page.keyboard.press('Escape');
      assert.equal(await control.inputValue(), 'active');
      assert.equal(await popup().count(), 0);
      await page.keyboard.press('Space');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      assert.equal(await control.inputValue(), 'archived');
      assert.equal(await page.locator('.course-row').count(), 0);
      await control.focus();
      await page.keyboard.press('ArrowUp');
      await page.keyboard.press('Home');
      await page.keyboard.press('Enter');
      assert.equal(await control.inputValue(), 'active');
    },
  );
  await check(
    'Sorting popup has native row geometry, checkmark, outside dismissal and Tab focus',
    async () => {
      const control = page.getByLabel('排序', { exact: true });
      await control.click();
      const metrics = await popup().evaluate((n) => ({
        width: n.getBoundingClientRect().width,
        opacity: getComputedStyle(n).backgroundColor,
        radius: getComputedStyle(n).borderRadius,
        row: n.querySelector('[role=option]').getBoundingClientRect().height,
      }));
      assert.ok(metrics.width >= 200 && metrics.width <= 360);
      assert.equal(metrics.row, 30);
      assert.equal(metrics.radius, '8px');
      assert.equal(metrics.opacity, 'rgb(245, 245, 245)');
      assert.equal(await popup().getByRole('option', { selected: true }).textContent(), '最近添加');
      await capture('sort-popup-light');
      await page.getByLabel('搜索资料', { exact: true }).click();
      assert.equal(await popup().count(), 0);
      await control.click();
      await page.keyboard.press('Tab');
      assert.equal(await popup().count(), 0);
      await select('排序', '名称');
      assert.equal(await control.inputValue(), 'name');
    },
  );
  await check(
    'Plan modal choices scroll, truncate long names, stay in viewport and preserve modal on Escape',
    async () => {
      await nav('计划');
      await b('新建计划').click();
      const dialog = page.getByRole('dialog', { name: '新建计划', exact: true });
      await dialog.getByLabel('课程', { exact: true }).click();
      await page.keyboard.press('End');
      const highlighted = popup().locator('.highlighted');
      assert.equal(await highlighted.getAttribute('title'), courses.at(-1).name);
      assert.ok(await popup().evaluate((n) => n.scrollTop > 0));
      const metrics = await highlighted.locator('.choice-label').evaluate((n) => ({
        client: n.clientWidth,
        scroll: n.scrollWidth,
        overflow: getComputedStyle(n).textOverflow,
      }));
      assert.equal(metrics.overflow, 'ellipsis');
      assert.ok(metrics.scroll > metrics.client);
      const box = await popup().boundingBox();
      assert.ok(box.x >= 6 && box.y >= 6 && box.width <= 360 && box.height <= 330);
      await capture('plan-course-popup');
      await page.keyboard.press('Escape');
      assert.equal(await popup().count(), 0);
      assert.ok(await dialog.isVisible());
      assert.equal(await dialog.getByLabel('课程', { exact: true }).inputValue(), '');
      await dialog.getByLabel('课程', { exact: true }).click();
      await page.keyboard.press('End');
      await page.keyboard.press('Enter');
      assert.equal(
        await dialog.getByLabel('课程', { exact: true }).inputValue(),
        courses.at(-1).id,
      );
      await dialog.getByLabel('计划名称', { exact: true }).fill('下拉真实绑定验证');
      await select('计划类型', '固定计划', dialog);
      await dialog.getByLabel('重复安排', { exact: true }).check();
      await select('重复频率', '每天', dialog);
      await dialog.getByRole('button', { name: '保存', exact: true }).click();
      await dialog.waitFor({ state: 'detached' });
      const state = await page.evaluate(() => window.teachshelf.snapshot());
      const saved = state.state.tasks.find((p) => p.title === '下拉真实绑定验证');
      assert.equal(saved.courseID, courses.at(-1).id);
      assert.equal(saved.origin, 'fixed');
      assert.equal(saved.repeatRule.frequency, 'daily');
    },
  );
  await check(
    'Recurring occurrence disables protected choices and scope change re-enables them',
    async () => {
      await page
        .locator('.timeline-event')
        .filter({ hasText: '下拉真实绑定验证' })
        .first()
        .dblclick();
      const dialog = page.getByRole('dialog', { name: '编辑计划', exact: true });
      assert.equal(await dialog.getByLabel('计划类型', { exact: true }).isDisabled(), true);
      assert.equal(await dialog.getByLabel('重复频率', { exact: true }).isDisabled(), true);
      await select('修改范围', '整组计划', dialog);
      assert.equal(await dialog.getByLabel('计划类型', { exact: true }).isEnabled(), true);
      await dialog.getByRole('button', { name: '取消', exact: true }).click();
      assert.equal(await popup().count(), 0);
    },
  );
  await check(
    'Live choice updates preserve focus and check state; keyboard prefix search selects an existing label',
    async () => {
      await b('计划列表').click();
      const control = page.getByLabel('计划课程筛选', { exact: true });
      await control.click();
      await page.keyboard.type('Alpha');
      assert.equal(await popup().locator('.highlighted').textContent(), 'Alpha 课程');
      await page.keyboard.press('Enter');
      assert.equal(await control.inputValue(), courses[0].id);
      await control.click();
      await page.evaluate(() =>
        window.teachshelf.createCourse({ name: '新同步课程', semester: '2026 秋季' }),
      );
      await popup().getByRole('option', { name: '新同步课程', exact: true }).waitFor();
      assert.equal(
        await popup().getByRole('option', { selected: true }).textContent(),
        courses[0].name,
      );
      await page.keyboard.press('Escape');
      await select('计划课程筛选', '全部课程');
    },
  );
  await check('Quick create exposes matching icons and arrow/escape menu navigation', async () => {
    await b('快捷新建').click();
    const menu = page.getByRole('menu', { name: '快捷新建菜单' });
    assert.deepEqual(
      await menu.locator('[data-symbol]').evaluateAll((ns) => ns.map((n) => n.dataset.symbol)),
      ['books', 'calendar-plus', 'globe'],
    );
    assert.equal(await page.evaluate(() => document.activeElement.textContent.trim()), '新建课程…');
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(() => document.activeElement.textContent.trim()), '新建计划…');
    await capture('quick-create');
    await page.keyboard.press('Escape');
    assert.equal(await menu.count(), 0);
    assert.equal(
      await page.evaluate(() => document.activeElement.getAttribute('aria-label')),
      '快捷新建',
    );
  });
  await check(
    'All pages and website dropdown render in dark minimum window without clipped controls',
    async () => {
      await page.evaluate(async () => {
        const s = await window.teachshelf.snapshot();
        await window.teachshelf.saveAppearance(
          { appearance: 'dark' },
          { root: s.root, revision: s.revision },
        );
      });
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].setBounds({ width: 1020, height: 680 }),
      );
      await page.waitForFunction(
        () =>
          document.documentElement.dataset.theme === 'dark' &&
          !document.querySelector('.appearance-curtain'),
      );
      for (const name of [
        '全部资料',
        '我的收藏',
        '最近打开',
        '未分类',
        '作业文件夹',
        '计划',
        'AI 助手',
      ]) {
        await nav(name);
        await capture('dark-' + name);
      }
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+,' : 'Control+,');
      for (const tab of ['外观', '顶栏', '资料库', '备份', 'AI 助手', 'MCP', '关于']) {
        await page.getByRole('tab', { name: tab, exact: true }).click();
        await capture('settings-' + tab);
      }
      await page.getByRole('tab', { name: '资料库', exact: true }).click();
      await b('打开教学网站工具').click();
      const dialog = page.getByRole('dialog', { name: '教学网站', exact: true });
      await dialog.getByLabel('网站类型', { exact: true }).click();
      assert.equal(
        await popup().evaluate((n) => getComputedStyle(n).backgroundColor),
        'rgb(41, 43, 45)',
      );
      const box = await popup().boundingBox();
      assert.ok(box.y >= 6 && box.y + box.height <= 680 - 6);
      await capture('website-dark-popup');
      await page.keyboard.press('Escape');
      assert.ok(await dialog.isVisible());
      await dialog.getByRole('button', { name: '关闭', exact: true }).click();
    },
  );
  assert.deepEqual(errors, []);
} finally {
  await fs.writeFile(
    path.join(evidence, 'controls-parity-report.json'),
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
    if (checks.length < 9) await app.evaluate(({ app }) => app.exit());
    else await app.close();
  }
}
