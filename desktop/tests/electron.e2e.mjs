/** Runs the real packaged renderer, preload and main process against an isolated temporary library. */
import { _electron } from 'playwright';
import electronPath from 'electron';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packagedExecutable = process.env.TEACHSHELF_EXECUTABLE;
if (packagedExecutable && !path.isAbsolute(packagedExecutable))
  throw new Error('TEACHSHELF_EXECUTABLE must be an absolute executable path');
const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'teachshelf-e2e-')));
const evidence =
  process.env.TEACHSHELF_SCREENSHOT_DIR ?? (process.platform === 'win32' ? os.tmpdir() : '/tmp');
await fs.mkdir(evidence, { recursive: true });
const source = path.join(root, '课堂笔记.txt'),
  source2 = path.join(root, '第02讲.txt');
const content = '课屿 Electron UI 验证\nUnicode：课程、资料与计划。\n';
await fs.writeFile(source, content);
await fs.writeFile(source2, '第 02 讲\n');
let app, page;
const steps = [],
  errors = [];
async function launch() {
  app = await _electron.launch({
    executablePath: packagedExecutable ?? electronPath,
    args: packagedExecutable ? [] : [desktop],
    cwd: desktop,
    env: { ...process.env, TEACHSHELF_TEST_ROOT: root },
    timeout: 30000,
  });
  page = await app.firstWindow();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.waitForSelector('.app-body', { timeout: 30000 });
  await page.waitForFunction(() => !!window.teachshelf);
}
async function check(name, fn) {
  const start = Date.now();
  await fn();
  steps.push({ name, status: 'passed', durationMs: Date.now() - start });
  console.log('PASS', name);
}
async function snapshot() {
  return page.evaluate(() => window.teachshelf.snapshot());
}
// Avoid eval in the renderer: polling is performed here in the test process.
async function until(predicate) {
  const end = Date.now() + 15000;
  while (Date.now() < end) {
    const value = await snapshot();
    if (predicate(value.state)) return value;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Timed out waiting for committed library state');
}
async function createCourse(name) {
  await page.locator('.sidebar').getByRole('button', { name: '新建课程', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新建课程' });
  await dialog.getByLabel('课程名称').fill(name);
  await dialog.getByLabel('学期', { exact: true }).fill('2026 秋季');
  await dialog.getByLabel('教师', { exact: true }).fill('测试教师');
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  return (await until((s) => s.courses.some((c) => c.name === name))).state.courses.find(
    (c) => c.name === name,
  );
}
let first, second, materialID, websiteTaskID, websiteConnectionID;
try {
  await launch();
  await check('Real Electron window renders empty library with sandboxed renderer', async () => {
    assert.match(await page.title(), /课屿|Teachshelf|Teachshell/);
    await page.getByText('这里还没有资料', { exact: true }).waitFor();
    assert.deepEqual(
      await page.evaluate(() => ({
        require: typeof window.require,
        process: typeof window.process,
        Buffer: typeof window.Buffer,
        api: typeof window.teachshelf.snapshot,
      })),
      { require: 'undefined', process: 'undefined', Buffer: 'undefined', api: 'function' },
    );
    const secure = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences(),
    );
    assert.equal(secure.contextIsolation, true);
    assert.equal(secure.sandbox, true);
    assert.equal(secure.nodeIntegration, false);
    await page.screenshot({ path: path.join(evidence, 'teachshelf-electron-empty.png') });
  });
  await check('Create two courses through visible forms', async () => {
    first = await createCourse('迁移测试：计算机导论');
    second = await createCourse('资料接收课程');
    assert.equal((await snapshot()).state.courses.length, 2);
    await page
      .locator('.course-list')
      .getByRole('button', { name: /迁移测试：计算机导论/ })
      .click();
  });
  await check(
    'Native file dialog imports real Unicode files without changing originals',
    async () => {
      await app.evaluate(
        ({ dialog }, paths) => {
          dialog.showOpenDialog = async () => ({ canceled: false, filePaths: paths });
        },
        [source, source2],
      );
      await page
        .locator('.titlebar-actions')
        .getByRole('button', { name: '导入资料', exact: true })
        .click();
      const dialog = page.getByRole('dialog', { name: '导入资料' });
      await dialog.getByRole('button', { name: '选择文件…', exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
      const s = await until((s) => s.materials.length === 2);
      const material = s.state.materials.find((m) => m.originalName === '课堂笔记.txt');
      assert.ok(material);
      materialID = material.id;
      assert.equal(material.courseID, first.id);
      assert.equal(await fs.readFile(source, 'utf8'), content);
      assert.equal(await fs.readFile(path.join(s.root, material.storedPath), 'utf8'), content);
      await page
        .getByRole('table', { name: '资料列表' })
        .getByText('课堂笔记', { exact: true })
        .waitFor();
    },
  );
  await check('Create physical folder and rename material through inspector', async () => {
    await page.getByRole('button', { name: '新建文件夹', exact: true }).click();
    const fd = page.getByRole('dialog', { name: '新建文件夹' });
    await fd.getByLabel('名称', { exact: true }).fill('复习资料');
    await fd.getByRole('button', { name: '保存', exact: true }).click();
    await fd.waitFor({ state: 'hidden' });
    await page.getByRole('table').getByText('课堂笔记', { exact: true }).click();
    const inspector = page.locator('.inspector');
    await inspector.getByLabel('实际文件名').fill('重命名笔记.txt');
    await inspector.getByLabel('备注', { exact: true }).fill('保存后重启仍需保留。');
    await inspector.getByRole('button', { name: '保存', exact: true }).click();
    const s = await until((s) =>
      s.materials.some((m) => m.id === materialID && m.originalName === '重命名笔记.txt'),
    );
    assert.equal(
      await fs.readFile(
        path.join(s.root, s.state.materials.find((m) => m.id === materialID).storedPath),
        'utf8',
      ),
      content,
    );
    assert.ok(s.state.materialFolders.some((f) => f.name === '复习资料'));
  });
  await check('Favorite, search and cross-course move update real index', async () => {
    await page.locator('.inspector').getByRole('button', { name: '收藏', exact: true }).click();
    await until((s) => s.materials.find((m) => m.id === materialID)?.isFavorite);
    await page.getByLabel('搜索资料', { exact: true }).fill('课堂笔记');
    assert.equal(await page.locator('.materials-table tbody tr').count(), 1);
    await page.getByRole('button', { name: '清除搜索', exact: true }).click();
    await page.getByRole('button', { name: '移动到…', exact: true }).click();
    const md = page.getByRole('dialog', { name: '移动资料' });
    await md.getByLabel('目标课程', { exact: true }).selectOption(second.id);
    await md.getByRole('button', { name: '移动', exact: true }).click();
    await md.waitFor({ state: 'hidden' });
    await until((s) => s.materials.find((m) => m.id === materialID)?.courseID === second.id);
    await page
      .locator('.course-list')
      .getByRole('button', { name: /资料接收课程/ })
      .click();
    await page.getByRole('table').getByText('课堂笔记', { exact: true }).click();
  });
  await check(
    'External file rename is reconciled by the live watcher without losing IDs or notes',
    async () => {
      const s = await snapshot(),
        m = s.state.materials.find((m) => m.id === materialID);
      const from = path.join(s.root, m.storedPath),
        to = path.join(path.dirname(from), '外部移动后的笔记.txt');
      await fs.rename(from, to);
      const after = await until(
        (s) =>
          s.materials.find((m) => m.id === materialID)?.originalName === '外部移动后的笔记.txt',
      );
      const changed = after.state.materials.find((m) => m.id === materialID);
      assert.equal(changed.notes, '保存后重启仍需保留。');
      assert.equal(changed.isFavorite, true);
      assert.equal(await fs.readFile(path.join(after.root, changed.storedPath), 'utf8'), content);
      await page.screenshot({ path: path.join(evidence, 'teachshelf-electron-library.png') });
    },
  );
  await check(
    'Inspector preserves concurrent edits and rejects stale changes to the same field',
    async () => {
      const inspector = page.locator('.inspector');
      await inspector.getByLabel('显示标题', { exact: true }).fill('只修改标题');
      await page.evaluate(
        ({ id }) => window.teachshelf.updateMaterial(id, { notes: '另一客户端更新的备注' }),
        { id: materialID },
      );
      await inspector.getByRole('button', { name: '保存', exact: true }).click();
      await until((s) =>
        s.materials.some(
          (m) =>
            m.id === materialID && m.title === '只修改标题' && m.notes === '另一客户端更新的备注',
        ),
      );
      await inspector.getByLabel('显示标题', { exact: true }).fill('不应覆盖并发标题');
      await page.evaluate(
        ({ id }) => window.teachshelf.updateMaterial(id, { title: '其他客户端标题' }),
        { id: materialID },
      );
      await inspector.getByRole('button', { name: '保存', exact: true }).click();
      await page.getByRole('alert').waitFor();
      assert.equal(
        (await snapshot()).state.materials.find((m) => m.id === materialID).title,
        '其他客户端标题',
      );
      await inspector.getByRole('button', { name: '还原', exact: true }).click();
      await page.getByRole('button', { name: '关闭错误提示', exact: true }).click();
      await inspector.getByLabel('显示标题', { exact: true }).fill('课堂笔记');
      await inspector.getByLabel('备注', { exact: true }).fill('保存后重启仍需保留。');
      await inspector.getByRole('button', { name: '保存', exact: true }).click();
      await until((s) =>
        s.materials.some(
          (m) =>
            m.id === materialID && m.title === '课堂笔记' && m.notes === '保存后重启仍需保留。',
        ),
      );
    },
  );
  await check('Sandboxed text preview displays actual managed file bytes', async () => {
    await page.locator('.inspector').getByRole('button', { name: '预览', exact: true }).click();
    const preview = page.getByRole('dialog', { name: '外部移动后的笔记.txt' });
    await preview.waitFor();
    await page
      .frameLocator('.preview-stage iframe')
      .getByText('课屿 Electron UI 验证', { exact: false })
      .waitFor();
    assert.match(
      await page.frameLocator('.preview-stage iframe').locator('body').innerText(),
      /Unicode：课程、资料与计划/,
    );
    await preview.getByRole('button', { name: '关闭', exact: true }).click();
  });
  await check(
    'Export selected material copies preserves destination collisions and original library files',
    async () => {
      const destination = path.join(root, 'exported-copies');
      await fs.mkdir(destination);
      const existing = path.join(destination, '外部移动后的笔记.txt');
      await fs.writeFile(existing, '既有目标文件，不得覆盖。');
      const before = await snapshot();
      await app.evaluate(({ dialog }, folder) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
      }, destination);
      await page.getByRole('button', { name: '全部资料', exact: true }).click();
      await page.getByLabel('选择全部资料', { exact: true }).check();
      async function exportAndWait(count) {
        await page.getByRole('button', { name: '导出副本…', exact: true }).click();
        const deadline = Date.now() + 15000;
        while (Date.now() < deadline) {
          const names = await fs.readdir(destination);
          if (names.length === count && !names.some((n) => n.startsWith('.teachshelf-export-')))
            return;
          await new Promise((r) => setTimeout(r, 100));
        }
        throw new Error('Exported files did not finish');
      }
      await exportAndWait(3);
      await exportAndWait(5);
      assert.equal(await fs.readFile(existing, 'utf8'), '既有目标文件，不得覆盖。');
      assert.equal(
        await fs.readFile(path.join(destination, '外部移动后的笔记 2.txt'), 'utf8'),
        content,
      );
      assert.equal(
        await fs.readFile(path.join(destination, '外部移动后的笔记 3.txt'), 'utf8'),
        content,
      );
      assert.equal(await fs.readFile(path.join(destination, '第02讲.txt'), 'utf8'), '第 02 讲\n');
      assert.equal(await fs.readFile(path.join(destination, '第02讲 2.txt'), 'utf8'), '第 02 讲\n');
      const after = await snapshot();
      assert.deepEqual(after.state.materials, before.state.materials);
      assert.equal(await fs.readFile(source, 'utf8'), content);
      assert.equal(
        await fs.readFile(
          path.join(after.root, after.state.materials.find((m) => m.id === materialID).storedPath),
          'utf8',
        ),
        content,
      );
    },
  );
  await check('Create plan and mark completed through visible controls', async () => {
    await page.locator('.paired-nav').getByRole('button', { name: '计划', exact: true }).click();
    await page.getByRole('button', { name: '新建计划', exact: true }).first().click();
    const pd = page.getByRole('dialog', { name: '新建计划' });
    await pd.getByLabel('计划名称', { exact: true }).fill('UI兼容计划');
    await pd.getByLabel('内容', { exact: true }).fill('验证执行时间和完成状态的持久化。');
    await pd.getByLabel('课程', { exact: true }).selectOption(second.id);
    await pd.getByRole('button', { name: '保存', exact: true }).click();
    await pd.waitFor({ state: 'hidden' });
    await until((s) => s.tasks.some((t) => t.title === 'UI兼容计划'));
    await page.getByRole('button', { name: '完成计划 UI兼容计划', exact: true }).click();
    await until((s) =>
      s.tasks.some((t) => t.title === 'UI兼容计划' && t.completedAt !== undefined),
    );
  });
  await check(
    'Plan editor rejects a stale draft after a concurrent commit and saves after reopening',
    async () => {
      const task = (await snapshot()).state.tasks.find((t) => t.title === 'UI兼容计划');
      await page.getByRole('button', { name: '编辑计划 UI兼容计划', exact: true }).click();
      const editor = page.getByRole('dialog', { name: '编辑计划' });
      await editor.getByLabel('计划名称', { exact: true }).fill('不能覆盖后台的草稿');
      await editor.getByLabel('内容', { exact: true }).fill('未提交的旧表单草稿');
      await page.evaluate(async (id) => {
        const latest = await window.teachshelf.snapshot();
        return window.teachshelf.savePlan(
          { id, title: '后台已提交计划', content: '后台已提交内容' },
          'all',
          undefined,
          latest.revision,
        );
      }, task.id);
      await editor.getByRole('button', { name: '保存', exact: true }).click();
      await page.getByRole('alert').waitFor();
      assert.match(await page.getByRole('alert').innerText(), /变化|修改|重新|关闭/);
      const committed = (await snapshot()).state.tasks.find((t) => t.id === task.id);
      assert.equal(committed.title, '后台已提交计划');
      assert.equal(committed.content, '后台已提交内容');
      assert.equal(
        await editor.getByLabel('计划名称', { exact: true }).inputValue(),
        '不能覆盖后台的草稿',
      );
      await page.getByRole('button', { name: '关闭错误提示', exact: true }).click();
      await editor.getByRole('button', { name: '取消', exact: true }).click();
      await page.getByRole('button', { name: '编辑计划 后台已提交计划', exact: true }).click();
      const reopened = page.getByRole('dialog', { name: '编辑计划' });
      assert.equal(
        await reopened.getByLabel('内容', { exact: true }).inputValue(),
        '后台已提交内容',
      );
      await reopened.getByLabel('计划名称', { exact: true }).fill('UI兼容计划');
      await reopened.getByLabel('内容', { exact: true }).fill('重新读取后保存成功');
      await reopened.getByRole('button', { name: '保存', exact: true }).click();
      await reopened.waitFor({ state: 'hidden' });
      const saved = await until((s) =>
        s.tasks.some(
          (t) => t.id === task.id && t.title === 'UI兼容计划' && t.content === '重新读取后保存成功',
        ),
      );
      assert.ok(saved.state.tasks.find((t) => t.id === task.id).completedAt);
    },
  );
  await check(
    'Recurring single-occurrence edit and completion preserve the next occurrence',
    async () => {
      await page.getByRole('button', { name: '新建计划', exact: true }).first().click();
      const editor = page.getByRole('dialog', { name: '新建计划' });
      await editor.getByLabel('计划名称', { exact: true }).fill('每周复习UI');
      await editor.getByLabel('开始时间', { exact: false }).fill('2026-10-26T19:00');
      await editor.getByLabel('设置结束时间', { exact: true }).check();
      await editor.getByLabel('结束时间', { exact: true }).fill('2026-10-26T20:00');
      await editor.getByLabel('重复安排', { exact: true }).check();
      await editor.getByLabel('重复频率', { exact: true }).selectOption('weekly');
      await editor.getByLabel('重复间隔', { exact: true }).fill('1');
      await editor.getByLabel('设置重复结束日期', { exact: true }).check();
      await editor.getByLabel('重复至（含当天）', { exact: true }).fill('2026-11-30');
      await editor.getByRole('button', { name: '保存', exact: true }).click();
      await editor.waitFor({ state: 'hidden' });
      const created = await until((s) =>
        s.tasks.some((t) => t.title === '每周复习UI' && t.repeatRule?.frequency === 'weekly'),
      );
      const recurringID = created.state.tasks.find((t) => t.title === '每周复习UI').id;
      await page.getByRole('button', { name: '计划日程视图', exact: true }).click();
      await page.getByLabel('日程日期', { exact: true }).fill('2026-10-26');
      await page.getByRole('button', { name: '编辑计划 每周复习UI', exact: true }).click();
      const occurrenceEditor = page.getByRole('dialog', { name: '编辑计划' });
      assert.equal(
        await occurrenceEditor.getByLabel('修改范围', { exact: true }).inputValue(),
        'thisOccurrence',
      );
      await occurrenceEditor.getByLabel('计划名称', { exact: true }).fill('仅本次复习UI');
      await occurrenceEditor.getByLabel('开始时间', { exact: false }).fill('2026-10-26T20:00');
      await occurrenceEditor.getByLabel('结束时间', { exact: true }).fill('2026-10-26T21:00');
      await occurrenceEditor.getByRole('button', { name: '保存', exact: true }).click();
      await occurrenceEditor.waitFor({ state: 'hidden' });
      await until((s) =>
        s.tasks
          .find((t) => t.id === recurringID)
          ?.exceptions?.some((e) => e.details?.title === '仅本次复习UI'),
      );
      assert.equal(
        (await snapshot()).state.tasks.find((t) => t.id === recurringID).title,
        '每周复习UI',
      );
      await page.getByRole('button', { name: '完成计划 仅本次复习UI', exact: true }).click();
      const complete = page.getByRole('dialog', { name: '完成计划' });
      assert.equal(
        await complete.getByLabel('作用范围', { exact: true }).inputValue(),
        'thisOccurrence',
      );
      await complete.getByRole('button', { name: '确认完成', exact: true }).click();
      await until((s) =>
        s.tasks.find((t) => t.id === recurringID)?.exceptions?.some((e) => e.completedAt != null),
      );
      await page.screenshot({ path: path.join(evidence, 'teachshelf-electron-plans.png') });
      await page.getByLabel('日程日期', { exact: true }).fill('2026-11-02');
      const nextRow = page
        .locator('.plan-row')
        .filter({ has: page.getByRole('button', { name: '编辑计划 每周复习UI', exact: true }) });
      await nextRow.waitFor();
      assert.equal((await nextRow.getAttribute('class')).includes('completed'), false);
      assert.match(await nextRow.innerText(), /19:00/);
      await nextRow.getByRole('button', { name: '取消计划 每周复习UI', exact: true }).click();
      const cancel = page.getByRole('dialog', { name: '取消计划' });
      await cancel.getByRole('button', { name: '确认取消', exact: true }).click();
      await until((s) =>
        s.tasks.find((t) => t.id === recurringID)?.exceptions?.some((e) => e.cancelledAt != null),
      );
      await page.getByRole('button', { name: '计划列表视图', exact: true }).click();
      await page.getByRole('button', { name: '查看临时变更 每周复习UI', exact: true }).click();
      const history = page.getByRole('dialog', { name: '计划临时变更' });
      await history.getByRole('button', { name: '恢复本次安排', exact: true }).click();
      await page
        .getByRole('dialog', { name: '恢复计划' })
        .getByRole('button', { name: '恢复计划', exact: true })
        .click();
      await until((s) =>
        s.tasks.find((t) => t.id === recurringID)?.exceptions?.every((e) => e.cancelledAt == null),
      );
      await history.getByRole('button', { name: '关闭', exact: true }).click();
      await page.getByRole('button', { name: '计划日程视图', exact: true }).click();
      await page.getByRole('button', { name: '编辑计划 每周复习UI', exact: true }).waitFor();
      await page.getByRole('button', { name: '计划列表视图', exact: true }).click();
    },
  );
  await check(
    'Month calendar changes months, projects recurring exceptions and respects month visibility with deadlines',
    async () => {
      await page.getByRole('button', { name: '计划月历视图', exact: true }).click();
      await page.getByLabel('月历月份', { exact: true }).fill('2026-10');
      await page.getByRole('button', { name: '选择日期 2026-10-26', exact: true }).click();
      const selected = page.getByRole('complementary', { name: '选中日期安排' });
      await selected
        .getByRole('button', { name: '编辑月历计划 仅本次复习UI', exact: true })
        .waitFor();
      assert.match(await selected.innerText(), /20:00/);
      assert.match(await selected.innerText(), /已完成/);
      await page.getByRole('button', { name: '下个月', exact: true }).click();
      assert.equal(await page.getByLabel('月历月份', { exact: true }).inputValue(), '2026-11');
      await page.getByRole('button', { name: '选择日期 2026-11-02', exact: true }).click();
      await selected.getByRole('button', { name: '编辑月历计划 每周复习UI', exact: true }).click();
      const edit = page.getByRole('dialog', { name: '编辑计划' });
      assert.equal(
        await edit.getByLabel('修改范围', { exact: true }).inputValue(),
        'thisOccurrence',
      );
      assert.equal(
        await edit.getByLabel('开始时间', { exact: false }).inputValue(),
        '2026-11-02T19:00',
      );
      await edit.getByRole('button', { name: '取消', exact: true }).click();
      await page.getByRole('button', { name: '上个月', exact: true }).click();
      assert.equal(await page.getByLabel('月历月份', { exact: true }).inputValue(), '2026-10');
      await page.getByRole('button', { name: '新建计划', exact: true }).click();
      const create = page.getByRole('dialog', { name: '新建计划' });
      await create.getByLabel('计划名称', { exact: true }).fill('仅截止进入月历UI');
      await create.getByLabel('开始时间', { exact: false }).fill('2026-11-03T14:00');
      await create.getByLabel('执行安排显示在月历', { exact: true }).uncheck();
      await create.getByLabel('设置截止时间', { exact: true }).check();
      await create.getByLabel('截止时间', { exact: true }).fill('2026-11-04T18:00');
      await create.getByRole('button', { name: '保存', exact: true }).click();
      await create.waitFor({ state: 'hidden' });
      await until((s) =>
        s.tasks.some(
          (t) => t.title === '仅截止进入月历UI' && t.showInMonth === false && t.deadline != null,
        ),
      );
      await page.getByLabel('月历月份', { exact: true }).fill('2026-11');
      assert.doesNotMatch(
        await page.getByRole('button', { name: '选择日期 2026-11-03', exact: true }).innerText(),
        /仅截止进入月历UI/,
      );
      await page.getByRole('button', { name: '选择日期 2026-11-04', exact: true }).click();
      await selected
        .getByRole('button', { name: '编辑月历计划 仅截止进入月历UI', exact: true })
        .waitFor();
      assert.match(await selected.innerText(), /18:00 截止/);
      await page.screenshot({ path: path.join(evidence, 'teachshelf-electron-month.png') });
      await page.getByRole('button', { name: '计划列表视图', exact: true }).click();
    },
  );
  await check(
    'Plan status filters include matching occurrence exceptions and cancellation recovery',
    async () => {
      await page.getByLabel('计划状态筛选', { exact: true }).selectOption('completed');
      await page.getByRole('button', { name: '编辑计划 UI兼容计划', exact: true }).waitFor();
      const recurring = page
        .locator('.plan-row')
        .filter({ has: page.getByRole('button', { name: '编辑计划 每周复习UI', exact: true }) });
      await recurring.waitFor();
      assert.match(await recurring.innerText(), /匹配单次安排/);
      assert.equal(
        await page.getByRole('button', { name: '编辑计划 仅截止进入月历UI', exact: true }).count(),
        0,
      );
      await page.getByRole('button', { name: '取消计划 UI兼容计划', exact: true }).click();
      await page
        .getByRole('dialog', { name: '取消计划' })
        .getByRole('button', { name: '确认取消', exact: true })
        .click();
      await until((s) => s.tasks.some((t) => t.title === 'UI兼容计划' && t.cancelledAt != null));
      await page.getByLabel('计划状态筛选', { exact: true }).selectOption('cancelled');
      await page.getByRole('button', { name: '恢复已取消计划 UI兼容计划', exact: true }).click();
      await page
        .getByRole('dialog', { name: '恢复计划' })
        .getByRole('button', { name: '恢复计划', exact: true })
        .click();
      await until((s) => s.tasks.some((t) => t.title === 'UI兼容计划' && t.cancelledAt == null));
      await page.getByRole('button', { name: '待完成计划', exact: true }).click();
      assert.equal(await page.getByLabel('计划状态筛选', { exact: true }).inputValue(), 'pending');
      await page.getByRole('button', { name: '编辑计划 每周复习UI', exact: true }).waitFor();
      assert.equal(
        await page.getByRole('button', { name: '编辑计划 UI兼容计划', exact: true }).count(),
        0,
      );
    },
  );
  await check(
    'Global search and navigation history resolve live records, remember folders and protect unsaved edits',
    async () => {
      await page
        .locator('.course-list')
        .getByRole('button', { name: /迁移测试：计算机导论/ })
        .click();
      await page.getByRole('button', { name: '复习资料', exact: true }).click();
      await page
        .locator('.breadcrumb-bar')
        .getByRole('button', { name: '复习资料', exact: true })
        .waitFor();
      await page
        .locator('.titlebar-actions')
        .getByRole('button', { name: '打开设置', exact: true })
        .click();
      await page.getByRole('button', { name: '后退', exact: true }).click();
      await page
        .locator('.breadcrumb-bar')
        .getByRole('button', { name: '复习资料', exact: true })
        .waitFor();
      await page.getByRole('button', { name: '后退', exact: true }).click();
      assert.equal(
        await page
          .locator('.breadcrumb-bar')
          .getByRole('button', { name: '复习资料', exact: true })
          .count(),
        0,
      );
      await page.getByRole('button', { name: '前进', exact: true }).click();
      await page
        .locator('.breadcrumb-bar')
        .getByRole('button', { name: '复习资料', exact: true })
        .waitFor();
      await page.getByRole('button', { name: '全局搜索', exact: true }).click();
      let search = page.getByRole('dialog', { name: '全局搜索' });
      await search.getByLabel('搜索课程、资料和计划', { exact: true }).fill('迁移测试 测试教师');
      await search
        .getByRole('button', { name: '打开课程 迁移测试：计算机导论', exact: true })
        .click();
      await page.getByRole('heading', { name: '迁移测试：计算机导论', exact: true }).waitFor();
      await page.getByRole('button', { name: '全局搜索', exact: true }).click();
      search = page.getByRole('dialog', { name: '全局搜索' });
      await search.getByLabel('搜索课程、资料和计划', { exact: true }).fill('资料接收 课堂笔记');
      await search.getByRole('button', { name: '打开资料 课堂笔记', exact: true }).click();
      const inspector = page.locator('.inspector');
      await inspector.waitFor();
      assert.equal(
        await inspector.getByLabel('实际文件名', { exact: false }).inputValue(),
        '外部移动后的笔记.txt',
      );
      await inspector.getByLabel('显示标题', { exact: true }).fill('导航前未保存草稿');
      await page.getByRole('button', { name: '后退', exact: true }).click();
      await page
        .getByRole('dialog', { name: '丢弃未保存的资料修改？' })
        .getByRole('button', { name: '取消', exact: true })
        .click();
      assert.equal(
        await inspector.getByLabel('显示标题', { exact: true }).inputValue(),
        '导航前未保存草稿',
      );
      await inspector.getByRole('button', { name: '还原', exact: true }).click();
      await page.getByRole('button', { name: '全局搜索', exact: true }).click();
      search = page.getByRole('dialog', { name: '全局搜索' });
      await search.getByLabel('搜索课程、资料和计划', { exact: true }).fill('UI兼容计划');
      await search.getByRole('button', { name: '打开计划 UI兼容计划', exact: true }).click();
      const editor = page.getByRole('dialog', { name: '编辑计划' });
      assert.equal(await editor.getByLabel('计划名称', { exact: true }).inputValue(), 'UI兼容计划');
      await editor.getByRole('button', { name: '取消', exact: true }).click();
    },
  );
  await check('Settings model form saves actual configuration without a test secret', async () => {
    await page
      .locator('.titlebar-actions')
      .getByRole('button', { name: '打开设置', exact: true })
      .click();
    await page.getByRole('tab', { name: 'AI 助手', exact: true }).click();
    await page.getByLabel('API 基础地址', { exact: true }).fill('http://127.0.0.1:11434/v1');
    await page.getByLabel('模型名称', { exact: true }).fill('local-test-model');
    await page.getByRole('button', { name: '保存模型设置', exact: true }).click();
    await page.waitForFunction(
      async () => (await window.teachshelf.settings()).ai.model === 'local-test-model',
    );
  });
  await check('Minimum desktop viewport and dark appearance remain usable', async () => {
    await page.getByRole('tab', { name: '外观', exact: true }).click();
    await page.getByRole('button', { name: '深色显示模式', exact: true }).click();
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
    await page.setViewportSize({ width: 1020, height: 680 });
    await page
      .locator('.course-list')
      .getByRole('button', { name: /资料接收课程/ })
      .click();
    await page.getByRole('table').getByText('课堂笔记', { exact: true }).click();
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      true,
    );
    await page.screenshot({ path: path.join(evidence, 'teachshelf-electron-minimum-dark.png') });
    await page
      .locator('.titlebar-actions')
      .getByRole('button', { name: '打开设置', exact: true })
      .click();
    await page.getByRole('tab', { name: '外观', exact: true }).click();
    await page.getByRole('button', { name: '跟随系统显示模式', exact: true }).click();
    await page.setViewportSize({ width: 1260, height: 800 });
  });
  await check(
    'Import original undergraduate JSON, configure term and cancel/restore one class',
    async () => {
      const fixture = path.resolve(desktop, '../Resources/Timetable/Sample-undergraduate.json');
      await app.evaluate(({ dialog }, file) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
      }, fixture);
      await page.locator('.paired-nav').getByRole('button', { name: '计划', exact: true }).click();
      await page.getByRole('button', { name: '查看课表', exact: true }).click();
      await page.getByRole('button', { name: '导入课表 JSON', exact: true }).first().click();
      const settings = page.getByRole('dialog', { name: '学期设置' });
      await settings.waitFor();
      await settings.getByLabel('第一周周一（北京时间）', { exact: true }).fill('2026-09-07');
      await settings.getByLabel('学期周数', { exact: true }).fill('16');
      await settings.getByLabel('第1节开始时间', { exact: true }).fill('08:00');
      await settings.getByLabel('第1节结束时间', { exact: true }).fill('08:50');
      await settings.getByLabel('第2节开始时间', { exact: true }).fill('09:00');
      await settings.getByLabel('第2节结束时间', { exact: true }).fill('09:50');
      await settings.getByRole('button', { name: '保存学期设置', exact: true }).click();
      await settings.waitFor({ state: 'hidden' });
      const saved = await until(
        (s) =>
          s.timetableTerms.length === 1 &&
          s.timetableTerms[0].weekCount === 16 &&
          s.timetableTerms[0].weekOneMonday != null,
      );
      assert.equal(saved.state.timetableTerms[0].meetings.length, 6);
      assert.equal(saved.state.courses.length, 7);
      await page.getByLabel('课表周次', { exact: true }).fill('1');
      await page.locator('.week-day').nth(0).getByText('高等数学 A', { exact: true }).waitFor();
      assert.equal(await page.locator('.timetable-event').count(), 4);
      await page.locator('.week-day').nth(0).getByText('08:00 – 09:50', { exact: true }).waitFor();
      await page
        .locator('.week-day')
        .nth(0)
        .getByRole('button', { name: '取消本次', exact: true })
        .click();
      const confirmation = page.getByRole('dialog', { name: '取消这次课程？' });
      await confirmation.getByRole('button', { name: '取消本次', exact: true }).click();
      await until((s) => s.timetableTerms[0].cancellations.length === 1);
      assert.equal(await page.locator('.timetable-event').count(), 3);
      await page.getByRole('button', { name: '恢复课程', exact: true }).click();
      await until((s) => s.timetableTerms[0].cancellations.length === 0);
      assert.equal(await page.locator('.timetable-event').count(), 4);
      await page.screenshot({ path: path.join(evidence, 'teachshelf-electron-timetable.png') });
    },
  );
  await check(
    'Reschedule a real timetable occurrence to another day and restore its original slot',
    async () => {
      const monday = page.locator('.week-day').nth(0),
        tuesday = page.locator('.week-day').nth(1);
      const original = monday.locator('.timetable-event').filter({ hasText: '高等数学 A' });
      await original.getByRole('button', { name: '调整本次', exact: true }).click();
      const editor = page.getByRole('dialog', { name: '调整本次课程' });
      await editor.getByLabel('调至日期（北京时间）', { exact: true }).fill('2026-09-08');
      await editor.getByLabel('起始节次', { exact: true }).fill('3');
      await editor.getByLabel('持续节数', { exact: true }).fill('2');
      await editor.getByLabel('教室', { exact: true }).fill('调课教室 301');
      await editor.getByLabel('使用自定义时间', { exact: true }).check();
      await editor.getByLabel('上课时间', { exact: true }).fill('10:10');
      await editor.getByLabel('下课时间', { exact: true }).fill('11:50');
      await editor.getByRole('button', { name: '保存本次调整', exact: true }).click();
      await editor.waitFor({ state: 'hidden' });
      await until((s) => s.timetableTerms[0].reschedules.length === 1);
      await original.waitFor({ state: 'hidden' });
      const moved = tuesday.locator('.timetable-event').filter({ hasText: '高等数学 A' });
      await moved.waitFor();
      assert.match(await moved.innerText(), /10:10 – 11:50/);
      assert.match(await moved.innerText(), /调课教室 301/);
      await moved.getByRole('button', { name: '还原调课', exact: true }).click();
      await page
        .getByRole('dialog', { name: '还原这次调课？' })
        .getByRole('button', { name: '还原调课', exact: true })
        .click();
      await until((s) => s.timetableTerms[0].reschedules.length === 0);
      await moved.waitFor({ state: 'hidden' });
      await original.waitFor();
      assert.match(await original.innerText(), /08:00 – 09:50/);
    },
  );
  await check(
    'Timetable month visibility updates actual month projection without changing scheduled times',
    async () => {
      const original = page
        .locator('.week-day')
        .nth(0)
        .locator('.timetable-event')
        .filter({ hasText: '高等数学 A' });
      const before = (await snapshot()).state.timetableTerms[0].meetings.find(
        (m) => m.title === '高等数学 A' && m.weekday === 1,
      );
      await original.getByRole('checkbox', { name: '月历显示 高等数学 A', exact: true }).check();
      const shown = await until(
        (s) => s.timetableTerms[0].meetings.find((m) => m.id === before.id)?.showInMonth === true,
      );
      const { showInMonth, ...unchanged } = shown.state.timetableTerms[0].meetings.find(
        (m) => m.id === before.id,
      );
      const { showInMonth: oldVisibility, ...old } = before;
      assert.deepEqual(unchanged, old);
      await page.getByRole('button', { name: '计划列表', exact: true }).click();
      await page.getByRole('button', { name: '计划月历视图', exact: true }).click();
      await page.getByLabel('月历月份', { exact: true }).fill('2026-09');
      await page.getByRole('button', { name: '选择日期 2026-09-07', exact: true }).click();
      const agenda = page.getByRole('complementary', { name: '选中日期安排' });
      await agenda.getByRole('button', { name: '查看月历课程 高等数学 A', exact: true }).click();
      const details = page.getByRole('dialog', { name: '月历课程' });
      assert.match(await details.innerText(), /08:00 – 09:50/);
      await details.getByLabel('此时段显示在月历', { exact: true }).uncheck();
      await until(
        (s) => s.timetableTerms[0].meetings.find((m) => m.id === before.id)?.showInMonth === false,
      );
      await details.getByRole('button', { name: '关闭', exact: true }).last().click();
      assert.equal(
        await agenda.getByRole('button', { name: '查看月历课程 高等数学 A', exact: true }).count(),
        0,
      );
      await page.getByRole('button', { name: '查看课表', exact: true }).click();
      await page.getByLabel('课表周次', { exact: true }).fill('1');
      await original.getByRole('checkbox', { name: '月历显示 高等数学 A', exact: true }).check();
      await until(
        (s) => s.timetableTerms[0].meetings.find((m) => m.id === before.id)?.showInMonth === true,
      );
      await page.getByRole('button', { name: '计划列表', exact: true }).click();
      await page.getByRole('button', { name: '计划月历视图', exact: true }).click();
      await page.getByLabel('月历月份', { exact: true }).fill('2026-09');
      await page.getByRole('button', { name: '选择日期 2026-09-14', exact: true }).click();
      await agenda.getByRole('button', { name: '查看月历课程 高等数学 A', exact: true }).waitFor();
      await page.screenshot({ path: path.join(evidence, 'teachshelf-electron-month-course.png') });
    },
  );
  await check(
    'Homework workspace creates directories, imports and renames actual files',
    async () => {
      await page.getByRole('button', { name: '作业文件夹', exact: true }).click();
      await page.getByLabel('作业所属课程', { exact: true }).selectOption(second.id);
      await page.getByRole('button', { name: '新建文件夹', exact: true }).click();
      const folder = page.getByRole('dialog', { name: '新建作业文件夹' });
      await folder.getByLabel('名称', { exact: true }).fill('作业批次');
      await folder.getByRole('button', { name: '保存名称', exact: true }).click();
      await folder.waitFor({ state: 'hidden' });
      await page.locator('.homework-entry').filter({ hasText: '作业批次' }).click();
      await app.evaluate(({ dialog }, file) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
      }, source2);
      await page.getByRole('button', { name: '导入文件', exact: true }).click();
      await page.getByRole('button', { name: '重命名 第02讲.txt', exact: true }).click();
      const rename = page.getByRole('dialog', { name: '重命名' });
      await rename.getByLabel('名称', { exact: true }).fill('作业提交.txt');
      await rename.getByRole('button', { name: '保存名称', exact: true }).click();
      await rename.waitFor({ state: 'hidden' });
      await page.locator('.homework-entry').filter({ hasText: '作业提交.txt' }).waitFor();
      const listing = await page.evaluate(
        (id) => window.teachshelf.listHomework(id, '作业批次'),
        second.id,
      );
      const entry = listing.entries.find((e) => e.name === '作业提交.txt');
      assert.ok(entry);
      assert.equal(
        await fs.readFile(path.join(listing.root, entry.relativePath), 'utf8'),
        '第 02 讲\n',
      );
      assert.equal(await fs.readFile(source2, 'utf8'), '第 02 讲\n');
      await page.screenshot({ path: path.join(evidence, 'teachshelf-electron-homework.png') });
    },
  );
  await check(
    'Official-URL offline Moodle DOM is parsed in an isolated window and a reviewed assignment is applied',
    async () => {
      const partition =
        'teachshelf-' +
        createHash('sha256')
          .update((await snapshot()).root)
          .digest('hex')
          .slice(0, 16) +
        '-teaching';
      await app.evaluate(async ({ session }, partition) => {
        globalThis.__teachshelfWebsiteFixture = {
          account: '99',
          intro: '网站作业初始说明',
          deadline: '2099年12月20日 18:00',
        };
        await session.fromPartition(partition).protocol.handle('https', (request) => {
          const url = new URL(request.url),
            fixture = globalThis.__teachshelfWebsiteFixture;
          if (url.hostname !== 'selearning.nju.edu.cn')
            return new Response('Fixture host only', { status: 404 });
          const profile =
            '<nav class="usermenu"><a href="https://selearning.nju.edu.cn/user/profile.php?id=' +
            fixture.account +
            '">Fixture profile</a></nav>';
          const course =
            '<h1>离线验收网站课程</h1><main id="region-main"><div class="course-content"><section class="section" data-sectionid="1"><h3 class="sectionname">作业</h3><a href="https://selearning.nju.edu.cn/mod/assign/view.php?id=501"><span class="instancename">离线验收作业</span></a></section></div></main>';
          const assignment =
            '<nav class="breadcrumb"><a href="https://selearning.nju.edu.cn/course/view.php?id=42">网站课程</a></nav><main id="region-main"><h2>离线验收作业</h2><div id="intro"><p>' +
            fixture.intro +
            '</p></div><table class="generaltable"><tr><th>截止日期</th><td>' +
            fixture.deadline +
            '</td></tr><tr><th>提交状态</th><td>未提交</td></tr></table></main>';
          return new Response(
            '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Offline Moodle fixture</title><body>' +
              profile +
              (url.pathname === '/course/view.php' ? course : assignment) +
              '</body></html>',
            { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
          );
        });
      }, partition);
      await page
        .locator('.course-list')
        .getByRole('button', { name: /资料接收课程/ })
        .click();
      await page.getByRole('button', { name: '教学网站', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: '教学网站' });
      await dialog
        .getByLabel('页面地址', { exact: true })
        .fill('https://selearning.nju.edu.cn/course/view.php?id=42');
      await dialog.getByRole('button', { name: '打开登录窗口', exact: true }).click();
      await dialog.getByRole('button', { name: '读取当前页面', exact: true }).click();
      await dialog.getByLabel('绑定到本地课程', { exact: true }).selectOption(second.id);
      await dialog.getByRole('button', { name: '绑定当前网站课程', exact: true }).click();
      const bound = await until((s) => s.teachingConnections.length === 1);
      websiteConnectionID = bound.state.teachingConnections[0].id;
      assert.equal(bound.state.teachingConnections[0].accountID, '99');
      assert.equal(bound.state.teachingConnections[0].remoteCourseID, '42');
      await dialog.getByRole('button', { name: '离线验收作业', exact: true }).click();
      await dialog.getByRole('button', { name: '读取当前页面', exact: true }).click();
      const count = (await snapshot()).state.tasks.length;
      await dialog.getByRole('button', { name: '预览当前作业更新', exact: true }).click();
      await dialog.getByText('本地尚无此作业计划', { exact: true }).waitFor();
      assert.equal((await snapshot()).state.tasks.length, count);
      await dialog.locator('.assignment-review').scrollIntoViewIfNeeded();
      await page.screenshot({
        path: path.join(evidence, 'teachshelf-electron-website-review.png'),
      });
      await dialog.getByRole('button', { name: '确认应用当前作业', exact: true }).click();
      const saved = await until((s) => s.tasks.some((t) => t.title === '离线验收作业'));
      const task = saved.state.tasks.find((t) => t.title === '离线验收作业');
      websiteTaskID = task.id;
      assert.equal(task.courseID, second.id);
      assert.match(task.content, /网站作业初始说明/);
      assert.equal(
        new Date(task.deadline * 1000 + 978307200000).toISOString(),
        '2099-12-20T10:00:00.000Z',
      );
      const remote = app.windows().find((w) => w !== page);
      assert.ok(remote);
      assert.deepEqual(
        await remote.evaluate(() => ({
          require: typeof window.require,
          process: typeof window.process,
          api: typeof window.teachshelf,
        })),
        { require: 'undefined', process: 'undefined', api: 'undefined' },
      );
    },
  );
  await check(
    'Website review preserves manual notes, resolves deadline conflicts and refuses changed account application',
    async () => {
      const dialog = page.getByRole('dialog', { name: '教学网站' }),
        remote = app.windows().find((w) => w !== page);
      const manualDeadline = (Date.parse('2099-12-19T18:00:00+08:00') - 978307200000) / 1000;
      await page.evaluate(
        ({ id, deadline }) =>
          window.teachshelf.savePlan({
            id,
            title: '本地保留标题',
            content: '本地手工备注',
            deadline,
            deadlineIsAllDay: false,
          }),
        { id: websiteTaskID, deadline: manualDeadline },
      );
      async function refreshFixture(changes) {
        await app.evaluate(
          (_electron, changes) => Object.assign(globalThis.__teachshelfWebsiteFixture, changes),
          changes,
        );
        await remote.reload();
        await dialog.getByRole('button', { name: '读取当前页面', exact: true }).click();
        await dialog.getByRole('button', { name: '预览当前作业更新', exact: true }).click();
      }
      await refreshFixture({ intro: '网站更新后的说明', deadline: '2099年12月21日 18:00' });
      await dialog.getByText(/检测到截止冲突/).waitFor();
      const proposed = dialog.locator('.assignment-diff section').nth(1);
      assert.match(await proposed.innerText(), /本地保留标题/);
      assert.match(await proposed.innerText(), /本地手工备注/);
      await dialog.getByRole('button', { name: '确认应用当前作业', exact: true }).click();
      await until((s) =>
        s.teachingConnections[0].items.some(
          (i) => i.localID === websiteTaskID && i.pendingDeadline,
        ),
      );
      await dialog.locator('.website-connections>summary').click();
      await dialog.getByRole('button', { name: '保留本地截止', exact: true }).click();
      await until((s) => s.teachingConnections[0].items.every((i) => !i.pendingDeadline));
      assert.equal(
        (await snapshot()).state.tasks.find((t) => t.id === websiteTaskID).deadline,
        manualDeadline,
      );
      await refreshFixture({ deadline: '2099年12月22日 18:00' });
      await dialog.getByRole('button', { name: '确认应用当前作业', exact: true }).click();
      await until((s) => s.teachingConnections[0].items.some((i) => i.pendingDeadline));
      await dialog.getByRole('button', { name: '采用网站截止', exact: true }).click();
      const resolved = await until((s) =>
        s.teachingConnections[0].items.every((i) => !i.pendingDeadline),
      );
      const retained = resolved.state.tasks.find((t) => t.id === websiteTaskID);
      assert.equal(retained.title, '本地保留标题');
      assert.equal(retained.content, '本地手工备注');
      assert.equal(
        new Date(retained.deadline * 1000 + 978307200000).toISOString(),
        '2099-12-22T10:00:00.000Z',
      );
      await refreshFixture({ deadline: '2099年12月23日 18:00' });
      const confirmation = dialog.getByRole('button', {
        name: '确认应用当前作业',
        exact: true,
      });
      await confirmation.waitFor();
      assert.equal(await confirmation.isEnabled(), true);
      // Keep a public-API preview to verify the main-process guard as well as
      // the UI's immediate invalidation, without trying to click a disabled action.
      const rejectedPreview = await page.evaluate(async () => {
        const api = window.teachshelf;
        const observed = await api.inspectWebsite('teaching');
        const current = await api.snapshot();
        return api.previewWebsiteAssignment(
          observed.proposalID,
          current.state.teachingConnections[0].id,
        );
      });
      const before = (await snapshot()).state.tasks.find((t) => t.id === websiteTaskID);
      await app.evaluate(() => {
        globalThis.__teachshelfWebsiteFixture.account = '100';
      });
      await remote.reload();
      await dialog
        .getByText('网站账号已变化，请重新读取当前页面并预览。', { exact: true })
        .first()
        .waitFor();
      assert.equal(await confirmation.isDisabled(), true);
      const rejected = await page.evaluate(async (proposalID) => {
        try {
          await window.teachshelf.applyWebsiteAssignment(proposalID);
          return '';
        } catch (error) {
          return String(error);
        }
      }, rejectedPreview.proposalID);
      assert.match(rejected, /账号|课程|变化|不一致/);
      assert.deepEqual(
        (await snapshot()).state.tasks.find((t) => t.id === websiteTaskID),
        before,
      );
      await dialog.getByRole('button', { name: '关闭', exact: true }).click();
    },
  );
  await check(
    'Restart restores courses, renamed files, notes, favorites, timetable and completed plan',
    async () => {
      await app.close();
      app = undefined;
      await launch();
      const s = await snapshot();
      assert.equal(s.state.courses.length, 7);
      assert.equal(s.state.timetableTerms.length, 1);
      assert.equal(s.state.timetableTerms[0].weekCount, 16);
      assert.equal(s.state.timetableTerms[0].cancellations.length, 0);
      assert.equal(
        s.state.timetableTerms[0].meetings.find((m) => m.title === '高等数学 A' && m.weekday === 1)
          .showInMonth,
        true,
      );
      assert.equal(
        s.state.teachingConnections.find((c) => c.id === websiteConnectionID).accountID,
        '99',
      );
      assert.equal(s.state.tasks.find((t) => t.id === websiteTaskID).content, '本地手工备注');
      const m = s.state.materials.find((m) => m.id === materialID);
      assert.equal(m.originalName, '外部移动后的笔记.txt');
      assert.equal(m.notes, '保存后重启仍需保留。');
      assert.equal(m.isFavorite, true);
      assert.equal(m.courseID, second.id);
      assert.ok(s.state.tasks.find((t) => t.title === 'UI兼容计划').completedAt);
      assert.ok(
        s.state.tasks
          .find((t) => t.title === '每周复习UI')
          .exceptions.some((e) => e.completedAt != null),
      );
      assert.equal(
        (await page.evaluate(() => window.teachshelf.settings())).ai.model,
        'local-test-model',
      );
      assert.equal(await fs.readFile(source, 'utf8'), content);
    },
  );
  await check(
    'Copied stdio MCP configuration launches the shipped bridge against the real repository provider',
    async () => {
      const reservation = net.createServer();
      await new Promise((resolve, reject) => {
        reservation.once('error', reject);
        reservation.listen(0, '127.0.0.1', resolve);
      });
      const port = reservation.address().port;
      await new Promise((resolve, reject) =>
        reservation.close((error) => (error ? reject(error) : resolve())),
      );
      const previousClipboard = await app.evaluate(({ clipboard }) => clipboard.readText());
      let bridge;
      try {
        await page
          .locator('.titlebar-actions')
          .getByRole('button', { name: '打开设置', exact: true })
          .click();
        await page.getByRole('tab', { name: 'MCP', exact: true }).click();
        await page.getByLabel('服务端口', { exact: true }).fill(String(port));
        await page.getByRole('checkbox', { name: '启用 MCP Server', exact: true }).check();
        await page.getByRole('button', { name: '保存 MCP 设置', exact: true }).click();
        await page.waitForFunction(async (port) => {
          const value = await window.teachshelf.settings();
          return value.mcp.enabled && value.mcp.port === port;
        }, port);
        await page.evaluate(() => window.teachshelf.copyMCPConfiguration('stdio'));
        const copied = await app.evaluate(({ clipboard }) => clipboard.readText());
        const configuration = JSON.parse(copied).mcpServers.teachshelf;
        const token = (await page.evaluate(() => window.teachshelf.settings())).mcp.token;
        assert.equal(typeof token === 'string' && /^[a-f\d]{64}$/i.test(token), true);
        assert.equal(
          copied.includes(token),
          false,
          'stdio configuration must not embed the credential',
        );
        assert.equal(path.isAbsolute(configuration.command), true);
        assert.equal(path.isAbsolute(configuration.args[0]), true);
        assert.equal(path.basename(configuration.args[0]), 'mcp-stdio.cjs');
        assert.equal(configuration.args[1], '--config');
        assert.equal(path.isAbsolute(configuration.args[2]), true);
        assert.equal(configuration.env.ELECTRON_RUN_AS_NODE, '1');
        await fs.access(configuration.command);
        await fs.access(configuration.args[0]);
        const messages = [
          {
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
              protocolVersion: '2025-11-25',
              capabilities: {},
              clientInfo: { name: 'Teachshelf packaged acceptance', version: '1' },
            },
          },
          { jsonrpc: '2.0', method: 'notifications/initialized' },
          { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
          {
            jsonrpc: '2.0',
            id: 3,
            method: 'tools/call',
            params: { name: 'teachshelf_context', arguments: {} },
          },
        ];
        const output = await new Promise((resolve, reject) => {
          let stdout = '',
            stderr = '';
          bridge = spawn(configuration.command, configuration.args, {
            cwd: desktop,
            env: { ...process.env, ...configuration.env },
            shell: false,
            windowsHide: true,
            stdio: ['pipe', 'pipe', 'pipe'],
          });
          const timeout = setTimeout(() => {
            bridge.kill();
            reject(new Error('MCP stdio acceptance timed out'));
          }, 30000);
          const collect = (target) => (chunk) => {
            if (target === 'stdout') stdout += chunk.toString('utf8');
            else stderr += chunk.toString('utf8');
            if (stdout.length + stderr.length > 2_000_000) {
              bridge.kill();
              reject(new Error('MCP stdio output exceeded acceptance limit'));
            }
          };
          bridge.stdout.on('data', collect('stdout'));
          bridge.stderr.on('data', collect('stderr'));
          bridge.once('error', () => {
            clearTimeout(timeout);
            reject(new Error('Copied MCP bridge command failed to launch'));
          });
          bridge.once('close', (code) => {
            clearTimeout(timeout);
            resolve({ code, stdout, stderr });
          });
          bridge.stdin.on('error', () =>
            reject(new Error('MCP bridge closed its input unexpectedly')),
          );
          bridge.stdin.end(messages.map((message) => JSON.stringify(message)).join('\n') + '\n');
        });
        assert.equal(output.code, 0, 'MCP bridge should finish cleanly');
        assert.equal(
          (output.stdout + output.stderr).includes(token),
          false,
          'MCP output must not disclose the credential',
        );
        let responses;
        try {
          responses = output.stdout
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line));
        } catch {
          throw new Error('MCP stdio stdout must contain only JSON-RPC messages');
        }
        assert.deepEqual(
          responses.map((response) => response.id),
          [1, 2, 3],
        );
        assert.equal(responses[0].result?.serverInfo?.name, 'teachshelf');
        assert.equal(responses[0].result?.protocolVersion, '2025-11-25');
        assert.equal(responses[1].result?.tools?.length, 25);
        assert.equal(new Set(responses[1].result.tools.map((tool) => tool.name)).size, 25);
        assert.equal(responses[2].result?.isError, false);
        const actualContext = responses[2].result.structuredContent;
        assert.equal(
          actualContext.courses.some(
            (course) => course.id === first.id && course.name === first.name,
          ),
          true,
        );
        assert.equal(
          actualContext.courses.some(
            (course) => course.id === second.id && course.name === second.name,
          ),
          true,
        );
        assert.equal(actualContext.courses.length, (await snapshot()).state.courses.length);
      } finally {
        if (bridge && bridge.exitCode === null) bridge.kill();
        await page.getByRole('checkbox', { name: '启用 MCP Server', exact: true }).uncheck();
        await page.getByRole('button', { name: '保存 MCP 设置', exact: true }).click();
        await page.waitForFunction(async () => !(await window.teachshelf.settings()).mcp.enabled);
        await app.evaluate(({ clipboard }, text) => clipboard.writeText(text), previousClipboard);
      }
    },
  );
  await check(
    'Native quit keeps a dirty editor and live repository when the default decision is return to editing',
    async () => {
      await page
        .locator('.course-list')
        .getByRole('button', { name: /资料接收课程/ })
        .click();
      await page.getByRole('table').getByText('课堂笔记', { exact: true }).click();
      const inspector = page.locator('.inspector'),
        notes = '保存后重启仍需保留。\n退出保护保存验收';
      await inspector.getByLabel('备注', { exact: true }).fill(notes);
      await app.evaluate(({ app, dialog }) => {
        globalThis.__teachshelfQuitPromptCount = 0;
        const chooseDefault = (...args) => {
          const options = args.find((value) => value && Array.isArray(value.buttons));
          globalThis.__teachshelfQuitPromptCount++;
          return options.defaultId ?? options.cancelId ?? 0;
        };
        dialog.showMessageBoxSync = chooseDefault;
        dialog.showMessageBox = async (...args) => ({
          response: chooseDefault(...args),
          checkboxChecked: false,
        });
        setTimeout(() => app.quit(), 0);
      });
      const deadline = Date.now() + 15000;
      let prompted = false;
      while (Date.now() < deadline) {
        if (await app.evaluate(() => globalThis.__teachshelfQuitPromptCount > 0)) {
          prompted = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.equal(prompted, true, 'Native beforeunload prompt should be presented');
      assert.equal(page.isClosed(), false);
      assert.equal(await inspector.getByLabel('备注', { exact: true }).inputValue(), notes);
      await inspector.getByRole('button', { name: '保存', exact: true }).click();
      await until((s) => s.materials.find((m) => m.id === materialID)?.notes === notes);
      await app.close();
      app = undefined;
      await launch();
      assert.equal(
        (await snapshot()).state.materials.find((m) => m.id === materialID).notes,
        notes,
      );
    },
  );
  await check(
    'Actual teaching BrowserWindow has no preload, Node.js or local IPC bridge',
    async () => {
      await app.evaluate(({ BrowserWindow }) => {
        const original = BrowserWindow.prototype.loadURL;
        BrowserWindow.prototype.loadURL = function (url, ...args) {
          if (url.startsWith('https://selearning.nju.edu.cn/'))
            return original.call(
              this,
              'data:text/html,<title>Isolated fixture</title><p>Controlled test page</p>',
              ...args,
            );
          return original.call(this, url, ...args);
        };
      });
      await page.evaluate(() =>
        window.teachshelf.openWebsite('https://selearning.nju.edu.cn/', 'teaching'),
      );
      const windows = app.windows();
      assert.equal(windows.length, 2);
      const remote = windows.find((w) => w !== page);
      await remote.waitForLoadState();
      assert.deepEqual(
        await remote.evaluate(() => ({
          require: typeof window.require,
          process: typeof window.process,
          api: typeof window.teachshelf,
        })),
        { require: 'undefined', process: 'undefined', api: 'undefined' },
      );
      const preferences = await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().map((w) => w.webContents.getLastWebPreferences()),
      );
      assert.equal(
        preferences.every(
          (p) => p.nodeIntegration === false && p.contextIsolation === true && p.sandbox === true,
        ),
        true,
      );
    },
  );
  await check('No renderer runtime errors', async () => {
    assert.deepEqual(errors, []);
  });
  await fs.writeFile(
    path.join(evidence, 'teachshelf-electron-e2e.json'),
    JSON.stringify(
      {
        platform: process.platform,
        steps,
        errors,
        screenshots: [
          'teachshelf-electron-empty.png',
          'teachshelf-electron-library.png',
          'teachshelf-electron-minimum-dark.png',
          'teachshelf-electron-timetable.png',
          'teachshelf-electron-plans.png',
          'teachshelf-electron-homework.png',
          'teachshelf-electron-month.png',
          'teachshelf-electron-month-course.png',
          'teachshelf-electron-website-review.png',
        ],
      },
      null,
      2,
    ),
  );
  console.log(`PASS ${steps.length} Electron UI checks; evidence: ${evidence}`);
} catch (error) {
  if (page && !page.isClosed())
    await page
      .screenshot({ path: path.join(evidence, 'teachshelf-electron-failure.png') })
      .catch(() => {});
  await fs.writeFile(
    path.join(evidence, 'teachshelf-electron-e2e.json'),
    JSON.stringify({ platform: process.platform, steps, errors, error: String(error) }, null, 2),
  );
  throw error;
} finally {
  await app?.close().catch(() => {});
  await fs.rm(root, { recursive: true, force: true });
}
