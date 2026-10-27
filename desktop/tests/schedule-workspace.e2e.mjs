/** Browser plugin not available: actual Electron calendar UI with disposable data. */
import { _electron } from 'playwright';
import electron from 'electron';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Repository } from '../electron/services/storage/repository.ts';
const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'teachshell-schedule-ui-')));
const evidence = process.env.TEACHSHELF_SCREENSHOT_DIR || os.tmpdir();
await fs.mkdir(evidence, { recursive: true });
const repo = await Repository.open(path.join(root, 'library'), { create: true });
const imported = await repo.importTimetable({
  name: '2026 秋季',
  courses: [
    {
      name: '统一日历课程',
      class_number: 'TEST1',
      teacher: '测试教师',
      classroom: '101',
      weeks: [1, 2, 3, 4],
      week_time: 1,
      start_time: 1,
      time_count: 0,
    },
  ],
});
const termID = imported.summary.termID,
  courseID = repo.state.courses[0].id;
await repo.saveTimetableSettings(termID, {
  weekOneMonday: '2026-10-05T00:00:00+08:00',
  weekCount: 4,
  sectionTimes: [{ section: 1, startMinute: 480, endMinute: 530 }],
});
for (const input of [
  {
    title: '普通活动',
    startsAt: '2026-10-26T09:00:00+08:00',
    endsAt: '2026-10-26T10:00:00+08:00',
    showInMonth: false,
  },
  {
    title: '全天安排',
    startsAt: '2026-10-26T00:00:00+08:00',
    endsAt: '2026-10-27T00:00:00+08:00',
    isAllDay: true,
    showInMonth: true,
  },
  {
    title: '截止作业',
    startsAt: '2026-10-26T00:00:00+08:00',
    deadline: '2026-10-26T18:00:00+08:00',
    hasExecutionTime: false,
    showInMonth: false,
  },
  { title: '跨天安排', startsAt: '2026-10-25T23:00:00+08:00', endsAt: '2026-10-26T01:00:00+08:00' },
  {
    title: '学期外活动',
    startsAt: '2026-11-02T09:00:00+08:00',
    endsAt: '2026-11-02T10:00:00+08:00',
    showInMonth: true,
  },
  { title: '未定时间计划', startsAt: '2026-10-26T00:00:00+08:00', hasExecutionTime: false },
])
  await repo.saveTask({
    courseID,
    isAllDay: false,
    hasExecutionTime: true,
    showOnCalendar: true,
    ...input,
  });
await repo.close();
let app, page;
const checks = [],
  errors = [],
  geometry = [];
const b = (name) => page.getByRole('button', { name, exact: true });
const mode = (name) =>
  page
    .getByRole('group', { name: '计划视图', exact: true })
    .getByRole('button', { name, exact: true })
    .click();
async function check(name, fn) {
  await fn();
  checks.push(name);
  console.log('PASS', name);
}
async function capture(name) {
  const bar = await page.locator('.schedule-datebar').boundingBox(),
    side = await page.locator('.schedule-options').boundingBox();
  assert.equal(bar.height, 48);
  assert.ok(side.x >= bar.x + bar.width - 1);
  const footer = await page.locator('.schedule-create').boundingBox();
  const viewport = await page.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
    scroll: document.documentElement.scrollWidth,
  }));
  assert.ok(footer.y + footer.height <= viewport.height);
  assert.ok(viewport.scroll <= viewport.width);
  geometry.push({ name, bar, side, footer });
  assert.equal(await page.locator('vite-error-overlay').count(), 0);
  await page.screenshot({ path: path.join(evidence, 'schedule-' + name + '.png') });
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
  await page.locator('.sidebar').getByRole('button', { name: '计划', exact: true }).click();
  await check(
    'Week uses the selected civil date and shows both courses and cross-midnight activities',
    async () => {
      assert.match(page.url(), /^file:/);
      assert.equal(await page.title(), 'Teachshell · 课屿');
      await page.getByLabel('跳转日期', { exact: true }).fill('2026-10-26');
      await page.locator('.timeline-event').filter({ hasText: '统一日历课程' }).waitFor();
      const overnight = page.locator('.timeline-event').filter({ hasText: '跨天安排' });
      assert.equal(await overnight.getAttribute('data-start'), '0');
      assert.equal(await overnight.getAttribute('data-end'), '60');
      const before = await fs.readFile(path.join(root, 'library/library.json'), 'utf8');
      await overnight.click();
      assert.equal(await b('调整开始边界 跨天安排').count(), 0);
      await page.keyboard.press('ArrowDown');
      assert.equal(await fs.readFile(path.join(root, 'library/library.json'), 'utf8'), before);
      await capture('week-light');
    },
  );
  await check(
    'Month, week and day share one inspector, selected date and full-height content frame',
    async () => {
      await page.locator('.schedule-options').evaluate((el) => (el.dataset.instance = 'retained'));
      await mode('计划月历视图');
      assert.equal(
        await page.locator('.schedule-options').getAttribute('data-instance'),
        'retained',
      );
      assert.equal(await page.locator('.month-day').count(), 42);
      const cell = page.locator('.month-day[data-date="2026-10-26"]');
      assert.equal(await cell.getAttribute('aria-pressed'), 'true');
      assert.ok((await cell.innerText()).includes('截止作业'));
      assert.equal((await cell.innerText()).includes('普通活动'), false);
      await capture('month-light');
      await mode('计划日程视图');
      assert.equal(await page.getByLabel('日程日期', { exact: true }).inputValue(), '2026-10-26');
      assert.equal(
        await page.locator('.schedule-options').getAttribute('data-instance'),
        'retained',
      );
      for (const section of ['全天计划', '当天截止', '时间安排'])
        await page
          .locator('.schedule-day-section')
          .filter({ has: page.getByRole('heading', { name: section, exact: true }) })
          .waitFor();
      await b('查看课程 统一日历课程').waitFor();
      await b('编辑计划 普通活动').waitFor();
      const row = page.locator('.schedule-day-view .schedule-event-row').first();
      const rect = await row.boundingBox();
      const title = await row.locator('strong').boundingBox();
      assert.ok(rect.height < 95, 'Day cards must not inherit list-row padding');
      assert.ok(title.x - rect.x < 45, 'Day descriptions must align to the left');
      await capture('day-light');
      await page.locator('.schedule-day-view').evaluate((el) => {
        el.scrollTop = el.scrollHeight;
      });
      assert.ok(await page.locator('.schedule-day-view').evaluate((el) => el.scrollTop > 0));
      await b('下一天').click();
      await b('上一天').click();
      assert.equal(await page.locator('.schedule-day-view').evaluate((el) => el.scrollTop), 0);
    },
  );
  await check(
    'Shared source and course filters remain effective after changing calendar modes',
    async () => {
      await page.getByLabel('固定', { exact: true }).uncheck();
      assert.equal(await b('查看课程 统一日历课程').count(), 0);
      assert.equal(await b('编辑计划 截止作业').count(), 0);
      await b('编辑计划 普通活动').waitFor();
      await mode('查看课表');
      assert.equal(
        await page.locator('.timeline-event').filter({ hasText: '统一日历课程' }).count(),
        0,
      );
      await mode('计划月历视图');
      assert.equal(await page.getByLabel('固定', { exact: true }).isChecked(), false);
      await page.getByLabel('固定', { exact: true }).check();
      await page.getByLabel('活动', { exact: true }).uncheck();
      await mode('计划日程视图');
      assert.equal(await b('编辑计划 普通活动').count(), 0);
      await b('编辑计划 截止作业').waitFor();
      await page.getByLabel('活动', { exact: true }).check();
      await page.getByLabel('搜索计划', { exact: true }).fill('普通 活动');
      assert.equal(await page.locator('.schedule-day-view .schedule-event-row').count(), 1);
      await mode('查看课表');
      assert.equal(await page.getByLabel('搜索计划', { exact: true }).inputValue(), '普通 活动');
      assert.equal(await page.locator('.timeline-event').count(), 1);
      await page.getByLabel('搜索计划', { exact: true }).fill('');
    },
  );
  await check(
    'Moving past the academic term keeps real dates and local activity plans instead of snapping back',
    async () => {
      await b('下一周').click();
      assert.equal(await page.getByLabel('跳转日期', { exact: true }).inputValue(), '2026-11-02');
      await page.locator('.timeline-event').filter({ hasText: '学期外活动' }).waitFor();
      assert.equal(
        await page.locator('.timeline-event').filter({ hasText: '统一日历课程' }).count(),
        0,
      );
      await page.getByText('当前日期在学期之外，活动计划仍可正常安排。', { exact: true }).waitFor();
      await mode('计划月历视图');
      await mode('计划日程视图');
      assert.equal(await page.getByLabel('日程日期', { exact: true }).inputValue(), '2026-11-02');
      await b('编辑计划 学期外活动').waitFor();
      await capture('outside-term');
    },
  );
  await check(
    'Month-end navigation clamps correctly and double-click opens the same date in day view',
    async () => {
      await mode('计划月历视图');
      await page.getByLabel('月历月份', { exact: true }).fill('2027-01');
      await page.getByLabel('选择日期 2027-01-31', { exact: true }).click();
      await b('下个月').click();
      assert.equal(
        await page.getByLabel('选择日期 2027-02-28', { exact: true }).getAttribute('aria-pressed'),
        'true',
      );
      await page.getByLabel('选择日期 2027-02-28', { exact: true }).dblclick();
      assert.equal(await page.getByLabel('日程日期', { exact: true }).inputValue(), '2027-02-28');
      await b('上一天').click();
      assert.equal(await page.getByLabel('日程日期', { exact: true }).inputValue(), '2027-02-27');
      await mode('计划月历视图');
      await page.getByLabel('选择日期 2027-02-28', { exact: true }).focus();
      await page.keyboard.press('ArrowRight');
      assert.equal(await page.getByLabel('月历月份', { exact: true }).inputValue(), '2027-03');
      assert.equal(await page.locator(':focus').getAttribute('data-date'), '2027-03-01');
      await page.keyboard.press('ArrowLeft');
      assert.equal(await page.locator(':focus').getAttribute('data-date'), '2027-02-28');
      await mode('计划日程视图');
      await b('上一天').click();
    },
  );
  await check(
    'Calendar mode and date survive list round trips; new plans use the selected day',
    async () => {
      await b('计划列表视图').click();
      await page.locator('.plan-list-workspace').waitFor();
      await page.locator('.sidebar').getByRole('button', { name: '计划', exact: true }).click();
      assert.equal(await page.locator('.schedule-workspace').getAttribute('data-view'), 'agenda');
      assert.equal(await page.getByLabel('日程日期', { exact: true }).inputValue(), '2027-02-27');
      await page.getByLabel('计划课程筛选', { exact: true }).selectOption(courseID);
      await b('新建计划').click();
      const editor = page.getByRole('dialog', { name: '新建计划', exact: true });
      assert.equal(await editor.getByLabel('课程', { exact: true }).inputValue(), courseID);
      await editor.getByLabel('安排执行时间', { exact: true }).check();
      assert.match(
        await editor.getByLabel('开始时间', { exact: false }).inputValue(),
        /^2027-02-27/,
      );
      await editor.getByLabel('计划名称', { exact: true }).fill('统一工作区新计划');
      await editor.getByRole('button', { name: '保存', exact: true }).click();
      await b('编辑计划 统一工作区新计划').waitFor();
      await page.getByLabel('计划课程筛选', { exact: true }).selectOption('');
    },
  );
  await check(
    'Small dark calendar fits all 42 cells and keeps navigation, inspector and create action reachable',
    async () => {
      await page.locator('.day-night-toggle').click({ button: 'right' });
      await page.getByRole('menuitemradio', { name: '深色', exact: true }).click();
      await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].setBounds({ width: 1020, height: 680 }),
      );
      for (const [name, button] of [
        ['month-dark-minimum', '计划月历视图'],
        ['day-dark-minimum', '计划日程视图'],
        ['week-dark-minimum', '查看课表'],
      ]) {
        await mode(button);
        await capture(name);
      }
      await mode('计划月历视图');
      const last = await page.locator('.month-day').last().boundingBox(),
        board = await page.locator('.month-board').boundingBox();
      assert.ok(last.y + last.height <= board.y + board.height + 1);
    },
  );
  await check(
    'Undated academic weeks retain their week number without fabricating civil dates',
    async () => {
      await page.evaluate(
        (id) => window.teachshelf.saveTimetableSettings(id, { weekOneMonday: null }),
        termID,
      );
      await mode('查看课表');
      await page.getByLabel('课表周次', { exact: true }).fill('2');
      await page.getByRole('heading', { name: '第 2 周 · 尚未关联日期', exact: true }).waitFor();
      assert.equal(await page.getByLabel('跳转日期', { exact: true }).isDisabled(), true);
      await page.locator('.floating-week').getByText('统一日历课程', { exact: false }).waitFor();
      await page.getByLabel('固定', { exact: true }).uncheck();
      assert.equal(await page.locator('.floating-week p').count(), 0);
      await page.getByLabel('固定', { exact: true }).check();
      await mode('计划日程视图');
      await page.getByLabel('日程日期', { exact: true }).fill('2026-10-26');
      assert.equal(await b('查看课程 统一日历课程').count(), 0);
      await b('编辑计划 普通活动').waitFor();
      await mode('查看课表');
      assert.equal(await page.getByLabel('课表周次', { exact: true }).inputValue(), '2');
      const weekBoard = await page.locator('.floating-week').boundingBox();
      const sunday = await page.locator('.floating-week section').last().boundingBox();
      assert.ok(sunday.x + sunday.width <= weekBoard.x + weekBoard.width + 1);
      await capture('undated-week');
    },
  );
  assert.deepEqual(errors, []);
  await fs.writeFile(
    path.join(evidence, 'schedule-workspace-report.json'),
    JSON.stringify({ checks, errors, geometry }, null, 2),
  );
  console.log(JSON.stringify({ passed: checks.length, rendererErrors: errors.length }));
} catch (error) {
  await page
    ?.screenshot({ path: path.join(evidence, 'schedule-workspace-failure.png') })
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
