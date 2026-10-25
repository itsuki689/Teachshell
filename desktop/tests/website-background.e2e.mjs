/** Browser plugin not available. Real Electron timers + official-URL DOM fixtures; no scheduler hooks. */
import { _electron } from 'playwright';
import electronPath from 'electron';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Repository } from '../electron/services/storage/repository.ts';

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const executable = process.env.TEACHSHELF_EXECUTABLE;
if (executable && !path.isAbsolute(executable))
  throw new Error('TEACHSHELF_EXECUTABLE must be absolute');
const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'teachshell-background-')));
const evidence = process.env.TEACHSHELF_SCREENSHOT_DIR ?? os.tmpdir();
await fs.mkdir(evidence, { recursive: true });
const otherRoot = path.join(root, 'OtherLibrary');
const other = await Repository.open(otherRoot, { create: true });
await other.close();
let app, page, website, batch, courseID, libraryRoot, enabledAt;
const steps = [],
  errors = [],
  warnings = [];
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const snapshot = () => page.evaluate(() => window.teachshelf.snapshot());
const status = () => page.evaluate(() => window.teachshelf.websiteBackgroundStatus());
const background = () => website.getByRole('region', { name: '教学网站后台巡检', exact: true });
async function until(read, predicate, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await read();
    if (predicate(value)) return value;
    await delay(100);
  }
  throw new Error('Timed out waiting for background website state');
}
async function fixture(values) {
  return app.evaluate(
    (_electron, values) => Object.assign(globalThis.__backgroundFixture, values),
    values,
  );
}
const counters = () =>
  app.evaluate(() => {
    const f = globalThis.__backgroundFixture;
    return { reads: f.reads, downloads: f.downloads, held: f.held, maxHidden: f.maxHidden };
  });
async function check(name, fn) {
  const start = Date.now();
  await fn();
  steps.push({ name, status: 'passed', durationMs: Date.now() - start });
  console.log('PASS', name);
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
  await page.waitForFunction(() => typeof window.teachshelf.websiteBackgroundStatus === 'function');
  await page.evaluate(() => {
    window.__backgroundEvents = [];
    window.teachshelf.onWebsiteBackground((value) => {
      window.__backgroundEvents.push(value);
      if (window.__backgroundEvents.length > 1000) window.__backgroundEvents.shift();
    });
  });
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setBounds({ width: 1350, height: 940 }),
  );
}
async function openWebsite() {
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+,' : 'Control+,');
  await page.getByRole('button', { name: '打开教学网站工具', exact: true }).click();
  website = page.getByRole('dialog', { name: '教学网站', exact: true });
  await background().waitFor();
}
async function closeDialog(title) {
  const dialog = page.getByRole('dialog', { name: title, exact: true });
  await dialog
    .locator(':scope > header')
    .getByRole('button', { name: '关闭', exact: true })
    .click();
  await dialog.waitFor({ state: 'hidden' });
}
async function toggle(enabled) {
  const box = background().getByRole('checkbox', { name: '启用后台定时巡检', exact: true });
  await box.setChecked(enabled);
  await until(status, (value) => value.preferences.enabled === enabled);
}
async function installFixture() {
  const s = await snapshot();
  const partition =
    'teachshelf-' + createHash('sha256').update(s.root).digest('hex').slice(0, 16) + '-teaching';
  await app.evaluate(async ({ session, BrowserWindow }, partition) => {
    globalThis.__backgroundFixture = {
      account: '99',
      reads: 0,
      downloads: 0,
      held: 0,
      holdNextCourse: false,
      maxHidden: 0,
    };
    await session.fromPartition(partition).protocol.handle('https', async (request) => {
      const url = new URL(request.url),
        f = globalThis.__backgroundFixture;
      if (url.hostname !== 'selearning.nju.edu.cn')
        return new Response('Fixture host only', { status: 404 });
      if (url.pathname.startsWith('/pluginfile.php/')) {
        if (request.method !== 'HEAD') f.downloads++;
        return new Response('后台审核后才下载的正文\n', {
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
      }
      if (['/course/view.php', '/mod/assign/view.php'].includes(url.pathname)) {
        f.reads++;
        f.maxHidden = Math.max(
          f.maxHidden,
          BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed() && !w.isVisible()).length,
        );
      }
      if (url.pathname === '/course/view.php' && f.holdNextCourse) {
        f.holdNextCourse = false;
        f.held++;
        await new Promise((resolve) => {
          f.releaseHeld = resolve;
        });
      }
      const profile =
        '<nav class="usermenu"><a href="https://selearning.nju.edu.cn/user/profile.php?id=' +
        f.account +
        '">Fixture user</a></nav>';
      const course =
        '<h1>后台网站课程</h1><main id="region-main"><div class="course-content"><section class="section" data-sectionid="1"><h3 class="sectionname">作业</h3><a href="https://selearning.nju.edu.cn/mod/assign/view.php?id=701"><span class="instancename">后台作业</span></a></section></div></main>';
      const assignment =
        '<nav class="breadcrumb"><a href="https://selearning.nju.edu.cn/course/view.php?id=42">后台网站课程</a></nav><main id="region-main"><h2>后台作业</h2><div id="intro"><p>阅读附件后完成作业</p><a href="https://selearning.nju.edu.cn/pluginfile.php/1/mod_assign/introattachment/0/' +
        encodeURIComponent('后台附件.txt') +
        '">后台附件.txt</a></div><table class="generaltable"><tr><th>截止日期</th><td>2099年12月20日 18:00</td></tr><tr><th>提交状态</th><td>未提交</td></tr></table></main>';
      return new Response(
        '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Background official fixture</title><body>' +
          profile +
          (url.pathname === '/course/view.php' ? course : assignment) +
          '</body></html>',
        { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
      );
    });
  }, partition);
}
try {
  await launch();
  await check(
    'Official page observation establishes the login and course binding; background defaults off',
    async () => {
      assert.match(await page.title(), /Teachshell|课屿/);
      assert.match(page.url(), /^file:.*\/dist\/index.html$/);
      assert.equal(await page.locator('vite-error-overlay').count(), 0);
      await page.locator('.sidebar').getByRole('button', { name: '新建课程', exact: true }).click();
      const editor = page.getByRole('dialog', { name: '新建课程', exact: true });
      await editor.getByLabel('课程名称', { exact: true }).fill('后台巡检验收课程');
      await editor.getByRole('button', { name: '保存', exact: true }).click();
      await editor.waitFor({ state: 'hidden' });
      const s = await until(snapshot, (value) => value.state.courses.length === 1);
      courseID = s.state.courses[0].id;
      libraryRoot = s.root;
      await installFixture();
      await openWebsite();
      assert.deepEqual((await status()).preferences, { enabled: false, intervalMinutes: 30 });
      await website
        .getByLabel('页面地址', { exact: true })
        .fill('https://selearning.nju.edu.cn/course/view.php?id=42');
      await website.getByRole('button', { name: '打开登录窗口', exact: true }).click();
      await website.getByRole('button', { name: '读取当前页面', exact: true }).click();
      await website.getByLabel('绑定到本地课程', { exact: true }).selectOption(courseID);
      await website.getByRole('button', { name: '绑定当前网站课程', exact: true }).click();
      await until(snapshot, (value) => value.state.teachingConnections.length === 1);
      const login = await page.evaluate(() => window.teachshelf.websiteLoginStatus());
      assert.equal(login.loginState, 'signedIn');
      assert.equal(login.accountID, '99');
    },
  );
  await check(
    'Strict background IPC rejects malformed fields and interval bounds without changing settings',
    async () => {
      const before = await status();
      const rejected = await page.evaluate(async () => {
        const outcomes = [];
        for (const input of [
          { enabled: 'true' },
          { intervalMinutes: 0 },
          { intervalMinutes: 1441 },
          { intervalMinutes: 1.5 },
          { unexpected: true },
          null,
        ]) {
          try {
            await window.teachshelf.saveWebsiteBackground(input);
            outcomes.push(false);
          } catch {
            outcomes.push(true);
          }
        }
        return outcomes;
      });
      assert.deepEqual(rejected, Array(6).fill(true));
      assert.deepEqual((await status()).preferences, before.preferences);
    },
  );
  await check(
    'A real 30-second background timer creates review rows with zero downloads and byte-identical JSON',
    async () => {
      await background().getByLabel('巡检间隔（分钟）', { exact: true }).fill('5');
      await background().getByRole('button', { name: '保存巡检间隔', exact: true }).click();
      await until(status, (value) => value.preferences.intervalMinutes === 5);
      const before = await fs.readFile(path.join(libraryRoot, 'library.json'));
      const initialReads = (await counters()).reads;
      enabledAt = Date.now();
      await toggle(true);
      assert.ok((await status()).nextCheckAt >= enabledAt + 29_000);
      await closeDialog('教学网站');
      console.log('WAIT real background timer: at least 30 seconds');
      // Observe public events: polling status() could trigger readiness reevaluation at the
      // deadline and accidentally mask a broken timer.
      const result = await until(
        () => page.evaluate(() => window.__backgroundEvents.at(-1)),
        (value) => value?.phase === 'review',
        65000,
      );
      assert.ok(Date.now() - enabledAt >= 29_000);
      assert.equal(result.review.rows.length, 2);
      assert.equal((await counters()).downloads, 0);
      assert.ok((await counters()).reads > initialReads);
      assert.deepEqual(await fs.readFile(path.join(libraryRoot, 'library.json')), before);
      const s = await snapshot();
      assert.equal(s.state.materials.length, 0);
      assert.equal(s.state.tasks.length, 0);
      await page.getByRole('button', { name: /审核网站更新/ }).waitFor();
      await page.screenshot({ path: path.join(evidence, 'teachshell-background-ready.png') });
    },
  );
  await check(
    'Status-bar handoff reuses the same review; closing and reopening do not recheck or download',
    async () => {
      const before = await status(),
        count = await counters();
      await page.getByRole('button', { name: /审核网站更新/ }).click();
      website = page.getByRole('dialog', { name: '教学网站', exact: true });
      batch = page.getByRole('dialog', { name: '教学网站批量更新审核', exact: true });
      await batch.locator('.batch-row').nth(1).waitFor();
      assert.equal((await status()).review.id, before.review.id);
      assert.deepEqual(await counters(), count);
      await closeDialog('教学网站批量更新审核');
      assert.equal((await status()).review.id, before.review.id);
      await background()
        .getByRole('button', { name: /^审核发现的更新/ })
        .click();
      await batch.locator('.batch-row').nth(1).waitFor();
      assert.deepEqual(await counters(), count);
      await page.screenshot({ path: path.join(evidence, 'teachshell-background-review.png') });
    },
  );
  await check(
    'Explicit review selection is the first download and commits one linked assignment',
    async () => {
      await batch.getByRole('button', { name: '应用所选更新', exact: true }).click();
      const result = await until(
        snapshot,
        (value) => value.state.materials.length === 1 && value.state.tasks.length === 1,
      );
      assert.equal((await counters()).downloads, 1);
      assert.deepEqual(result.state.tasks[0].materialIDs, [result.state.materials[0].id]);
      assert.equal(
        await fs.readFile(path.join(libraryRoot, result.state.materials[0].storedPath), 'utf8'),
        '后台审核后才下载的正文\n',
      );
      await until(status, (value) => !value.review);
      await closeDialog('教学网站批量更新审核');
    },
  );
  await check(
    'Foreground check takes over a running real timer without concurrent hidden readers or writes',
    async () => {
      await toggle(false);
      await fixture({ holdNextCourse: true, maxHidden: 0 });
      await toggle(true);
      await closeDialog('教学网站');
      console.log('WAIT second real timer before foreground takeover');
      await until(counters, (value) => value.held === 1, 65000);
      assert.equal((await status()).phase, 'checking');
      const before = await fs.readFile(path.join(libraryRoot, 'library.json'));
      await page.locator('[data-toolbar-action="update"]').click();
      website = page.getByRole('dialog', { name: '教学网站', exact: true });
      batch = page.getByRole('dialog', { name: '教学网站批量更新审核', exact: true });
      await batch.getByRole('button', { name: '检查网站更新', exact: true }).click();
      await batch.locator('.batch-row').first().waitFor({ timeout: 15000 });
      await app.evaluate(() => globalThis.__backgroundFixture.releaseHeld?.());
      assert.ok((await counters()).maxHidden <= 1);
      assert.equal((await counters()).downloads, 1);
      assert.deepEqual(await fs.readFile(path.join(libraryRoot, 'library.json')), before);
      assert.equal((await snapshot()).state.tasks.length, 1);
      await batch.getByRole('button', { name: '丢弃当前审核', exact: true }).click();
      await until(status, (value) => !value.review);
      await closeDialog('教学网站批量更新审核');
    },
  );
  await check(
    'Turning off a newly scheduled timer prevents all reads after its real due time',
    async () => {
      await toggle(false);
      await toggle(true);
      await toggle(false);
      const before = await counters();
      await closeDialog('教学网站');
      console.log('WAIT 31 seconds with background polling disabled');
      await delay(31_000);
      assert.deepEqual(await counters(), before);
      assert.equal((await status()).phase, 'disabled');
      assert.equal((await status()).preferences.intervalMinutes, 5);
    },
  );
  await check(
    'Restart retains preferences and switching real libraries keeps independent settings',
    async () => {
      await app.close();
      await launch();
      assert.deepEqual((await status()).preferences, { enabled: false, intervalMinutes: 5 });
      async function switchLibrary(target) {
        await page.keyboard.press(process.platform === 'darwin' ? 'Meta+,' : 'Control+,');
        await app.evaluate(({ dialog }, target) => {
          dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] });
        }, target);
        await page.getByRole('button', { name: '打开 Desktop 资料库…', exact: true }).click();
        await until(
          async () => {
            try {
              return await snapshot();
            } catch (error) {
              if (/资料库正在切换或关闭/.test(String(error))) return null;
              throw error;
            }
          },
          (value) => value?.root === target,
        );
      }
      await switchLibrary(otherRoot);
      assert.deepEqual((await status()).preferences, { enabled: false, intervalMinutes: 30 });
      await page.evaluate(() => window.teachshelf.saveWebsiteBackground({ intervalMinutes: 17 }));
      await switchLibrary(libraryRoot);
      assert.deepEqual((await status()).preferences, { enabled: false, intervalMinutes: 5 });
      await switchLibrary(otherRoot);
      assert.deepEqual((await status()).preferences, { enabled: false, intervalMinutes: 17 });
    },
  );
  await check('No renderer error, warning or framework overlay', async () => {
    assert.deepEqual(errors, []);
    assert.deepEqual(warnings, []);
    assert.equal(await page.locator('vite-error-overlay').count(), 0);
  });
  await fs.writeFile(
    path.join(evidence, 'teachshell-background-e2e.json'),
    JSON.stringify(
      {
        platform: process.platform,
        viewport: await page.evaluate(() => ({ width: innerWidth, height: innerHeight })),
        browser: 'Browser plugin not available; Playwright Electron',
        steps,
        errors,
        warnings,
      },
      null,
      2,
    ),
  );
  console.log(`PASS ${steps.length} background UI checks; evidence: ${evidence}`);
} catch (error) {
  if (page && !page.isClosed())
    await page
      .screenshot({ path: path.join(evidence, 'teachshell-background-failure.png') })
      .catch(() => {});
  await fs.writeFile(
    path.join(evidence, 'teachshell-background-e2e.json'),
    JSON.stringify({ steps, errors, warnings, error: String(error) }, null, 2),
  );
  throw error;
} finally {
  await app?.evaluate(() => globalThis.__backgroundFixture?.releaseHeld?.()).catch(() => {});
  await app?.close().catch(() => {});
  await fs.rm(root, { recursive: true, force: true });
}
