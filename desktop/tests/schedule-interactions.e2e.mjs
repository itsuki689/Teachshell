/** Browser plugin unavailable: real sandboxed Electron UI, disposable Swift-compatible library. */
import { _electron } from 'playwright';
import electron from 'electron';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Repository } from '../electron/services/storage/repository.ts';
const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'teachshell-meeting-ui-')));
const evidence = process.env.TEACHSHELF_SCREENSHOT_DIR || root;
await fs.mkdir(evidence, { recursive: true });
const repo = await Repository.open(path.join(root, 'library'), { create: true });
const row = {
  name: '详细课程',
  class_number: 'D001',
  teacher: '测试教师',
  classroom: '101',
  weeks: [1, 2, 3, 4],
  week_time: 1,
  start_time: 1,
  time_count: 0,
};
const imported = await repo.importTimetable({
  name: '2026 秋季',
  courses: [
    row,
    { ...row, name: '自由课程', class_number: 'F001', week_time: 0, start_time: 0, time_count: 0 },
  ],
});
const termID = imported.summary.termID,
  term = repo.state.timetableTerms[0],
  meetingID = term.meetings[0].id,
  freeID = term.meetings[1].id,
  courseID = term.meetings[0].courseID;
await repo.saveTimetableSettings(termID, {
  weekOneMonday: '2026-10-05T00:00:00+08:00',
  weekCount: 4,
  sectionTimes: [
    { section: 1, startMinute: 480, endMinute: 530 },
    { section: 2, startMinute: 540, endMinute: 590 },
  ],
});
await repo.setTimetableMeetingMonthVisible(termID, meetingID, true);
await repo.rescheduleTimetableClass(termID, meetingID, '2026-10-05', {
  date: '2026-10-07',
  startSection: 1,
  sectionCount: 1,
  classroom: '临时教室',
});
await repo.rescheduleTimetableClass(termID, meetingID, '2026-10-12', {
  date: '2026-10-14',
  startSection: 1,
  sectionCount: 1,
  classroom: '第二临时教室',
});
await repo.cancelTimetableClass(termID, meetingID, '2026-10-12');
await repo.saveTask({
  title: '侧栏完成计划',
  startsAt: '2026-10-26T10:00:00+08:00',
  endsAt: '2026-10-26T11:00:00+08:00',
  isAllDay: false,
  completionRequired: true,
  showInMonth: true,
  courseID,
});
const file = path.join(root, '保留资料.txt');
await fs.writeFile(file, '真实测试资料\n');
await repo.importFiles([file], { courseID });
await repo.close();
let app, page;
const checks = [],
  errors = [];
const button = (name) => page.getByRole('button', { name, exact: true });
const dialog = (name) => page.getByRole('dialog', { name, exact: true });
const mode = async (name) => {
  await page
    .getByRole('group', { name: '计划视图', exact: true })
    .getByRole('button', { name, exact: true })
    .click();
};
const snapshot = () => page.evaluate(() => window.teachshelf.snapshot());
async function until(fn, predicate) {
  for (let i = 0; i < 100; i++) {
    const value = await fn();
    if (predicate(value)) return value;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.fail('condition timed out');
}
async function check(name, fn) {
  await fn();
  checks.push(name);
  console.log('PASS', name);
}
async function close(name) {
  await dialog(name).getByRole('button', { name: '关闭', exact: true }).click();
}
async function screenshot(name) {
  assert.equal(await page.locator('vite-error-overlay').count(), 0);
  await page.screenshot({ path: path.join(evidence, name + '.png') });
}
async function openDetails() {
  await page
    .getByRole('complementary', { name: '选中日期安排' })
    .getByRole('button', { name: /查看安排 详细课程|查看月历课程 详细课程/ })
    .click();
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
  await page.getByLabel('跳转日期', { exact: true }).fill('2026-10-26');
  await check(
    'Month, week and day share full meeting details and free-course entry points',
    async () => {
      for (const [label, title] of [
        ['查看课表', '课程详情'],
        ['计划月历视图', '月历课程'],
        ['计划日程视图', '课程详情'],
      ]) {
        await mode(label);
        await openDetails();
        const details = dialog(title);
        const text = await details.innerText();
        for (const expected of ['测试教师', 'D001', '101', '1、2、3、4 周', '2026-10-26'])
          assert.ok(text.includes(expected), text);
        assert.equal(
          await details.getByRole('button', { name: '调整安排', exact: true }).isVisible(),
          true,
        );
        await screenshot('meeting-' + label);
        await close(title);
        await button('查看未定时课程 自由课程').click();
        assert.match(await dialog(title).innerText(), /自由时间 · 尚未安排/);
        assert.equal(
          await dialog(title).getByRole('button', { name: '本次停课', exact: true }).count(),
          0,
        );
        await close(title);
      }
    },
  );
  await check(
    'Weekly drafts retain edits across scope changes, validate weeks and rebase exceptions',
    async () => {
      await openDetails();
      await button('调整安排').click();
      const edit = dialog('调整课程安排');
      await edit.getByRole('button', { name: '每周时段', exact: true }).click();
      await edit.getByLabel('上课星期', { exact: true }).selectOption('2');
      await edit.getByLabel('上课地点', { exact: true }).fill('202');
      await edit.getByRole('button', { name: '仅这次课', exact: true }).click();
      assert.equal(await edit.getByLabel('上课地点', { exact: true }).inputValue(), '101');
      await edit.getByRole('button', { name: '每周时段', exact: true }).click();
      assert.equal(await edit.getByLabel('上课地点', { exact: true }).inputValue(), '202');
      await edit.getByRole('button', { name: '清空', exact: true }).click();
      assert.equal(
        await edit.getByRole('button', { name: '保存安排', exact: true }).isDisabled(),
        true,
      );
      await edit.getByRole('button', { name: '全选', exact: true }).click();
      await edit.getByRole('button', { name: '保存安排', exact: true }).click();
      await edit.waitFor({ state: 'hidden' });
      const t = (await snapshot()).state.timetableTerms[0];
      assert.equal(t.meetings[0].weekday, 2);
      assert.equal(t.reschedules[0].meeting.classroom, '临时教室');
      await page.getByLabel('日程日期', { exact: true }).fill('2026-10-27');
      await openDetails();
      assert.match(await dialog('课程详情').innerText(), /202/);
      await close('课程详情');
    },
  );
  await check(
    'Single occurrence editor moves only this class and preserves custom clock range',
    async () => {
      await openDetails();
      await button('调整安排').click();
      const edit = dialog('调整课程安排');
      assert.equal(
        await edit
          .getByRole('button', { name: '仅这次课', exact: true })
          .getAttribute('aria-pressed'),
        'true',
      );
      await edit.getByLabel('上课日期', { exact: true }).fill('2026-10-28');
      await edit.getByLabel('自定义钟点', { exact: true }).check();
      await edit.getByLabel('课程开始时间', { exact: true }).fill('17:10');
      await edit.getByLabel('课程结束时间', { exact: true }).fill('18:20');
      await edit.getByRole('button', { name: '保存安排', exact: true }).click();
      await edit.waitFor({ state: 'hidden' });
      assert.equal(await page.getByLabel('日程日期', { exact: true }).inputValue(), '2026-10-28');
      await openDetails();
      assert.match(await dialog('课程详情').innerText(), /17:10 – 18:20/);
      await close('课程详情');
    },
  );
  await check(
    'Color changes and inheritance propagate through month, week, day and cancelled moves',
    async () => {
      await openDetails();
      await button('课程颜色').click();
      await button('颜色 #AE567C').click();
      await button('应用颜色').click();
      await dialog('课程颜色').waitFor({ state: 'hidden' });
      let t = (await snapshot()).state.timetableTerms[0];
      assert.equal(t.meetings[0].colorHex, '#AE567C');
      assert.ok(t.reschedules.every((r) => r.meeting.colorHex === '#AE567C'));
      assert.equal(t.cancellations[0].savedReschedule.meeting.colorHex, '#AE567C');
      await close('课程详情');
      for (const label of ['计划月历视图', '查看课表', '计划日程视图']) {
        await mode(label);
        const rows = page
          .locator('.selected-day-plans .schedule-event-row')
          .filter({ hasText: '详细课程' });
        assert.equal(
          await rows.evaluate((n) => n.style.getPropertyValue('--event-color')),
          '#AE567C',
        );
      }
      await openDetails();
      await button('课程颜色').click();
      await button('恢复课程颜色').click();
      await dialog('课程颜色').waitFor({ state: 'hidden' });
      t = (await snapshot()).state.timetableTerms[0];
      assert.equal(t.meetings[0].colorHex, undefined);
      await close('课程详情');
    },
  );
  await check(
    'Linked plan uses selected course/date and native unscheduled homework defaults',
    async () => {
      await openDetails();
      await button('新建关联计划').click();
      const edit = dialog('新建计划');
      assert.equal(await edit.getByLabel('课程', { exact: true }).inputValue(), courseID);
      assert.equal(await edit.getByLabel('安排执行时间', { exact: true }).isChecked(), false);
      assert.equal(await edit.getByLabel('需要标记完成', { exact: true }).isChecked(), true);
      await edit.getByLabel('计划名称', { exact: true }).fill('关联作业');
      await edit.getByRole('button', { name: '保存', exact: true }).click();
      await edit.waitFor({ state: 'hidden' });
      const task = (await snapshot()).state.tasks.find((t) => t.title === '关联作业');
      assert.equal(task.kind, '作业');
      assert.equal(task.courseID, courseID);
      await openDetails();
      await button('查看课程资料').click();
      await page.locator('main').getByText('保留资料', { exact: true }).waitFor();
      assert.ok((await page.locator('main').innerText()).includes('保留资料'));
      await page.locator('.sidebar').getByRole('button', { name: '计划', exact: true }).click();
    },
  );
  await check(
    'Free-time course can receive a weekly slot without inventing a single occurrence',
    async () => {
      await button('查看未定时课程 自由课程').click();
      await button('调整安排').click();
      const edit = dialog('调整课程安排');
      assert.equal(await edit.getByRole('button', { name: '仅这次课', exact: true }).count(), 0);
      await edit.getByLabel('上课星期', { exact: true }).selectOption('4');
      await edit.getByRole('button', { name: '清空', exact: true }).click();
      await edit.getByLabel('第 4 周', { exact: true }).check();
      await edit.getByRole('button', { name: '保存安排', exact: true }).click();
      await edit.waitFor({ state: 'hidden' });
      const t = (await snapshot()).state.timetableTerms[0];
      assert.equal(t.meetings.find((m) => m.id === freeID).weekday, 4);
      assert.deepEqual(t.meetings.find((m) => m.id === freeID).weeks, [4]);
      assert.equal(await button('查看未定时课程 自由课程').count(), 0);
    },
  );
  await check(
    'Removing a weekly slot and undo restores exceptions and keeps course/material metadata',
    async () => {
      await openDetails();
      await button('调整安排').click();
      const edit = dialog('调整课程安排');
      await edit.getByRole('button', { name: '每周时段', exact: true }).click();
      const before = await snapshot();
      await edit.getByRole('button', { name: '移除时段', exact: true }).click();
      await dialog('移除每周时段？').getByRole('button', { name: '移除时段', exact: true }).click();
      await edit.waitFor({ state: 'hidden' });
      let state = (await snapshot()).state;
      assert.equal(
        state.timetableTerms[0].meetings.some((m) => m.id === meetingID),
        false,
      );
      assert.deepEqual(state.materials, before.state.materials);
      assert.deepEqual(state.courses, before.state.courses);
      await button('撤销上次课表修改').click();
      await until(snapshot, (s) =>
        s.state.timetableTerms[0].meetings.some((m) => m.id === meetingID),
      );
      assert.deepEqual((await snapshot()).state.timetableTerms, before.state.timetableTerms);
    },
  );
  await check(
    'Default, all-day and empty creation presets match native behavior and sidebar completion works',
    async () => {
      await button('新建计划').click();
      let edit = dialog('新建计划');
      assert.equal(await edit.getByLabel('安排执行时间', { exact: true }).isChecked(), false);
      assert.equal(await edit.getByLabel('需要标记完成', { exact: true }).isChecked(), false);
      await edit.getByLabel('计划名称', { exact: true }).fill('待安排默认');
      await edit.getByRole('button', { name: '保存', exact: true }).click();
      await edit.waitFor({ state: 'hidden' });
      for (const [label, name] of [
        ['添加全天安排', '全天新建'],
        ['新建“空”', '空'],
      ]) {
        await button('更多新建计划方式').click();
        await page.getByRole('menuitem', { name: label, exact: true }).click();
        edit = dialog('新建计划');
        await edit.getByLabel('计划名称', { exact: true }).fill(name);
        await edit.getByRole('button', { name: '保存', exact: true }).click();
        await edit.waitFor({ state: 'hidden' });
      }
      const state = (await snapshot()).state;
      assert.equal(state.tasks.find((t) => t.title === '待安排默认').hasExecutionTime, false);
      assert.equal(state.tasks.find((t) => t.title === '全天新建').isAllDay, true);
      assert.equal(state.tasks.find((t) => t.title === '空').completionRequired, false);
      await page.getByLabel('日程日期', { exact: true }).fill('2026-10-26');
      await button('完成此项 侧栏完成计划').click();
      await until(
        snapshot,
        (s) => s.state.tasks.find((t) => t.title === '侧栏完成计划').completedAt != null,
      );
      await button('恢复此项 侧栏完成计划').click();
      await until(
        snapshot,
        (s) => s.state.tasks.find((t) => t.title === '侧栏完成计划').completedAt == null,
      );
    },
  );
  await check(
    'Blank timeline drag creates a bounded empty plan; Escape and crossing days cancel',
    async () => {
      await mode('查看课表');
      const column = page.locator('.timeline-day[data-day="2026-10-30"]');
      await column.scrollIntoViewIfNeeded();
      const box = await column.boundingBox();
      const x = box.x + box.width / 2,
        y = box.y + 80;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x, y + 45, { steps: 8 });
      await page.locator('.creation-preview').waitFor();
      await page.keyboard.press('Escape');
      await page.mouse.up();
      assert.equal(await dialog('新建计划').count(), 0);
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + box.width, y + 45, { steps: 8 });
      await page.mouse.up();
      assert.equal(await dialog('新建计划').count(), 0);
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x, y + 45, { steps: 8 });
      await page.mouse.up();
      const edit = dialog('新建计划');
      await edit.waitFor();
      assert.match(await edit.getByLabel(/开始时间/).inputValue(), /^2026-10-30/);
      await edit.getByLabel('计划名称', { exact: true }).fill('拖建空档');
      await edit.getByRole('button', { name: '保存', exact: true }).click();
      await page.locator('.timeline-event').filter({ hasText: '拖建空档' }).waitFor();
    },
  );
  await check(
    'Unsaved meeting edits prompt on dismiss; stale and invalid IPC writes leave state intact',
    async () => {
      await page.getByLabel('跳转日期', { exact: true }).fill('2026-10-28');
      await openDetails();
      await button('调整安排').click();
      const edit = dialog('调整课程安排');
      await edit.getByLabel('上课地点', { exact: true }).fill('未保存');
      await edit.getByRole('button', { name: '取消', exact: true }).click();
      await dialog('放弃课程安排修改？')
        .getByRole('button', { name: '放弃修改', exact: true })
        .click();
      await edit.waitFor({ state: 'hidden' });
      await close('课程详情');
      const before = await snapshot();
      const rejects = await page.evaluate(
        async ({ termID, meetingID, before }) => {
          const api = window.teachshelf,
            guard = { root: before.root, revision: before.revision },
            input = { weekday: 1, startSection: 1, sectionCount: 1, classroom: 'bad', weeks: [1] };
          const out = [];
          for (const fn of [
            () => api.updateTimetableMeeting(termID, meetingID, { ...input, extra: true }, guard),
            () => api.updateTimetableMeeting(termID, meetingID, { ...input, weeks: [99] }, guard),
            () => api.setTimetableMeetingColor(termID, meetingID, 'red', guard),
            () =>
              api.deleteTimetableMeeting(termID, meetingID, { ...guard, revision: '0'.repeat(64) }),
            () => api.undoTimetableChange({ ...guard, root: '/not-this-library' }),
          ]) {
            try {
              await fn();
              out.push(false);
            } catch {
              out.push(true);
            }
          }
          return out;
        },
        { termID, meetingID, before },
      );
      assert.deepEqual(rejects, [true, true, true, true, true]);
      assert.equal((await snapshot()).revision, before.revision);
    },
  );
  await check('Unanchored weekly courses open editable details without a fake date', async () => {
    await page.evaluate(
      async ({ termID }) =>
        window.teachshelf.saveTimetableSettings(termID, { weekOneMonday: null, endDate: null }),
      { termID },
    );
    await page.getByLabel('课表周次', { exact: true }).fill('4');
    await button('查看未关联日期课程 详细课程').click();
    assert.match(await dialog('课程详情').innerText(), /尚未对应具体上课日期/);
    await button('调整安排').click();
    const edit = dialog('调整课程安排');
    assert.equal(await edit.getByRole('button', { name: '仅这次课', exact: true }).count(), 0);
    await edit.getByRole('button', { name: '取消', exact: true }).click();
    await close('课程详情');
  });
  await check(
    'All three views and detailed editor fit minimum dark window with no page errors',
    async () => {
      await page.evaluate(
        async ({ termID }) =>
          window.teachshelf.saveTimetableSettings(termID, {
            weekOneMonday: '2026-10-05T00:00:00+08:00',
          }),
        { termID },
      );
      await page.locator('.day-night-toggle').click({ button: 'right' });
      await page.getByRole('menuitemradio', { name: '深色', exact: true }).click();
      await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].setBounds({ width: 1020, height: 680 }),
      );
      for (const label of ['计划月历视图', '查看课表', '计划日程视图']) {
        await mode(label);
        await screenshot('interactions-small-dark-' + label);
        const metrics = await page.evaluate(() => ({
          width: innerWidth,
          height: innerHeight,
          scroll: document.documentElement.scrollWidth,
          footer: document.querySelector('.schedule-create').getBoundingClientRect().bottom,
        }));
        assert.ok(metrics.scroll <= metrics.width);
        assert.ok(metrics.footer <= metrics.height);
      }
      await openDetails();
      await button('调整安排').click();
      await screenshot('weekly-editor-small-dark');
      const box = await dialog('调整课程安排').boundingBox();
      assert.ok(box.y >= 0 && box.y + box.height <= 680);
      await dialog('调整课程安排').getByRole('button', { name: '取消', exact: true }).click();
      await close('课程详情');
      assert.deepEqual(errors, []);
    },
  );
  console.log(JSON.stringify({ passed: checks.length, checks, errors, evidence }, null, 2));
} finally {
  if (page) await page.screenshot({ path: path.join(evidence, 'last-state.png') }).catch(() => {});
  if (app) await app.close();
  await fs.rm(root, { recursive: true, force: true });
}
