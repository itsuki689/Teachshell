/** Official-URL DOM + download fixtures exercise the shipped main/preload/renderer pipeline. */
import { _electron } from 'playwright';
import electronPath from 'electron';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const executable = process.env.TEACHSHELF_EXECUTABLE;
if (executable && !path.isAbsolute(executable))
  throw new Error('TEACHSHELF_EXECUTABLE must be absolute');
const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'teachshell-batch-e2e-'))),
  evidence =
    process.env.TEACHSHELF_SCREENSHOT_DIR ?? (process.platform === 'win32' ? os.tmpdir() : '/tmp');
await fs.mkdir(evidence, { recursive: true });
let app, page, courseID, connectionID, firstA, secondA, thirdA;
const steps = [],
  errors = [],
  lifecycle = [];
async function check(name, fn) {
  const start = Date.now();
  await fn();
  steps.push({ name, status: 'passed', durationMs: Date.now() - start });
  console.log('PASS', name);
}
async function snapshot() {
  return page.evaluate(() => window.teachshelf.snapshot());
}
async function until(predicate) {
  const end = Date.now() + 20000;
  while (Date.now() < end) {
    const s = await snapshot();
    if (predicate(s.state)) return s;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Timed out waiting for website transaction');
}
async function fixture(values) {
  await app.evaluate(
    (_electron, values) => Object.assign(globalThis.__batchFixture, values),
    values,
  );
}
async function downloads() {
  return app.evaluate(() => globalThis.__batchFixture.downloads);
}
function current(state, name) {
  const c = state.teachingConnections.find((c) => c.id === connectionID),
    link = c.items.find((item) => item.id.endsWith(':' + name));
  return state.materials.find((m) => m.id === link?.localID);
}
async function bytes(state, id) {
  const m = state.state.materials.find((m) => m.id === id);
  assert.ok(m);
  return fs.readFile(path.join(state.root, m.storedPath), 'utf8');
}
let website, batch;
async function recheck() {
  await batch.getByRole('button', { name: /^(重新)?检查网站更新$/ }).click();
  await batch.getByRole('button', { name: '重新检查网站更新', exact: true }).waitFor();
  await page.waitForFunction(
    () =>
      !document.querySelector('[aria-label="教学网站批量更新审核"] .setting-actions button')
        ?.disabled,
  );
}
async function applySelected(retry = false) {
  await batch
    .getByRole('button', { name: retry ? '重试所选更新' : '应用所选更新', exact: true })
    .click();
  await page.waitForFunction(
    () =>
      !document.querySelector('[aria-label="教学网站批量更新审核"] .setting-actions button')
        ?.disabled,
  );
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
  app
    .process()
    .on('exit', (code, signal) => lifecycle.push({ event: 'process-exit', code, signal }));
  page.on('close', () => lifecycle.push({ event: 'page-close' }));
  page.on('crash', () => lifecycle.push({ event: 'page-crash' }));
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.waitForSelector('.app-body');
  await check(
    'Bind a real course through an isolated official-URL Moodle DOM fixture',
    async () => {
      await page.locator('.sidebar').getByRole('button', { name: '新建课程', exact: true }).click();
      const editor = page.getByRole('dialog', { name: '新建课程' });
      await editor.getByLabel('课程名称', { exact: true }).fill('批量同步验收课程');
      await editor.getByRole('button', { name: '保存', exact: true }).click();
      await editor.waitFor({ state: 'hidden' });
      const s = await until((s) => s.courses.length === 1);
      courseID = s.state.courses[0].id;
      const partition =
        'teachshelf-' +
        createHash('sha256').update(s.root).digest('hex').slice(0, 16) +
        '-teaching';
      await app.evaluate(async ({ session }, partition) => {
        globalThis.__batchFixture = {
          account: '99',
          a: '网站初版 A\n',
          b: '网站初版 B\n',
          failB: true,
          downloads: 0,
          assignment: false,
          intro: '网站批量作业初始说明',
          deadline: '2099年12月20日 18:00',
        };
        await session.fromPartition(partition).protocol.handle('https', (request) => {
          const url = new URL(request.url),
            f = globalThis.__batchFixture;
          if (url.hostname !== 'selearning.nju.edu.cn')
            return new Response('Fixture host only', { status: 404 });
          if (url.pathname.startsWith('/pluginfile.php/')) {
            if (request.method !== 'HEAD') f.downloads++;
            const isB = decodeURIComponent(url.pathname).endsWith('补充资料.txt');
            return new Response(isB && f.failB ? 'temporary fixture failure' : isB ? f.b : f.a, {
              status: isB && f.failB ? 503 : 200,
              headers: { 'Content-Type': 'text/plain; charset=utf-8' },
            });
          }
          const profile =
            '<nav class="usermenu"><a href="https://selearning.nju.edu.cn/user/profile.php?id=' +
            f.account +
            '">Fixture user</a></nav>';
          const course =
            '<h1>批量网站课程</h1><main id="region-main"><div class="course-content"><section class="section" data-sectionid="1"><h3 class="sectionname">课件</h3><a href="https://selearning.nju.edu.cn/mod/folder/view.php?id=601"><span class="instancename">批量资料</span></a>' +
            (f.assignment
              ? '<a href="https://selearning.nju.edu.cn/mod/assign/view.php?id=701"><span class="instancename">批量作业</span></a>'
              : '') +
            '</section></div></main>';
          const assignment =
            '<nav class="breadcrumb"><a href="https://selearning.nju.edu.cn/course/view.php?id=42">网站课程</a></nav><main id="region-main"><h2>批量作业</h2><div id="intro"><p>' +
            f.intro +
            '</p></div><table class="generaltable"><tr><th>截止日期</th><td>' +
            f.deadline +
            '</td></tr><tr><th>提交状态</th><td>未提交</td></tr></table></main>';
          const folder =
            '<nav class="breadcrumb"><a href="https://selearning.nju.edu.cn/course/view.php?id=42">课程</a></nav><main id="region-main"><h2>批量资料</h2><a href="https://selearning.nju.edu.cn/pluginfile.php/1/mod_folder/content/1/' +
            encodeURIComponent('增量课件.txt') +
            '">增量课件.txt</a><a href="https://selearning.nju.edu.cn/pluginfile.php/1/mod_folder/content/1/' +
            encodeURIComponent('补充资料.txt') +
            '">补充资料.txt</a></main>';
          return new Response(
            '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Offline batch fixture</title><body>' +
              profile +
              (url.pathname === '/course/view.php'
                ? course
                : url.pathname === '/mod/assign/view.php'
                  ? assignment
                  : folder) +
              '</body></html>',
            { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
          );
        });
      }, partition);
      await page.getByRole('button', { name: '教学网站', exact: true }).first().click();
      website = page.getByRole('dialog', { name: '教学网站' });
      await website
        .getByLabel('页面地址', { exact: true })
        .fill('https://selearning.nju.edu.cn/course/view.php?id=42');
      await website.getByRole('button', { name: '打开登录窗口', exact: true }).click();
      await website.getByRole('button', { name: '读取当前页面', exact: true }).click();
      await website.getByLabel('绑定到本地课程', { exact: true }).selectOption(courseID);
      await website.getByRole('button', { name: '绑定当前网站课程', exact: true }).click();
      const bound = await until((s) => s.teachingConnections.length === 1);
      connectionID = bound.state.teachingConnections[0].id;
    },
  );
  await check(
    'Read-only batch inspection downloads no file body; partial failure retains a retryable row',
    async () => {
      await website.getByRole('button', { name: '读取当前页面', exact: true }).click();
      await website.getByRole('button', { name: '批量资料', exact: true }).click();
      await website.getByRole('button', { name: '读取当前页面', exact: true }).click();
      assert.equal(
        await website.getByRole('button', { name: '导入选中资料', exact: true }).count(),
        0,
      );
      await website.getByRole('button', { name: '进入批量更新审核', exact: true }).click();
      batch = page.getByRole('dialog', { name: '教学网站批量更新审核' });
      await batch.getByRole('button', { name: '检查网站更新', exact: true }).click();
      await batch.locator('.batch-row').nth(1).waitFor();
      assert.equal(await downloads(), 0);
      assert.equal((await snapshot()).state.materials.length, 0);
      assert.equal(await batch.locator('.batch-row[data-status="new-file"]').count(), 2);
      const heading = batch.locator('.batch-row-heading').first();
      assert.equal(
        await heading.evaluate((element) => getComputedStyle(element).flexDirection),
        'row',
      );
      assert.ok((await heading.locator('input').boundingBox()).width <= 18);
      await page.screenshot({ path: path.join(evidence, 'teachshell-batch-review.png') });
      await applySelected();
      const partial = await until((s) => s.materials.length === 1);
      firstA = current(partial.state, '增量课件.txt').id;
      assert.equal(await bytes(partial, firstA), '网站初版 A\n');
      assert.equal(await batch.locator('.batch-row').count(), 1);
      assert.match(await batch.locator('.batch-row').innerText(), /补充资料|503/);
      await fixture({ failB: false });
      await applySelected(true);
      const complete = await until((s) => s.materials.length === 2);
      assert.equal(
        await bytes(complete, current(complete.state, '补充资料.txt').id),
        '网站初版 B\n',
      );
      assert.equal(await batch.locator('.batch-row').count(), 0);
    },
  );
  await check(
    'Explicit verification creates a new current version and retains prior file content',
    async () => {
      await fixture({ a: '网站第二版 A\n' });
      const before = await downloads();
      await recheck();
      assert.equal(await downloads(), before);
      assert.equal(await batch.locator('.batch-row[data-status="verify-file"]').count(), 2);
      assert.equal(
        await batch
          .getByRole('checkbox', { name: '选择更新 增量课件.txt', exact: true })
          .isChecked(),
        false,
      );
      await batch.getByRole('checkbox', { name: '选择更新 增量课件.txt', exact: true }).check();
      await applySelected();
      const updated = await until((s) => s.materials.length === 3);
      secondA = current(updated.state, '增量课件.txt').id;
      assert.notEqual(secondA, firstA);
      assert.equal(await bytes(updated, firstA), '网站初版 A\n');
      assert.equal(await bytes(updated, secondA), '网站第二版 A\n');
    },
  );
  await check(
    'Locally modified bytes are rejected until separate approval preserves them as history',
    async () => {
      let s = await snapshot();
      await fs.writeFile(
        path.join(s.root, s.state.materials.find((m) => m.id === secondA).storedPath),
        '本地手工修改 A\n',
      );
      await page.evaluate(() => window.teachshelf.sync());
      await fixture({ a: '网站第三版 A\n' });
      await recheck();
      await batch.getByRole('checkbox', { name: '选择更新 增量课件.txt', exact: true }).check();
      await applySelected();
      await batch.locator('.batch-row[data-status="local-modified"]').waitFor();
      s = await snapshot();
      assert.equal(s.state.materials.length, 3);
      assert.equal(current(s.state, '增量课件.txt').id, secondA);
      assert.equal(await bytes(s, secondA), '本地手工修改 A\n');
      assert.equal(
        await batch
          .getByRole('checkbox', { name: '选择更新 增量课件.txt', exact: true })
          .isDisabled(),
        true,
      );
      await batch
        .getByRole('checkbox', { name: '允许保留本地版本后更新 增量课件.txt', exact: true })
        .check();
      await batch.getByRole('checkbox', { name: '选择更新 增量课件.txt', exact: true }).check();
      await applySelected(true);
      const adopted = await until((s) => s.materials.length === 4);
      thirdA = current(adopted.state, '增量课件.txt').id;
      assert.equal(await bytes(adopted, secondA), '本地手工修改 A\n');
      assert.equal(await bytes(adopted, thirdA), '网站第三版 A\n');
    },
  );
  await check(
    'Changing inspection options invalidates the previous review before any update can run',
    async () => {
      await recheck();
      await batch
        .getByRole('checkbox', { name: '列出已有资料，供选择后下载核验', exact: true })
        .uncheck();
      assert.equal(await batch.locator('.batch-row').count(), 0);
      assert.equal(
        await batch.getByRole('button', { name: '应用所选更新', exact: true }).count(),
        0,
      );
      await batch
        .getByRole('checkbox', { name: '列出已有资料，供选择后下载核验', exact: true })
        .check();
      await recheck();
      await batch.locator('.batch-connections input').uncheck();
      assert.equal(await batch.locator('.batch-row').count(), 0);
      assert.equal(
        await batch.getByRole('button', { name: '检查网站更新', exact: true }).isDisabled(),
        true,
      );
      await batch.locator('.batch-connections input').check();
      await recheck();
    },
  );
  await check(
    'A stale batch review cannot overwrite metadata committed by another client',
    async () => {
      await recheck();
      await batch.getByRole('checkbox', { name: '选择更新 增量课件.txt', exact: true }).check();
      await page.evaluate(
        (id) => window.teachshelf.updateMaterial(id, { notes: '其他客户端保留的备注' }),
        thirdA,
      );
      await batch
        .getByText('资料库已变化，当前清单不能继续应用，请重新检查网站更新。', { exact: true })
        .waitFor();
      assert.equal(
        await batch.getByRole('button', { name: '应用所选更新', exact: true }).isDisabled(),
        true,
      );
      assert.equal(
        (await snapshot()).state.materials.find((m) => m.id === thirdA).notes,
        '其他客户端保留的备注',
      );
    },
  );
  await check(
    'History UI restores the selected old content as a new version without deleting any prior version',
    async () => {
      await batch.getByRole('button', { name: '关闭', exact: true }).last().click();
      await website.getByRole('button', { name: '关闭', exact: true }).click();
      const s = await snapshot(),
        m = s.state.materials.find((m) => m.id === thirdA),
        chain = [];
      let id = m.folderID;
      while (id) {
        const folder = s.state.materialFolders.find((f) => f.id === id);
        chain.unshift(folder.name);
        id = folder.parentID;
      }
      for (const name of chain)
        await page.locator('.folder-open').filter({ hasText: name }).click();
      await page.getByRole('table').getByText(m.title, { exact: true }).click();
      await page
        .locator('.inspector')
        .getByRole('button', { name: '版本历史', exact: true })
        .click();
      const versions = page.getByRole('dialog', { name: '资料版本历史' });
      await versions.locator('.version-row').nth(2).waitFor();
      assert.equal(await versions.locator('.version-row').count(), 3);
      assert.equal(
        await versions
          .locator('.version-row')
          .first()
          .evaluate((element) => getComputedStyle(element).flexDirection),
        'row',
      );
      assert.ok((await versions.locator('input[type="radio"]').first().boundingBox()).width <= 18);
      await versions.locator(`[data-version-id="${firstA}"] input`).check();
      await page.screenshot({ path: path.join(evidence, 'teachshell-material-versions.png') });
      await versions.getByRole('button', { name: '恢复为新版本', exact: true }).click();
      await page
        .getByRole('dialog', { name: '恢复这个资料版本？' })
        .getByRole('button', { name: '创建恢复版本', exact: true })
        .click();
      const restored = await until((s) => s.materials.length === 5);
      const newest = current(restored.state, '增量课件.txt');
      assert.notEqual(newest.id, firstA);
      assert.notEqual(newest.id, thirdA);
      assert.equal(await bytes(restored, newest.id), '网站初版 A\n');
      assert.equal(await bytes(restored, firstA), '网站初版 A\n');
      assert.equal(await bytes(restored, secondA), '本地手工修改 A\n');
      assert.equal(await bytes(restored, thirdA), '网站第三版 A\n');
    },
  );
  await check(
    'Missing website files remain unselected until explicitly restored through batch review',
    async () => {
      const initial = await snapshot(),
        oldB = current(initial.state, '补充资料.txt');
      await fs.unlink(path.join(initial.root, oldB.storedPath));
      await page.evaluate(() => window.teachshelf.sync());
      await page.getByRole('button', { name: '教学网站', exact: true }).first().click();
      website = page.getByRole('dialog', { name: '教学网站' });
      await website.getByRole('button', { name: '批量检查课程更新', exact: true }).click();
      batch = page.getByRole('dialog', { name: '教学网站批量更新审核' });
      const before = await downloads();
      await recheck();
      await batch.locator('.batch-row[data-status="missing-file"]').waitFor();
      const missing = batch.getByRole('checkbox', { name: '选择更新 补充资料.txt', exact: true });
      assert.equal(await missing.isChecked(), false);
      assert.equal(await downloads(), before);
      await missing.check();
      await applySelected();
      const restored = await until((s) => !current(s, '补充资料.txt').isMissing);
      assert.equal(
        await bytes(restored, current(restored.state, '补充资料.txt').id),
        '网站初版 B\n',
      );
      assert.equal(await batch.locator('.batch-row[data-status="missing-file"]').count(), 0);
    },
  );
  await check(
    'Batch assignment review creates a plan without downloading unselected existing files',
    async () => {
      await fixture({ assignment: true });
      const before = await downloads();
      await recheck();
      const row = batch.locator('.batch-row[data-status="new-plan"]');
      await row.waitFor();
      assert.equal(await row.locator('input[type="checkbox"]').isChecked(), true);
      await row.getByText('查看计划差异', { exact: true }).click();
      assert.match(await row.innerText(), /网站批量作业初始说明/);
      await applySelected();
      const s = await until((s) => s.tasks.length === 1);
      assert.equal(s.state.tasks[0].title, '批量作业');
      assert.equal(await downloads(), before);
    },
  );
  await check(
    'Deadline conflicts require an explicit choice and both choices preserve manual plan text',
    async () => {
      const s = await snapshot(),
        id = s.state.tasks[0].id;
      const localDeadline = (Date.parse('2099-12-19T18:00:00+08:00') - 978307200000) / 1000;
      await page.evaluate(
        ({ id, deadline }) =>
          window.teachshelf.savePlan({
            id,
            title: '本地批量标题',
            content: '本地批量手工备注',
            deadline,
            deadlineIsAllDay: false,
          }),
        { id, deadline: localDeadline },
      );
      await fixture({ intro: '网站批量作业更新说明', deadline: '2099年12月21日 18:00' });
      await recheck();
      let row = batch.locator('.batch-row[data-status="deadline-conflict"]');
      await row.waitFor();
      await row.locator('input[type="checkbox"]').check();
      const apply = batch.getByRole('button', { name: '应用所选更新', exact: true });
      assert.equal(await apply.isDisabled(), true);
      await row.locator('select').selectOption('local');
      await row.scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(evidence, 'teachshell-batch-deadline.png') });
      await applySelected();
      let after = (await snapshot()).state.tasks.find((t) => t.id === id);
      assert.equal(after.deadline, localDeadline);
      assert.equal(after.title, '本地批量标题');
      assert.equal(after.content, '本地批量手工备注');
      await fixture({ deadline: '2099年12月22日 18:00' });
      await recheck();
      row = batch.locator('.batch-row[data-status="deadline-conflict"]');
      await row.waitFor();
      await row.locator('input[type="checkbox"]').check();
      assert.equal(await apply.isDisabled(), true);
      await row.locator('select').selectOption('website');
      await row.getByText('查看计划差异', { exact: true }).click();
      assert.match(
        await row.locator('.batch-plan-diff section').nth(1).innerText(),
        /2099\/12\/22/,
      );
      await applySelected();
      after = (await snapshot()).state.tasks.find((t) => t.id === id);
      assert.equal(
        new Date(after.deadline * 1000 + 978307200000).toISOString(),
        '2099-12-22T10:00:00.000Z',
      );
      assert.equal(after.title, '本地批量标题');
      assert.equal(after.content, '本地批量手工备注');
    },
  );
  await check(
    'An expired review automatically disables applying its selected updates',
    async () => {
      await recheck();
      await batch.getByRole('checkbox', { name: '选择更新 增量课件.txt', exact: true }).check();
      assert.equal(
        await batch.getByRole('button', { name: '应用所选更新', exact: true }).isDisabled(),
        false,
      );
      // The review's interval already exists. Replacing all timer APIs here would mix
      // native intervals with fake animation frames and make the assertion depend on
      // renderer scheduling. Change only Date; exercise the shipped interval itself.
      await page.clock.setFixedTime(Date.now() + 16 * 60 * 1000);
      await batch
        .getByText('更新清单已过期，请重新检查网站更新。', { exact: true })
        .waitFor({ timeout: 5000 });
      assert.equal(
        await batch.getByRole('button', { name: '应用所选更新', exact: true }).isDisabled(),
        true,
      );
    },
  );
  await check(
    'No renderer runtime errors during batch synchronization and version recovery',
    async () => assert.deepEqual(errors, []),
  );
  await fs.writeFile(
    path.join(evidence, 'teachshell-website-batch-e2e.json'),
    JSON.stringify({ platform: process.platform, steps, errors, lifecycle }, null, 2),
  );
  console.log(`PASS ${steps.length} website batch acceptance checks`);
} catch (error) {
  await page
    ?.screenshot({ path: path.join(evidence, 'teachshell-batch-failure.png') })
    .catch(() => {});
  await fs.writeFile(
    path.join(evidence, 'teachshell-website-batch-e2e.json'),
    JSON.stringify(
      { platform: process.platform, steps, errors, lifecycle, error: String(error) },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await app?.close().catch(() => {});
  await fs.rm(root, { recursive: true, force: true });
}
