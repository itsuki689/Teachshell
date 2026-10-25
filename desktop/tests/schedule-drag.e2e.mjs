/** Browser plugin not available: real Electron mouse input exercises the shipped IPC. */
import { _electron } from 'playwright';
import electronPath from 'electron';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const executable = process.env.TEACHSHELF_EXECUTABLE;
if (executable && !path.isAbsolute(executable))
  throw new Error('TEACHSHELF_EXECUTABLE must be absolute');
const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'teachshell-drag-')));
const evidence =
  process.env.TEACHSHELF_SCREENSHOT_DIR ?? (process.platform === 'win32' ? os.tmpdir() : '/tmp');
await fs.mkdir(evidence, { recursive: true });
const steps = [],
  errors = [];
let app, page, termID, meetingID, occurrenceID;
const snapshot = () => page.evaluate(() => window.teachshelf.snapshot());
async function check(name, fn) {
  const start = Date.now();
  await fn();
  steps.push({ name, status: 'passed', durationMs: Date.now() - start });
  console.log('PASS', name);
}
async function until(predicate) {
  const end = Date.now() + 10000;
  while (Date.now() < end) {
    const s = await snapshot();
    if (predicate(s.state)) return s;
    await new Promise((r) => setTimeout(r, 60));
  }
  throw new Error('Timed out waiting for timetable mutation');
}
const event = () =>
  page
    .locator('.timeline-event')
    .filter({ hasText: '高等数学 A' })
    .filter({ has: page.locator('small').filter({ hasText: '08:07–09:58' }) });
function occurrence() {
  return page
    .locator('.timeline-event')
    .filter({ hasText: '高等数学 A' })
    .locator(`xpath=self::*[@data-event-id=${JSON.stringify(occurrenceID)}]`);
}
async function point(day, minute) {
  const column = await page.locator(`.timeline-day[data-day="${day}"]`).boundingBox(),
    line = await page
      .locator(`.timeline-day[data-day="${day}"] [data-minute="${minute}"]`)
      .boundingBox();
  assert.ok(column && line);
  // Stay one pixel inside the period: tiny CSS rounding at a collapsed break
  // otherwise legitimately selects the previous period's end minute.
  return { x: column.x + column.width / 2, y: line.y };
}
async function beginDrag(source, target) {
  await source.scrollIntoViewIfNeeded();
  const rect = await source.boundingBox();
  assert.ok(rect);
  const grab = Math.min(12, rect.height / 2);
  await page.mouse.move(rect.x + Math.min(30, rect.width / 2), rect.y + grab);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y + grab + 1, { steps: 12 });
}
async function move(source, day, minute) {
  const target = await point(day, minute);
  await beginDrag(source, target);
  await page.getByLabel('拖动目标', { exact: true }).waitFor();
  await page.mouse.up();
}
async function waitCard(id, key, value) {
  await page.waitForFunction(
    ({ id, key, value }) =>
      [...document.querySelectorAll('.timeline-event')].some(
        (e) => e.dataset.eventId === id && e.dataset[key] === String(value) && !e.disabled,
      ),
    { id, key, value },
  );
}
async function resize(title, edge, dy) {
  const handle = page.getByRole('button', {
    name: (edge === 'start' ? '调整开始边界 ' : '调整结束边界 ') + title,
    exact: true,
  });
  const box = await handle.boundingBox();
  assert.ok(box);
  await page.mouse.move(box.x + box.width / 2, box.y + 3);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + 3 + dy, { steps: 12 });
  await page.getByLabel('拖动目标', { exact: true }).waitFor();
}
try {
  app = await _electron.launch({
    executablePath: executable ?? electronPath,
    args: executable ? [] : [desktop],
    cwd: desktop,
    env: { ...process.env, TEACHSHELF_TEST_ROOT: root },
    timeout: 30000,
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(10000);
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.waitForSelector('.app-body');
  await check(
    'Actual Electron imports the Swift timetable sample and renders its minute grid',
    async () => {
      assert.match(page.url(), /^file:/);
      assert.match(await page.title(), /Teachshell|课屿/);
      await app.evaluate(
        ({ dialog }, file) => {
          dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
        },
        path.join(desktop, '../Resources/Timetable/Sample-undergraduate.json'),
      );
      await page.locator('.paired-nav').getByRole('button', { name: '计划', exact: true }).click();
      await page.locator('.timeline-board').waitFor();
      await page.getByRole('button', { name: '导入课表 JSON', exact: true }).first().click();
      const settings = page.getByRole('dialog', { name: '学期设置' });
      await settings.getByLabel('第一周周一（北京时间）', { exact: true }).fill('2026-09-07');
      await settings.getByLabel('学期周数', { exact: true }).fill('16');
      const times = [
        [480, 530],
        [540, 590],
        [610, 660],
        [670, 720],
        [840, 890],
        [900, 950],
        [970, 1020],
        [1030, 1080],
        [1110, 1160],
        [1170, 1220],
        [1230, 1280],
      ];
      const clock = (n) =>
        `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
      for (let i = 0; i < times.length; i++) {
        await settings.getByLabel(`第${i + 1}节开始时间`, { exact: true }).fill(clock(times[i][0]));
        await settings.getByLabel(`第${i + 1}节结束时间`, { exact: true }).fill(clock(times[i][1]));
      }
      await settings.getByRole('button', { name: '保存学期设置', exact: true }).click();
      await settings.waitFor({ state: 'hidden' });
      await page.getByLabel('课表周次', { exact: true }).fill('1');
      const s = await snapshot();
      termID = s.state.timetableTerms[0].id;
      meetingID = s.state.timetableTerms[0].meetings.find(
        (m) => m.title === '高等数学 A' && m.weekday === 1,
      ).id;
      await page.getByRole('button', { name: '课表课程列表', exact: true }).click();
      await page
        .locator('.week-day')
        .first()
        .getByRole('button', { name: '调整本次', exact: true })
        .click();
      const editor = page.getByRole('dialog', { name: '调整本次课程' });
      await editor.getByLabel('使用自定义时间', { exact: true }).check();
      await editor.getByLabel('上课时间', { exact: true }).fill('08:07');
      await editor.getByLabel('下课时间', { exact: true }).fill('09:58');
      await editor.getByRole('button', { name: '保存本次调整', exact: true }).click();
      await editor.waitFor({ state: 'hidden' });
      await page.getByRole('button', { name: '课表时间网格', exact: true }).click();
      await event().waitFor();
      occurrenceID = await event().getAttribute('data-event-id');
      assert.ok(occurrenceID);
      assert.equal(await page.locator('.timeline-event').count(), 4);
      assert.equal(await page.getByLabel('编辑固定课程与计划', { exact: true }).isChecked(), false);
      await page.screenshot({ path: path.join(evidence, 'teachshell-timetable-grid.png') });
    },
  );
  await check(
    'Locked fixed courses do not move; unlocked drag preserves original occurrence and exact duration',
    async () => {
      const before = await snapshot();
      await beginDrag(occurrence(), await point('2026-09-08', 610));
      await page.mouse.up();
      assert.equal((await snapshot()).revision, before.revision);
      await page.getByLabel('编辑固定课程与计划', { exact: true }).check();
      await move(occurrence(), '2026-09-08', 610);
      const s = await until(
          (s) => s.timetableTerms[0].reschedules[0]?.meeting.startMinuteOverride === 610,
        ),
        r = s.state.timetableTerms[0].reschedules[0];
      assert.equal(r.meeting.endMinuteOverride - r.meeting.startMinuteOverride, 111);
      assert.equal(r.meeting.startSection, 1);
      assert.equal(r.meeting.sectionCount, 2);
      assert.equal(r.originalDate, before.state.timetableTerms[0].reschedules[0].originalDate);
      assert.equal(
        await page
          .locator('.timeline-day[data-day="2026-09-08"] .timeline-event')
          .getAttribute('data-event-id'),
        occurrenceID,
      );
      assert.deepEqual(s.state.timetableTerms[0].meetings, before.state.timetableTerms[0].meetings);
    },
  );
  await check(
    'A repeated drag preserves identity and overlapping occurrences remain separately selectable',
    async () => {
      const prior = (await snapshot()).state.timetableTerms[0].reschedules[0];
      await beginDrag(occurrence(), await point('2026-09-09', 610));
      await page
        .getByLabel('拖动目标', { exact: true })
        .getByText('与 1 项重叠，保留并列', { exact: true })
        .waitFor();
      await page.screenshot({ path: path.join(evidence, 'teachshell-timetable-drag-preview.png') });
      await page.mouse.up();
      const s = await until((s) => s.timetableTerms[0].reschedules[0]?.date !== prior.date),
        r = s.state.timetableTerms[0].reschedules[0];
      assert.equal(r.id, prior.id);
      assert.equal(r.originalDate, prior.originalDate);
      const cards = page.locator('.timeline-day[data-day="2026-09-09"] .timeline-event');
      assert.equal(await cards.count(), 2);
      assert.deepEqual(
        await cards.evaluateAll((elements) => elements.map((e) => e.dataset.lanes)),
        ['2', '2'],
      );
      assert.notEqual(
        await cards.nth(0).getAttribute('data-event-id'),
        await cards.nth(1).getAttribute('data-event-id'),
      );
      await page.screenshot({ path: path.join(evidence, 'teachshell-timetable-conflict.png') });
    },
  );
  await check(
    'Escape, out-of-grid drops and concurrent changes cancel the drag without stale writes',
    async () => {
      let before = await snapshot();
      await beginDrag(occurrence(), await point('2026-09-10', 480));
      await page.keyboard.press('Escape');
      await page.mouse.up();
      assert.equal((await snapshot()).revision, before.revision);
      await beginDrag(occurrence(), { x: 12, y: 90 });
      await page.mouse.up();
      assert.equal((await snapshot()).revision, before.revision);
      await beginDrag(occurrence(), await point('2026-09-10', 480));
      await page.getByLabel('拖动目标', { exact: true }).waitFor();
      const courseID = before.state.courses[0].id;
      await page.evaluate(
        (id) => window.teachshelf.updateCourse(id, { name: '并发保存课程' }),
        courseID,
      );
      await page.getByLabel('拖动目标', { exact: true }).waitFor({ state: 'hidden' });
      const concurrent = await snapshot();
      await page.mouse.up();
      assert.deepEqual((await snapshot()).state.timetableTerms, concurrent.state.timetableTerms);
      assert.equal(
        (await snapshot()).state.courses.find((c) => c.id === courseID).name,
        '并发保存课程',
      );
    },
  );
  await check(
    'A moved course can be cancelled, restored to the move, then returned to its recurring slot',
    async () => {
      const selected = page.getByLabel('选中时间安排', { exact: true });
      await selected.getByRole('button', { name: '取消本次', exact: true }).click();
      await page
        .getByRole('dialog', { name: '取消这次课程？' })
        .getByRole('button', { name: '取消本次', exact: true })
        .click();
      await until((s) => s.timetableTerms[0].cancellations.length === 1);
      await occurrence().waitFor({ state: 'detached' });
      await page.getByRole('button', { name: '恢复课程', exact: true }).click();
      await until((s) => s.timetableTerms[0].cancellations.length === 0);
      await occurrence().waitFor();
      await occurrence().click();
      await selected.getByRole('button', { name: '还原调课', exact: true }).click();
      await page
        .getByRole('dialog', { name: '还原这次调课？' })
        .getByRole('button', { name: '还原调课', exact: true })
        .click();
      await until((s) => s.timetableTerms[0].reschedules.length === 0);
      assert.equal(
        await page
          .locator('.timeline-day[data-day="2026-09-07"] .timeline-event')
          .getAttribute('data-start'),
        '480',
      );
    },
  );
  await check(
    'Selected-event time keys preserve duration and anchor while inputs and locked courses stay untouched',
    async () => {
      await occurrence().click();
      await page.keyboard.press('ArrowDown');
      await waitCard(occurrenceID, 'start', 490);
      const first = (await snapshot()).state.timetableTerms[0].reschedules.find(
        (r) => r.meetingID === meetingID,
      );
      await page.keyboard.press('Shift+=');
      await waitCard(occurrenceID, 'start', 491);
      await page.keyboard.press('-');
      await waitCard(occurrenceID, 'start', 490);
      await page.keyboard.press('ArrowUp');
      await waitCard(occurrenceID, 'start', 480);
      await page.keyboard.press('ArrowRight');
      await page
        .locator('.timeline-day[data-day="2026-09-08"]')
        .locator('.timeline-event')
        .filter({ hasText: '高等数学 A' })
        .waitFor();
      await waitCard(occurrenceID, 'start', 480);
      const moved = (await snapshot()).state.timetableTerms[0].reschedules.find(
        (r) => r.meetingID === meetingID,
      );
      assert.equal(moved.originalDate, first.originalDate);
      assert.equal(moved.meeting.endMinuteOverride - moved.meeting.startMinuteOverride, 110);
      await page.keyboard.press('ArrowLeft');
      await page
        .locator('.timeline-day[data-day="2026-09-07"]')
        .locator('.timeline-event')
        .waitFor();
      await waitCard(occurrenceID, 'start', 480);
      let before = await snapshot();
      await page.getByLabel('课表周次', { exact: true }).focus();
      await page.keyboard.press('ArrowUp');
      assert.equal((await snapshot()).revision, before.revision);
      await page.getByLabel('课表周次', { exact: true }).fill('1');
      await page.getByLabel('编辑固定课程与计划', { exact: true }).uncheck();
      await occurrence().click();
      before = await snapshot();
      await page.keyboard.press('ArrowDown');
      assert.equal((await snapshot()).revision, before.revision);
      assert.equal(await page.locator('.timeline-resize').count(), 0);
      await page.getByLabel('编辑固定课程与计划', { exact: true }).check();
      await occurrence().click();
    },
  );
  await check(
    'Mouse edge resizing changes only the chosen boundary, clamps positive duration and keeps one-off identity',
    async () => {
      const startLine = await point('2026-09-07', 480),
        laterLine = await point('2026-09-07', 540);
      await resize('高等数学 A', 'start', laterLine.y - startLine.y + 1);
      await page.mouse.up();
      await waitCard(occurrenceID, 'start', 540);
      assert.equal(await occurrence().getAttribute('data-end'), '590');
      const first = (await snapshot()).state.timetableTerms[0].reschedules.find(
        (r) => r.meetingID === meetingID,
      );
      assert.equal(
        first.originalDate,
        (Date.parse('2026-09-07T00:00:00+08:00') - 978307200000) / 1000,
      );
      const a = await point('2026-09-07', 610),
        b = await point('2026-09-07', 670);
      await resize('高等数学 A', 'end', b.y - a.y + 1);
      await page.screenshot({ path: path.join(evidence, 'teachshell-timetable-resize.png') });
      await page.mouse.up();
      await waitCard(occurrenceID, 'end', 670);
      assert.equal(await occurrence().getAttribute('data-start'), '540');
      await resize('高等数学 A', 'start', 1000);
      await page.mouse.up();
      await waitCard(occurrenceID, 'start', 660);
      assert.equal(await occurrence().getAttribute('data-end'), '670');
      const handle = page.getByRole('button', { name: '调整开始边界 高等数学 A', exact: true });
      await handle.focus();
      await page.keyboard.press('-');
      await waitCard(occurrenceID, 'start', 659);
      const resized = (await snapshot()).state.timetableTerms[0].reschedules.find(
        (r) => r.meetingID === meetingID,
      );
      assert.equal(resized.originalDate, first.originalDate);
      assert.equal(resized.id, first.id);
      assert.equal(resized.meeting.endMinuteOverride, 670);
      let before = await snapshot();
      await resize('高等数学 A', 'end', 40);
      await page.keyboard.press('Escape');
      await page.mouse.up();
      assert.equal((await snapshot()).revision, before.revision);
      await resize('高等数学 A', 'end', 40);
      await page.evaluate(
        (id) => window.teachshelf.updateCourse(id, { teacher: '并发缩放保护' }),
        before.state.courses[0].id,
      );
      await page.getByLabel('拖动目标', { exact: true }).waitFor({ state: 'hidden' });
      const concurrent = await snapshot();
      await page.mouse.up();
      assert.deepEqual((await snapshot()).state.timetableTerms, concurrent.state.timetableTerms);
      await page
        .getByLabel('选中时间安排', { exact: true })
        .getByRole('button', { name: '还原调课', exact: true })
        .click();
      await page
        .getByRole('dialog', { name: '还原这次调课？' })
        .getByRole('button', { name: '还原调课', exact: true })
        .click();
      await until((s) => s.timetableTerms[0].reschedules.length === 0);
    },
  );
  await check(
    'Recurring plan dragging changes only one execution time while preserving deadline and the following occurrence',
    async () => {
      const seconds = (s) => (Date.parse(s) - 978307200000) / 1000;
      await page.evaluate(
        ({ start, end, deadline }) =>
          window.teachshelf.savePlan({
            title: '重复拖动计划',
            content: '保留手工内容',
            startsAt: start,
            endsAt: end,
            deadline,
            isAllDay: false,
            hasExecutionTime: true,
            showOnCalendar: true,
            repeatRule: { frequency: 'weekly', interval: 1 },
          }),
        {
          start: seconds('2026-09-07T12:10:00+08:00'),
          end: seconds('2026-09-07T13:05:00+08:00'),
          deadline: seconds('2026-09-08T22:00:00+08:00'),
        },
      );
      await page.getByLabel('编辑固定课程与计划', { exact: true }).uncheck();
      const plan = page
        .locator('.timeline-event[data-kind="plan"]')
        .filter({ hasText: '重复拖动计划' });
      await plan.waitFor();
      const initial = (await snapshot()).state.tasks.find((t) => t.title === '重复拖动计划');
      await move(plan, '2026-09-08', 610);
      const saved = await until(
          (s) => s.tasks.find((t) => t.id === initial.id).exceptions?.length === 1,
        ),
        task = saved.state.tasks.find((t) => t.id === initial.id);
      assert.equal(task.deadline, initial.deadline);
      assert.equal(task.content, initial.content);
      assert.equal(task.startsAt, initial.startsAt);
      assert.equal(task.exceptions[0].endsAt - task.exceptions[0].startsAt, 55 * 60);
      assert.equal(task.exceptions[0].originalDate, initial.startsAt);
      assert.equal(
        await page
          .locator('.timeline-day[data-day="2026-09-08"] .timeline-event[data-kind="plan"]')
          .getAttribute('data-start'),
        '610',
      );
      await plan.click();
      const planID = await plan.getAttribute('data-event-id');
      const handle = page.getByRole('button', { name: '调整结束边界 重复拖动计划', exact: true });
      await handle.focus();
      await page.keyboard.press('ArrowDown');
      await waitCard(planID, 'end', 666);
      await plan.focus();
      await page.keyboard.press('=');
      await waitCard(planID, 'start', 611);
      const adjusted = (await snapshot()).state.tasks.find((t) => t.id === initial.id);
      assert.equal(adjusted.deadline, initial.deadline);
      assert.equal(adjusted.startsAt, initial.startsAt);
      assert.equal(adjusted.exceptions[0].originalDate, initial.startsAt);
      assert.equal(adjusted.exceptions[0].endsAt - adjusted.exceptions[0].startsAt, 56 * 60);
      await page.getByLabel('课表周次', { exact: true }).fill('2');
      await plan.waitFor();
      assert.equal(await plan.getAttribute('data-start'), '730');
      assert.equal(await plan.getAttribute('data-end'), '785');
    },
  );
  await check(
    'Minimum viewport remains scrollable and no renderer errors or framework overlays appear',
    async () => {
      await page.setViewportSize({ width: 1020, height: 680 });
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      );
      assert.equal(await page.locator('vite-error-overlay').count(), 0);
      assert.deepEqual(errors, []);
      await page.screenshot({ path: path.join(evidence, 'teachshell-timetable-grid-minimum.png') });
    },
  );
  await fs.writeFile(
    path.join(evidence, 'teachshell-schedule-drag-e2e.json'),
    JSON.stringify({ platform: process.platform, steps, errors }, null, 2),
  );
  console.log(`PASS ${steps.length} schedule drag acceptance checks`);
} catch (error) {
  await page
    ?.screenshot({ path: path.join(evidence, 'teachshell-timetable-drag-failure.png') })
    .catch(() => {});
  await fs.writeFile(
    path.join(evidence, 'teachshell-schedule-drag-e2e.json'),
    JSON.stringify({ steps, errors, error: String(error) }, null, 2),
  );
  throw error;
} finally {
  await app?.close().catch(() => {});
  await fs.rm(root, { recursive: true, force: true });
}
