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
const root = await fs.realpath(
  await fs.mkdtemp(path.join(os.tmpdir(), 'teachshell-website-context-')),
);
const evidence = process.env.TEACHSHELF_SCREENSHOT_DIR ?? os.tmpdir();
await fs.mkdir(evidence, { recursive: true });
let app, page, website;
const steps = [],
  errors = [],
  warnings = [];
const snapshot = () => page.evaluate(() => window.teachshelf.snapshot());
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
      if (f.hold && url.pathname === '/course/view.php') {
        f.held = true;
        await new Promise((resolve) => {
          globalThis.__releaseHeld = resolve;
        });
        f.hold = false;
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

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+,' : 'Control+,');
  await page.getByRole('tab', { name: '资料库', exact: true }).click();
  await page.getByRole('button', { name: '打开教学网站工具', exact: true }).click();
  website = page.getByRole('dialog', { name: '教学网站', exact: true });
  await check('Late website open cannot overwrite a newly selected website type', async () => {
    assert.match(page.url(), /^file:.*\/dist\/index.html$/);
    assert.match(await page.title(), /Teachshell|课屿/);
    assert.equal(await page.locator('vite-error-overlay').count(), 0);
    await fixture({ hold: true });
    await website
      .getByLabel('页面地址', { exact: true })
      .fill('https://selearning.nju.edu.cn/course/view.php?id=42');
    await website.getByRole('button', { name: '打开登录窗口', exact: true }).click();
    await until(() => app.evaluate(() => !!globalThis.__reviewFixture.held), Boolean);
    await website.getByLabel('网站类型', { exact: true }).selectOption('timetable');
    assert.match(await website.getByLabel('页面地址', { exact: true }).inputValue(), /ehallapp/);
    await app.evaluate(() => globalThis.__releaseHeld());
    await until(
      () => website.getByRole('button', { name: '打开登录窗口', exact: true }).isEnabled(),
      Boolean,
    );
    assert.equal(await website.getByLabel('网站类型', { exact: true }).inputValue(), 'timetable');
    assert.match(await website.getByLabel('页面地址', { exact: true }).inputValue(), /ehallapp/);
    await page.screenshot({ path: path.join(evidence, 'teachshell-website-context-kind.png') });
  });
  await website.getByLabel('网站类型', { exact: true }).selectOption('teaching');
  const courseID = await page.evaluate(async () => {
    const created = await window.teachshelf.createCourse({ name: '网站上下文验收课程' });
    return created.state.courses[0].id;
  });
  await website
    .getByLabel('页面地址', { exact: true })
    .fill('https://selearning.nju.edu.cn/course/view.php?id=42');
  await website.getByRole('button', { name: '打开登录窗口', exact: true }).click();
  await website.getByRole('button', { name: '读取当前页面', exact: true }).click();
  await website.getByLabel('绑定到本地课程', { exact: true }).selectOption(courseID);
  await website.getByRole('button', { name: '绑定当前网站课程', exact: true }).click();
  await until(snapshot, (value) => value.state.teachingConnections.length === 1);
  await website
    .getByLabel('页面地址', { exact: true })
    .fill('https://selearning.nju.edu.cn/mod/assign/view.php?id=701');
  await website.getByRole('button', { name: '打开登录窗口', exact: true }).click();
  await until(
    () => website.getByRole('button', { name: '读取当前页面', exact: true }).isEnabled(),
    Boolean,
  );
  await website.getByRole('button', { name: '读取当前页面', exact: true }).click();
  await website.getByRole('button', { name: '预览当前作业更新', exact: true }).click();
  const confirm = website.getByRole('button', { name: '确认应用当前作业', exact: true });
  await until(() => confirm.isEnabled(), Boolean);
  await check(
    'Single-assignment expiry disables approval and visibly requests a fresh observation',
    async () => {
      const before = await snapshot();
      // Keep the actual interval running; only advance Date to verify the UI clock dependency.
      await page.clock.setFixedTime(Date.now() + 16 * 60_000);
      await page.waitForTimeout(1200);
      await until(() => confirm.isDisabled(), Boolean);
      await website
        .getByText('本地资料已变化或预览已过期，请重新读取当前页面并预览。', { exact: true })
        .waitFor();
      assert.equal((await snapshot()).revision, before.revision);
      await page.screenshot({
        path: path.join(evidence, 'teachshell-website-context-expired.png'),
      });
    },
  );
  await check(
    'Observed account change invalidates the prior single-assignment observation',
    async () => {
      await page.clock.setFixedTime(Date.now());
      const before = await snapshot();
      await fixture({ account: '100' });
      await page.evaluate(async () => {
        await window.teachshelf.openWebsite(
          'https://selearning.nju.edu.cn/mod/assign/view.php?id=701',
          'teaching',
        );
        await window.teachshelf.inspectWebsite('teaching');
      });
      assert.equal(
        (await page.evaluate(() => window.teachshelf.websiteLoginStatus())).accountID,
        '100',
      );
      await website
        .getByText('网站账号已变化，请重新读取当前页面并预览。', { exact: true })
        .first()
        .waitFor();
      assert.equal(await confirm.isDisabled(), true);
      assert.equal(
        await website.getByRole('button', { name: '预览当前作业更新', exact: true }).isDisabled(),
        true,
      );
      assert.equal((await snapshot()).revision, before.revision);
      await fixture({ account: '99' });
      await page.evaluate(async () => {
        await window.teachshelf.openWebsite(
          'https://selearning.nju.edu.cn/mod/assign/view.php?id=701',
          'teaching',
        );
        await window.teachshelf.inspectWebsite('teaching');
      });
      assert.equal(await confirm.isDisabled(), true);
      await page.screenshot({
        path: path.join(evidence, 'teachshell-website-context-account.png'),
      });
    },
  );
  await check(
    'A fresh observation restores approval and applies exactly one plan without file downloads',
    async () => {
      await website.getByRole('button', { name: '读取当前页面', exact: true }).click();
      await website.getByRole('button', { name: '预览当前作业更新', exact: true }).click();
      await until(() => confirm.isEnabled(), Boolean);
      await confirm.click();
      await until(snapshot, (value) => value.state.tasks.length === 1);
      assert.equal((await snapshot()).state.materials.length, 0);
      assert.equal(await app.evaluate(() => globalThis.__reviewFixture.downloads), 0);
      await confirm.waitFor({ state: 'hidden' });
    },
  );
  await check(
    'Late initial settings responses cannot replace newer subscription events',
    async () => {
      const initial = await page.evaluate(async () => ({
        login: await window.teachshelf.websiteLoginStatus(),
        background: await window.teachshelf.websiteBackgroundStatus(),
      }));
      await website
        .locator(':scope > header')
        .getByRole('button', { name: '关闭', exact: true })
        .click();
      // Hold only the public read-only replies to exercise actual component/preload delivery order.
      // No production mutation handler is replaced and no secure-storage operation is requested.
      await app.evaluate(({ ipcMain }, initial) => {
        globalThis.__contextReplies = [];
        for (const [name, value] of [
          ['websiteLoginStatus', initial.login],
          ['websiteBackgroundStatus', initial.background],
        ]) {
          ipcMain.removeHandler('teachshelf:' + name);
          ipcMain.handle(
            'teachshelf:' + name,
            () => new Promise((resolve) => globalThis.__contextReplies.push(() => resolve(value))),
          );
        }
      }, initial);
      await page.getByRole('tab', { name: '资料库', exact: true }).click();
      await page.getByRole('button', { name: '打开教学网站工具', exact: true }).click();
      await until(
        () => app.evaluate(() => globalThis.__contextReplies.length),
        (count) => count === 3,
      );
      await app.evaluate(({ BrowserWindow }, initial) => {
        const main = BrowserWindow.getAllWindows().find((win) =>
          win.webContents.getURL().startsWith('file:'),
        );
        main.webContents.send('teachshelf:website-login', {
          ...initial.login,
          enabled: true,
          status: '较新的登录状态',
        });
      }, initial);
      await page.evaluate(() => window.teachshelf.saveWebsiteBackground({ intervalMinutes: 17 }));
      const remember = website.getByLabel('记住此资料库的教学网站登录', { exact: true });
      const interval = website.getByLabel('巡检间隔（分钟）', { exact: true });
      await until(() => remember.isChecked(), Boolean);
      assert.equal(await interval.inputValue(), '17');
      await app.evaluate(() =>
        globalThis.__contextReplies.splice(0).forEach((resolve) => resolve()),
      );
      await page.waitForTimeout(150);
      assert.equal(await remember.isChecked(), true);
      assert.equal(await interval.inputValue(), '17');
      await website.getByText('较新的登录状态', { exact: true }).waitFor();
      assert.equal(await page.getByRole('alert').count(), 0);
    },
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
  console.log(`PASS ${steps.length} website context UI checks`);
} catch (error) {
  steps.push({ status: 'failed', error: String(error), stack: error.stack });
  await page
    ?.screenshot({ path: path.join(evidence, 'teachshell-website-context-failure.png') })
    .catch(() => {});
  throw error;
} finally {
  await fs.writeFile(
    path.join(evidence, 'teachshell-website-context-e2e.json'),
    JSON.stringify({ root, steps, errors, warnings }, null, 2),
  );
  await app?.close();
  await fs.rm(root, { recursive: true, force: true });
}
