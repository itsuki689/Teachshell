/** Browser plugin not available: real Electron, temporary library, public preload APIs. */
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
const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'teachshell-ui-parity-')));
const evidence = process.env.TEACHSHELF_SCREENSHOT_DIR ?? os.tmpdir();
await fs.mkdir(evidence, { recursive: true });
const otherRoot = path.join(root, 'OtherLibrary');
const other = await Repository.open(otherRoot, { create: true });
await other.close();
const steps = [],
  errors = [],
  warnings = [];
let app, page, originalRoot, originalWorkspaceID, courseA, courseB;
const snapshot = () => page.evaluate(() => window.teachshelf.snapshot());
const rows = () => page.locator('.materials-table tbody tr[data-browser-id]');
const selected = () => page.locator('.materials-table tr[aria-selected="true"]');
const sidebarCourse = (name) =>
  page
    .locator('.course-list')
    .getByRole('button')
    .filter({ has: page.getByText(name, { exact: true }) });
async function until(read, predicate, message = 'UI state did not settle') {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const value = await read();
    if (predicate(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(message);
}
async function check(name, fn) {
  const start = Date.now();
  await fn();
  steps.push({ name, status: 'passed', durationMs: Date.now() - start });
  console.log('PASS', name);
}
async function dialogFiles(files) {
  await app.evaluate(({ dialog }, files) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: files });
  }, files);
}
async function launch() {
  app = await _electron.launch({
    executablePath: executable ?? electronPath,
    args: executable ? [] : [desktop],
    cwd: desktop,
    env: { ...process.env, TEACHSHELF_TEST_ROOT: root },
    timeout: 30000,
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
    if (message.type() === 'warning') warnings.push(message.text());
  });
  await page.waitForSelector('.app-body');
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setBounds({ width: 1260, height: 800 }),
  );
}
async function goPlans() {
  await page.locator('.paired-nav').getByRole('button', { name: '计划', exact: true }).click();
}
async function switchLibrary(target) {
  await dialogFiles([target]);
  await page.evaluate(() => window.teachshelf.openLibrary());
  await until(snapshot, (value) => value.root === target);
  await until(
    () => page.locator('.workspace-header h1:visible').innerText(),
    (value) => value === '全部资料',
  );
}
async function assertActive(label) {
  assert.match(
    await page.getByRole('button', { name: label, exact: true }).getAttribute('class'),
    /active/,
  );
}
try {
  await launch();
  await check(
    'Shared semester filtering applies to all materials, favorites and unassigned files',
    async () => {
      assert.match(page.url(), /^file:.*\/dist\/index.html$/);
      assert.match(await page.title(), /Teachshell|课屿/);
      assert.equal(await page.locator('vite-error-overlay').count(), 0);
      const initial = await snapshot();
      originalRoot = initial.root;
      originalWorkspaceID = initial.workspaceID;
      [courseA, courseB] = await page.evaluate(async () => {
        const a = window.teachshelf;
        await a.createCourse({ name: '高等数学', semester: '2026 秋季' });
        await a.createCourse({ name: '程序设计', semester: '2026 春季' });
        return (await a.snapshot()).state.courses;
      });
      for (const [course, count] of [
        [courseA, 3],
        [courseB, 2],
        [undefined, 1],
      ]) {
        const files = [];
        for (let i = 1; i <= count; i++) {
          const name = `${course?.name ?? '个人资料'}-第${i}讲函数极限.txt`,
            file = path.join(root, name);
          await fs.writeFile(file, `${name}\n`);
          files.push(file);
        }
        await dialogFiles(files);
        await page.evaluate(
          (id) => window.teachshelf.importFiles({ courseID: id, category: '课件', copy: true }),
          course?.id,
        );
      }
      await page.evaluate(async () => {
        for (const m of (await window.teachshelf.snapshot()).state.materials)
          await window.teachshelf.updateMaterial(m.id, { tags: '期末复习', isFavorite: true });
      });
      await until(
        () => rows().count(),
        (count) => count === 6,
      );
      await page.getByLabel('学期', { exact: true }).selectOption('2026 秋季');
      assert.equal(await page.locator('.course-row').count(), 1);
      await until(
        () => rows().count(),
        (count) => count === 3,
      );
      await page.getByRole('button', { name: '我的收藏', exact: true }).first().click();
      await until(
        () => rows().count(),
        (count) => count === 3,
      );
      await page.getByRole('button', { name: '未分类', exact: true }).first().click();
      assert.equal(await rows().count(), 0);
      await page.getByLabel('学期', { exact: true }).selectOption('');
      await until(
        () => rows().count(),
        (count) => count === 1,
      );
      await sidebarCourse(courseA.name).click();
    },
  );
  await check(
    'Material search uses case-insensitive AND words across fields and Unicode whitespace',
    async () => {
      const search = page.getByLabel('搜索资料', { exact: true });
      await search.fill('极限　复习');
      await until(
        () => rows().count(),
        (count) => count === 3,
      );
      await search.fill('复习 极限 TXT');
      assert.equal(await rows().count(), 3);
      await search.fill('极限 不存在');
      await page.getByText('没有匹配的资料', { exact: true }).waitFor();
      await search.fill('');
    },
  );
  await check(
    'List keyboard selection follows focus, extends and shrinks a stable Shift range, and protects editors',
    async () => {
      await page.evaluate(
        (id) => window.teachshelf.updateCourse(id, { materialSort: 'name' }),
        courseA.id,
      );
      await sidebarCourse(courseB.name).click();
      await sidebarCourse(courseA.name).click();
      const ids = await rows().evaluateAll((elements) => elements.map((e) => e.dataset.browserId));
      await rows().first().click();
      await page.keyboard.press('ArrowDown');
      await until(
        () => selected().first().getAttribute('data-browser-id'),
        (id) => id === ids[1],
      );
      await page.keyboard.press('Shift+ArrowDown');
      await until(
        () => selected().count(),
        (count) => count === 2,
      );
      await page.keyboard.press('Shift+ArrowUp');
      await until(
        () => selected().count(),
        (count) => count === 1,
      );
      assert.equal(await selected().getAttribute('data-browser-id'), ids[1]);
      await page.keyboard.press('ArrowUp');
      await until(
        () => selected().getAttribute('data-browser-id'),
        (id) => id === ids[0],
      );
      await page.keyboard.press('ArrowUp');
      assert.equal(await selected().getAttribute('data-browser-id'), ids[0]);
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
      await until(
        () => selected().count(),
        (count) => count === 3,
      );
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
      assert.equal(await selected().count(), 3);
      await rows().first().click();
      const notes = page.locator('.inspector').getByLabel('备注', { exact: true });
      await notes.fill('保留未保存草稿');
      await page.keyboard.press('ArrowDown');
      assert.equal(await selected().getAttribute('data-browser-id'), ids[0]);
      await rows().first().focus();
      await page.keyboard.press('ArrowDown');
      const confirm = page.getByRole('dialog', { name: '丢弃未保存的资料修改？', exact: true });
      await confirm.waitFor();
      await confirm.getByRole('button', { name: '取消', exact: true }).click();
      assert.equal(await selected().getAttribute('data-browser-id'), ids[0]);
      assert.equal(await notes.inputValue(), '保留未保存草稿');
      await page.getByRole('button', { name: '取消选择', exact: true }).click();
      await confirm.waitFor();
      await confirm.getByRole('button', { name: '丢弃修改', exact: true }).click();
      await until(
        () => selected().count(),
        (count) => count === 0,
      );
      await page.evaluate(
        (id) => window.teachshelf.createFolder({ courseID: id, name: '章节资料' }),
        courseA.id,
      );
      await rows().first().focus();
      await page.keyboard.press('Enter');
      await page.getByRole('button', { name: '章节资料', exact: true }).waitFor();
      await page.getByRole('button', { name: '后退', exact: true }).click();
    },
  );
  await check(
    'Pointer selection asks once before abandoning drafts; normal first-drag selection still moves files',
    async () => {
      const value = await snapshot();
      const materials = value.state.materials.filter(
        (m) => m.courseID === courseA.id && !m.folderID,
      );
      const first = page.locator(`tr[data-browser-id="${materials[0].id}"]`);
      const second = page.locator(`tr[data-browser-id="${materials[1].id}"]`);
      await first.click();
      const notes = page.locator('.inspector').getByLabel('备注', { exact: true });
      await notes.fill('拖动前保留草稿');
      await second.click();
      const confirm = page.getByRole('dialog', { name: '丢弃未保存的资料修改？', exact: true });
      await confirm.waitFor();
      assert.equal(await confirm.count(), 1);
      await confirm.getByRole('button', { name: '取消', exact: true }).click();
      assert.equal(await selected().getAttribute('data-browser-id'), materials[0].id);
      assert.equal(await notes.inputValue(), '拖动前保留草稿');
      const checkbox = second.locator('input[type="checkbox"]');
      await checkbox.click();
      await confirm.waitFor();
      await confirm.getByRole('button', { name: '取消', exact: true }).click();
      assert.equal(await checkbox.isChecked(), false);
      assert.equal(await second.getAttribute('aria-selected'), 'false');
      const all = page.getByRole('checkbox', { name: '选择全部资料', exact: true });
      await all.click();
      await confirm.waitFor();
      await confirm.getByRole('button', { name: '取消', exact: true }).click();
      assert.equal(await all.isChecked(), false);
      assert.equal(await selected().count(), 1);

      const sourceBox = await second.boundingBox(),
        targetBox = await sidebarCourse(courseB.name).boundingBox();
      await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, {
        steps: 8,
      });
      await page.mouse.up();
      await confirm.waitFor();
      assert.equal(await confirm.count(), 1);
      await confirm.getByRole('button', { name: '取消', exact: true }).click();
      assert.equal(
        (await snapshot()).state.materials.find((m) => m.id === materials[1].id).courseID,
        courseA.id,
      );
      assert.equal(await notes.inputValue(), '拖动前保留草稿');
      await page.getByRole('button', { name: '取消选择', exact: true }).click();
      await confirm.getByRole('button', { name: '丢弃修改', exact: true }).click();
      await second.dragTo(sidebarCourse(courseB.name));
      await until(
        snapshot,
        (s) => s.state.materials.find((m) => m.id === materials[1].id).courseID === courseB.id,
      );
      await page.evaluate(({ id, courseID }) => window.teachshelf.moveMaterials([id], courseID), {
        id: materials[1].id,
        courseID: courseA.id,
      });
    },
  );
  await check(
    'Cover preference survives course navigation, back navigation and ordinary snapshots',
    async () => {
      await page.getByRole('button', { name: '封面视图', exact: true }).click();
      await assertActive('封面视图');
      await sidebarCourse(courseB.name).click();
      await assertActive('封面视图');
      await page.getByRole('button', { name: '后退', exact: true }).click();
      await assertActive('封面视图');
      await page.evaluate(
        (id) => window.teachshelf.updateCourse(id, { teacher: '同步更新教师' }),
        courseA.id,
      );
      await assertActive('封面视图');
    },
  );
  await check(
    'Month selection and timetable week share a civil date and survive page navigation',
    async () => {
      await page.evaluate(async (courseID) => {
        const startsAt = (Date.parse('2026-09-16T10:00:00+08:00') - 978307200000) / 1000;
        await window.teachshelf.savePlan({
          title: '日期同步计划',
          courseID,
          startsAt,
          endsAt: startsAt + 3600,
          isAllDay: false,
          hasExecutionTime: true,
          showInMonth: true,
        });
      }, courseA.id);
      await goPlans();
      await page.getByRole('button', { name: '计划月历视图', exact: true }).click();
      await page.getByLabel('月历月份', { exact: true }).fill('2026-09');
      await page.getByLabel('选择日期 2026-09-16', { exact: true }).click();
      await sidebarCourse(courseA.name).click();
      await goPlans();
      await assertActive('计划月历视图');
      assert.equal(await page.getByLabel('月历月份', { exact: true }).inputValue(), '2026-09');
      assert.match(await page.getByLabel('选中日期安排', { exact: true }).innerText(), /9月16日/);
      await dialogFiles([path.join(desktop, '../Resources/Timetable/Sample-undergraduate.json')]);
      const imported = await page.evaluate(() => window.teachshelf.importTimetable());
      await page.evaluate(
        (termID) =>
          window.teachshelf.saveTimetableSettings(termID, {
            weekOneMonday: (Date.parse('2026-09-07T00:00:00+08:00') - 978307200000) / 1000,
            weekCount: 16,
            sectionTimes: [
              { section: 1, startMinute: 480, endMinute: 530 },
              { section: 2, startMinute: 540, endMinute: 590 },
            ],
          }),
        imported.summary.termID,
      );
      await page.getByRole('button', { name: '查看课表', exact: true }).click();
      assert.equal(await page.getByLabel('课表周次', { exact: true }).inputValue(), '2');
      await page.getByRole('button', { name: '课表时间网格', exact: true }).click();
      await page.getByLabel('课表周次', { exact: true }).fill('4');
      await sidebarCourse(courseA.name).click();
      await goPlans();
      assert.match(await page.getByLabel('选中日期安排', { exact: true }).innerText(), /9月30日/);
      await page.getByRole('button', { name: '查看课表', exact: true }).click();
      await assertActive('课表时间网格');
      assert.equal(await page.getByLabel('课表周次', { exact: true }).inputValue(), '4');
      await page.evaluate(() => window.teachshelf.sync());
      assert.equal(await page.getByLabel('课表周次', { exact: true }).inputValue(), '4');
    },
  );
  await check(
    'Minimum and normal windows retain readable controls in light and dark modes',
    async () => {
      for (const [width, height, theme] of [
        [1260, 800, 'light'],
        [1020, 680, 'dark'],
      ]) {
        await app.evaluate(
          ({ BrowserWindow }, bounds) => BrowserWindow.getAllWindows()[0].setBounds(bounds),
          { width, height },
        );
        await page.keyboard.press(process.platform === 'darwin' ? 'Meta+,' : 'Control+,');
        await page.getByRole('tab', { name: '外观', exact: true }).click();
        await page
          .getByRole('button', {
            name: (theme === 'dark' ? '深色' : '浅色') + '显示模式',
            exact: true,
          })
          .click();
        await sidebarCourse(courseA.name).click();
        await page.getByRole('button', { name: '列表视图', exact: true }).click();
        await page.locator('.materials-table tbody tr[data-browser-id]').last().click();
        await page.screenshot({
          path: path.join(evidence, `teachshell-ui-parity-library-${theme}.png`),
        });
        assert.deepEqual(
          await page.evaluate(() => [
            innerWidth,
            innerHeight,
            document.documentElement.scrollWidth,
            document.documentElement.scrollHeight,
          ]),
          [width, height, width, height],
        );
        await goPlans();
        await page.screenshot({
          path: path.join(evidence, `teachshell-ui-parity-calendar-${theme}.png`),
        });
        await page.getByRole('button', { name: '查看课表', exact: true }).click();
        await page.screenshot({
          path: path.join(evidence, `teachshell-ui-parity-timetable-${theme}.png`),
        });
        assert.deepEqual(
          await page.evaluate(() => [
            document.documentElement.scrollWidth,
            document.documentElement.scrollHeight,
          ]),
          [width, height],
        );
      }
    },
  );
  await check(
    'New workspace identities reset dates and semester, while safe display preferences survive switching and restart',
    async () => {
      await sidebarCourse(courseA.name).click();
      await page.getByRole('button', { name: '封面视图', exact: true }).click();
      await page.getByLabel('学期', { exact: true }).selectOption('2026 秋季');
      await switchLibrary(otherRoot);
      assert.notEqual((await snapshot()).workspaceID, originalWorkspaceID);
      assert.equal(await page.getByLabel('学期', { exact: true }).inputValue(), '');
      await assertActive('封面视图');
      await goPlans();
      await assertActive('计划月历视图');
      const today = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());
      assert.equal(
        await page.getByLabel('月历月份', { exact: true }).inputValue(),
        today.slice(0, 7),
      );
      await switchLibrary(originalRoot);
      assert.notEqual((await snapshot()).workspaceID, originalWorkspaceID);
      assert.equal(await page.getByLabel('学期', { exact: true }).inputValue(), '');
      await goPlans();
      assert.equal(
        await page.getByLabel('月历月份', { exact: true }).inputValue(),
        today.slice(0, 7),
      );
      const preferences = await page.evaluate(() =>
        JSON.parse(localStorage.getItem('teachshell.display-preferences.v1')),
      );
      assert.deepEqual(preferences, {
        libraryLayout: 'grid',
        planMode: 'month',
        timetableMode: 'timeline',
      });
      await app.close();
      await launch();
      await assertActive('封面视图');
      await goPlans();
      await assertActive('计划月历视图');
      await page.getByRole('button', { name: '查看课表', exact: true }).click();
      await assertActive('课表时间网格');
      assert.deepEqual(errors, []);
    },
  );
  console.log(`PASS ${steps.length} native UI parity checks`);
} catch (error) {
  steps.push({ status: 'failed', error: String(error), stack: error.stack });
  await page
    ?.screenshot({ path: path.join(evidence, 'teachshell-ui-parity-failure.png') })
    .catch(() => {});
  throw error;
} finally {
  await fs.writeFile(
    path.join(evidence, 'teachshell-ui-parity-e2e.json'),
    JSON.stringify(
      {
        browser: 'Browser plugin not available; Playwright Electron',
        executable: executable ?? electronPath,
        steps,
        errors,
        warnings,
      },
      null,
      2,
    ),
  );
  if (page && !page.isClosed()) {
    await page.mouse.up().catch(() => {});
    const confirmation = page.getByRole('dialog', { name: '丢弃未保存的资料修改？', exact: true });
    if (await confirmation.count())
      await confirmation
        .getByRole('button', { name: '丢弃修改', exact: true })
        .click()
        .catch(() => {});
    const reset = page.locator('.inspector').getByRole('button', { name: '还原', exact: true });
    if (await reset.count()) await reset.click().catch(() => {});
  }
  await app?.close();
  await fs.rm(root, { recursive: true, force: true });
}
