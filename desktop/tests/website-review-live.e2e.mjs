/** Browser plugin not available: actual Electron/public IPC + isolated official-URL fixtures. */
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
const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'teachshell-live-review-')));
const evidence = process.env.TEACHSHELF_SCREENSHOT_DIR ?? os.tmpdir();
await fs.mkdir(evidence, { recursive: true });
let app, page, batch, website, connectionID;
const steps = [],
  errors = [],
  warnings = [];
const snapshot = () => page.evaluate(() => window.teachshelf.snapshot());
const status = () => page.evaluate(() => window.teachshelf.websiteBackgroundStatus());
const fresh = () =>
  page.evaluate(() => window.teachshelf.checkWebsiteBatch({ includeExisting: true }));
const applyButton = () => batch.getByRole('button', { name: /^(应用所选更新|重试所选更新)$/ });
async function until(read, predicate) {
  const end = Date.now() + 15000;
  while (Date.now() < end) {
    const value = await read();
    if (predicate(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Timed out waiting for live review state');
}
async function check(name, fn) {
  const start = Date.now();
  await fn();
  steps.push({ name, status: 'passed', durationMs: Date.now() - start });
  console.log('PASS', name);
}
async function fixture(patch) {
  await app.evaluate((_electron, patch) => Object.assign(globalThis.__reviewFixture, patch), patch);
}
async function announce(interval) {
  return page.evaluate(
    (intervalMinutes) => window.teachshelf.saveWebsiteBackground({ intervalMinutes }),
    interval,
  );
}
async function closeBatch() {
  await batch.locator(':scope > header').getByRole('button', { name: '关闭', exact: true }).click();
  await batch.waitFor({ state: 'hidden' });
}
async function openBatch() {
  await website.getByRole('button', { name: '批量检查课程更新', exact: true }).click();
  batch = page.getByRole('dialog', { name: '教学网站批量更新审核', exact: true });
  await batch.waitFor();
  await until(
    () => batch.getByRole('button', { name: /^(重新)?检查网站更新$/ }).isEnabled(),
    Boolean,
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
  page.setDefaultTimeout(15000);
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
    if (message.type() === 'warning') warnings.push(message.text());
  });
  await page.waitForSelector('.app-body');
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setBounds({ width: 1350, height: 940 }),
  );
  const s = await snapshot();
  const partition =
    'teachshelf-' + createHash('sha256').update(s.root).digest('hex').slice(0, 16) + '-teaching';
  await app.evaluate(async ({ session }, partition) => {
    globalThis.__reviewFixture = { account: '99', deadline: '2099年12月20日 18:00', downloads: 0 };
    await session.fromPartition(partition).protocol.handle('https', async (request) => {
      const url = new URL(request.url),
        f = globalThis.__reviewFixture;
      if (url.hostname !== 'selearning.nju.edu.cn')
        return new Response('Fixture host only', { status: 404 });
      if (url.pathname.startsWith('/pluginfile.php/')) {
        if (request.method !== 'HEAD') f.downloads++;
        return new Response('Original review attachment\n', {
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
      }
      const profile =
        '<nav class="usermenu"><a href="https://selearning.nju.edu.cn/user/profile.php?id=' +
        f.account +
        '">Fixture user</a></nav>';
      const course =
        '<h1>实时审核课程</h1><main id="region-main"><div class="course-content"><section class="section" data-sectionid="1"><h3 class="sectionname">作业</h3><a href="https://selearning.nju.edu.cn/mod/assign/view.php?id=701"><span class="instancename">实时审核作业</span></a></section></div></main>';
      const assignment =
        '<nav class="breadcrumb"><a href="https://selearning.nju.edu.cn/course/view.php?id=42">实时审核课程</a></nav><main id="region-main"><h2>实时审核作业</h2><div id="intro"><p>实际网页解析的作业说明</p><a href="https://selearning.nju.edu.cn/pluginfile.php/1/mod_assign/introattachment/0/review.txt">review.txt</a></div><table class="generaltable"><tr><th>截止日期</th><td>' +
        f.deadline +
        '</td></tr><tr><th>提交状态</th><td>未提交</td></tr></table></main>';
      return new Response(
        '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Live official review fixture</title><body>' +
          profile +
          (url.pathname === '/course/view.php' ? course : assignment) +
          '</body></html>',
        { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
      );
    });
  }, partition);
  await check(
    'Empty open review receives a real newly published review without reopening or downloads',
    async () => {
      assert.match(page.url(), /^file:.*\/dist\/index.html$/);
      assert.match(await page.title(), /Teachshell|课屿/);
      assert.equal(await page.locator('vite-error-overlay').count(), 0);
      connectionID = await page.evaluate(async () => {
        const api = window.teachshelf;
        const created = await api.createCourse({ name: '实时审核验收课程' });
        await api.openWebsite('https://selearning.nju.edu.cn/course/view.php?id=42', 'teaching');
        const observed = await api.inspectWebsite('teaching');
        return (await api.connectWebsite(observed.proposalID, created.state.courses[0].id))
          .connection.id;
      });
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+,' : 'Control+,');
      await page.getByRole('tab', { name: '资料库', exact: true }).click();
      await page.getByRole('button', { name: '打开教学网站工具', exact: true }).click();
      website = page.getByRole('dialog', { name: '教学网站', exact: true });
      await openBatch();
      assert.equal(await batch.locator('.batch-row').count(), 0);
      const result = await fresh();
      assert.equal(result.rows.length, 2);
      await until(
        () => batch.locator('.batch-row').count(),
        (count) => count === 2,
      );
      assert.equal(await app.evaluate(() => globalThis.__reviewFixture.downloads), 0);
      await page.screenshot({ path: path.join(evidence, 'teachshell-review-live-ready.png') });
    },
  );
  await check(
    'Same-review state broadcasts preserve selection and own apply handles its intermediate events',
    async () => {
      const file = batch.getByRole('checkbox', { name: '选择更新 review.txt', exact: true });
      await file.uncheck();
      const before = (await status()).review.id;
      await announce(31);
      assert.equal((await status()).review.id, before);
      assert.equal(await file.isChecked(), false);
      await file.check();
      await applyButton().click();
      await until(
        snapshot,
        (value) => value.state.tasks.length === 1 && value.state.materials.length === 1,
      );
      await until(
        () => batch.getByRole('button', { name: '重新检查网站更新', exact: true }).isEnabled(),
        Boolean,
      );
      assert.equal(await batch.locator('.batch-row').count(), 0);
      assert.equal(await batch.getByText(/当前审核已失效/).count(), 0);
    },
  );
  await check(
    'Same ID broadcasts preserve deadline choices and explicit local-version approval',
    async () => {
      const value = await snapshot();
      const material = value.state.materials[0];
      await fs.writeFile(path.join(value.root, material.storedPath), 'User-edited fixture bytes\n');
      await page.evaluate(async () => {
        const api = window.teachshelf;
        await api.sync();
        const value = await api.snapshot(),
          task = value.state.tasks[0];
        await api.savePlan({ id: task.id, title: task.title, deadline: task.deadline + 86400 });
      });
      await fixture({ deadline: '2099年12月22日 18:00' });
      const checked = await fresh();
      const file = checked.rows.find((row) => row.kind === 'file');
      assert.ok(file);
      await page.evaluate(
        async ({ reviewID, selectedIDs }) =>
          window.teachshelf.applyWebsiteBatch({ reviewID, selectedIDs }),
        { reviewID: checked.id, selectedIDs: [file.id] },
      );
      await batch.getByRole('button', { name: '加载最新审核', exact: true }).click();
      const local = batch.getByRole('checkbox', {
        name: '允许保留本地版本后更新 review.txt',
        exact: true,
      });
      await local.check();
      await batch.getByRole('checkbox', { name: '选择更新 review.txt', exact: true }).check();
      const ddl = batch.getByLabel('截止冲突处理 实时审核作业', { exact: true });
      await ddl.selectOption('website');
      await batch.getByRole('checkbox', { name: '选择更新 实时审核作业', exact: true }).check();
      const before = (await status()).review.id;
      await announce(32);
      assert.equal((await status()).review.id, before);
      assert.equal(await local.isChecked(), true);
      assert.equal(await ddl.inputValue(), 'website');
      assert.equal(
        await batch.getByRole('checkbox', { name: '选择更新 review.txt', exact: true }).isChecked(),
        true,
      );
      assert.equal(
        await batch
          .getByRole('checkbox', { name: '选择更新 实时审核作业', exact: true })
          .isChecked(),
        true,
      );
      assert.equal(await applyButton().isEnabled(), true);
    },
  );
  await check(
    'Public discard invalidates the open review immediately without losing its choices',
    async () => {
      await page.evaluate(() => window.teachshelf.discardWebsiteReview());
      await batch.getByText(/当前审核已失效/).waitFor();
      assert.equal(await applyButton().isDisabled(), true);
      assert.equal(
        await batch
          .getByRole('checkbox', { name: '允许保留本地版本后更新 review.txt', exact: true })
          .isChecked(),
        true,
      );
      assert.equal(
        await batch.getByLabel('截止冲突处理 实时审核作业', { exact: true }).inputValue(),
        'website',
      );
      await page.screenshot({
        path: path.join(evidence, 'teachshell-review-live-invalidated.png'),
      });
    },
  );
  await check(
    'Replacement is offered explicitly; adopting it resets choices only after user action',
    async () => {
      await fresh();
      const latest = batch.getByRole('button', { name: '加载最新审核', exact: true });
      await latest.waitFor();
      assert.equal(await applyButton().isDisabled(), true);
      assert.equal(
        await batch
          .getByRole('checkbox', { name: '允许保留本地版本后更新 review.txt', exact: true })
          .isChecked(),
        true,
      );
      await latest.click();
      assert.equal(await batch.getByText(/当前审核已失效/).count(), 0);
      assert.equal(await batch.locator('.batch-row[data-status="verify-file"]').count(), 1);
      assert.equal(
        await batch.getByRole('checkbox', { name: '选择更新 review.txt', exact: true }).isChecked(),
        false,
      );
      assert.equal(
        await batch.getByLabel('截止冲突处理 实时审核作业', { exact: true }).inputValue(),
        '',
      );
    },
  );
  await check(
    'Changing the scope prevents old events from silently restoring the prior review',
    async () => {
      await batch
        .getByRole('checkbox', { name: '列出已有资料，供选择后下载核验', exact: true })
        .uncheck();
      assert.equal(await batch.locator('.batch-row').count(), 0);
      await announce(33);
      await batch.getByRole('button', { name: '加载最新审核', exact: true }).waitFor();
      assert.equal(await batch.locator('.batch-row').count(), 0);
      assert.equal(
        await batch
          .getByRole('checkbox', { name: '列出已有资料，供选择后下载核验', exact: true })
          .isChecked(),
        false,
      );
      await closeBatch();
      await openBatch();
      await until(
        () => batch.locator('.batch-row').count(),
        (count) => count === 2,
      );
    },
  );
  await check(
    'An observed official account change invalidates the open review without a library mutation',
    async () => {
      const before = (await snapshot()).revision;
      await fixture({ account: '100' });
      await page.evaluate(async () => {
        await window.teachshelf.openWebsite(
          'https://selearning.nju.edu.cn/course/view.php?id=42',
          'teaching',
        );
        await window.teachshelf.inspectWebsite('teaching');
      });
      assert.equal((await status()).review, undefined);
      assert.equal((await snapshot()).revision, before);
      await batch.getByText(/当前审核已失效/).waitFor();
      assert.equal(await applyButton().isDisabled(), true);
      assert.equal(await batch.locator('.batch-row').count(), 2);
      assert.deepEqual(errors, []);
    },
  );
  console.log(`PASS ${steps.length} live review UI checks`);
} catch (error) {
  steps.push({ status: 'failed', error: String(error), stack: error.stack });
  await page
    ?.screenshot({ path: path.join(evidence, 'teachshell-review-live-failure.png') })
    .catch(() => {});
  throw error;
} finally {
  await fs.writeFile(
    path.join(evidence, 'teachshell-review-live-e2e.json'),
    JSON.stringify(
      {
        browser: 'Browser plugin not available; Playwright Electron',
        executable: executable ?? electronPath,
        root,
        viewport: { width: 1350, height: 940 },
        steps,
        errors,
        warnings,
      },
      null,
      2,
    ),
  );
  await app?.close();
  await fs.rm(root, { recursive: true, force: true });
}
