/** Actual application main/preload/renderer login settings; no real account or website access. */
import { _electron } from 'playwright';
import electronPath from 'electron';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const executable = process.env.TEACHSHELF_EXECUTABLE;
if (executable && !path.isAbsolute(executable))
  throw new Error('TEACHSHELF_EXECUTABLE must be absolute');
const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'teachshell-login-ui-')));
const evidence = process.env.TEACHSHELF_SCREENSHOT_DIR ?? os.tmpdir();
await fs.mkdir(evidence, { recursive: true });
const runKind = executable ? 'packaged' : 'source';
const helper = executable
  ? path.join(path.dirname(path.dirname(executable)), 'Resources', 'teaching-session-keychain')
  : path.join(desktop, 'dist-electron', 'teaching-session-keychain');
const profiles = new Set();
let app,
  page,
  completedPreferenceWrites = 0,
  secureStorageAvailable = true;
async function normalQuit() {
  const running = app;
  const closed = running.waitForEvent('close');
  await running
    .evaluate(({ app }) => app.quit())
    .catch((error) => {
      if (!/closed|destroyed/i.test(String(error))) throw error;
    });
  await closed;
  app = undefined;
}
async function waitRememberComplete(enabled) {
  // Chromium can report the checkbox's new value before its change event reaches the main process.
  // Observe completion of the real IPC write; do not infer persistence from checked/disabled alone.
  const deadline = Date.now() + 15000;
  let completed = false;
  while (Date.now() < deadline) {
    const count = await app.evaluate(() => globalThis.loginPreferenceWrites);
    if (count > completedPreferenceWrites) {
      completedPreferenceWrites = count;
      completed = true;
      break;
    }
    await page.waitForTimeout(20);
  }
  assert.equal(completed, true, 'The checkbox must complete a real login preference IPC write');
  await page.waitForFunction((value) => {
    const checkbox = document.querySelector('.website-login input');
    return checkbox && !checkbox.disabled && checkbox.checked === value;
  }, enabled);
}
async function cookieView(scope) {
  return app.evaluate(
    async ({ session }, scope) =>
      (await session.fromPartition('teachshelf-' + scope + '-teaching').cookies.get({})).map(
        (c) => ({
          name: c.name,
          value: c.value,
          secure: c.secure,
          httpOnly: c.httpOnly,
          session: c.session,
        }),
      ),
    scope,
  );
}
async function installOfficialFixture(scope) {
  await app.evaluate(async ({ session }, scope) => {
    const isolated = session.fromPartition('teachshelf-' + scope + '-teaching');
    await isolated.protocol.handle('https', (request) => {
      const url = new URL(request.url);
      if (url.hostname !== 'selearning.nju.edu.cn')
        return new Response('Fixture only', { status: 403 });
      return new Response(
        '<!doctype html><html><title>Synthetic teaching login</title><body><nav class="usermenu"><a href="https://selearning.nju.edu.cn/user/profile.php?id=99">Synthetic test user</a></nav><h1>合成登录验收课程</h1><main id="region-main"><div class="course-content"><section class="section" data-sectionid="1"><h3 class="sectionname">验收</h3><a href="https://selearning.nju.edu.cn/mod/folder/view.php?id=91"><span class="instancename">测试资料</span></a></section></div></main></body></html>',
        { headers: { 'content-type': 'text/html; charset=utf-8' } },
      );
    });
  }, scope);
}
async function authenticateFromUI(dialog) {
  await dialog
    .getByLabel('页面地址', { exact: true })
    .fill('https://selearning.nju.edu.cn/course/view.php?id=17');
  await dialog.getByRole('button', { name: '打开登录窗口', exact: true }).click();
  await dialog.getByRole('button', { name: '读取当前页面', exact: true }).click();
  await page.waitForFunction(() =>
    window.teachshelf
      .websiteLoginStatus()
      .then((s) => s.loginState === 'signedIn' && s.accountID === '99'),
  );
}
const errors = [],
  steps = [];
async function check(name, action) {
  await action();
  steps.push(name);
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
  page.on('pageerror', (e) => errors.push(e.message));
  await page.waitForSelector('.app-body');
  completedPreferenceWrites = 0;
  await app.evaluate(({ ipcMain }) => {
    const channel = 'teachshelf:rememberWebsiteLogin',
      original = ipcMain._invokeHandlers.get(channel);
    if (!original) throw new Error('Missing login preference IPC handler');
    globalThis.loginPreferenceWrites = 0;
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, async (...args) => {
      try {
        return await original(...args);
      } finally {
        if (typeof args[1] === 'boolean') globalThis.loginPreferenceWrites++;
      }
    });
  });
}
async function website() {
  await page
    .locator('.titlebar-actions')
    .getByRole('button', { name: '打开设置', exact: true })
    .click();
  await page.getByRole('tab', { name: '资料库', exact: true }).click();
  await page.getByRole('button', { name: '打开教学网站工具', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '教学网站', exact: true });
  await dialog.getByLabel('记住此资料库的教学网站登录', { exact: true }).waitFor();
  return dialog;
}
async function switched(destination) {
  await app.evaluate(({ dialog }, destination) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [destination] });
  }, destination);
  await page.evaluate(() => window.teachshelf.openLibrary());
  await page.waitForFunction(
    (destination) => window.teachshelf.snapshot().then((s) => s.root === destination),
    destination,
  );
}
try {
  await launch();
  let dialog;
  const first = await page.evaluate(() => window.teachshelf.snapshot());
  const a = first.root,
    b = path.join(root, 'SecondLibrary'),
    scopeA = createHash('sha256').update(a).digest('hex').slice(0, 16),
    scopeB = createHash('sha256').update(b).digest('hex').slice(0, 16);
  profiles.add(scopeA);
  profiles.add(scopeB);
  await fs.mkdir(b);
  await fs.copyFile(path.join(a, 'library.json'), path.join(b, 'library.json'));
  await fs.copyFile(
    path.join(a, '.teachshelf-electron.json'),
    path.join(b, '.teachshelf-electron.json'),
  );
  await fs.cp(path.join(a, 'files'), path.join(b, 'files'), { recursive: true });
  await check('Default-off login UI and strict boolean IPC validation', async () => {
    dialog = await website();
    assert.equal(
      await dialog.getByLabel('记住此资料库的教学网站登录', { exact: true }).isChecked(),
      false,
    );
    for (const value of ['true', 1, null, {}, ['true']]) {
      const rejected = await page.evaluate(async (value) => {
        try {
          await window.teachshelf.rememberWebsiteLogin(value);
          return false;
        } catch {
          return true;
        }
      }, value);
      assert.equal(rejected, true);
    }
    assert.equal(
      (await page.evaluate(() => window.teachshelf.websiteLoginStatus())).enabled,
      false,
    );
    await dialog.getByLabel('记住此资料库的教学网站登录', { exact: true }).check();
    await waitRememberComplete(true);
    await page.waitForFunction(() => window.teachshelf.websiteLoginStatus().then((s) => s.enabled));
  });
  await check(
    'Library switching clears the old memory session and isolates remembered preferences',
    async () => {
      await app.evaluate(async ({ session }, scope) => {
        await session.fromPartition('teachshelf-' + scope + '-teaching').cookies.set({
          url: 'https://selearning.nju.edu.cn',
          name: 'MoodleSession',
          value: 'synthetic-unverified-cookie',
          path: '/',
        });
      }, scopeA);
      await switched(b);
      await dialog.waitFor({ state: 'hidden' });
      const counts = await app.evaluate(
        async ({ session }, scopes) =>
          Promise.all(
            scopes.map(
              async (scope) =>
                (await session.fromPartition('teachshelf-' + scope + '-teaching').cookies.get({}))
                  .length,
            ),
          ),
        [scopeA, scopeB],
      );
      assert.deepEqual(counts, [0, 0]);
      dialog = await website();
      assert.equal(
        await dialog.getByLabel('记住此资料库的教学网站登录', { exact: true }).isChecked(),
        false,
      );
      await switched(a);
      await dialog.waitFor({ state: 'hidden' });
      dialog = await website();
      await page.waitForFunction(() =>
        window.teachshelf.websiteLoginStatus().then((s) => s.enabled),
      );
      assert.equal(
        await dialog.getByLabel('记住此资料库的教学网站登录', { exact: true }).isChecked(),
        true,
      );
      assert.equal(
        await app.evaluate(
          async ({ session }, scope) =>
            (await session.fromPartition('teachshelf-' + scope + '-teaching').cookies.get({}))
              .length,
          scopeA,
        ),
        0,
      );
    },
  );
  await check(
    'A restart retains the opt-in preference and never saves unverified anonymous cookies',
    async () => {
      await app.close();
      app = undefined;
      await launch();
      dialog = await website();
      await page.waitForFunction(() =>
        window.teachshelf.websiteLoginStatus().then((s) => s.enabled),
      );
      assert.equal(
        await dialog.getByLabel('记住此资料库的教学网站登录', { exact: true }).isChecked(),
        true,
      );
      assert.equal(
        (await page.evaluate(() => window.teachshelf.websiteLoginStatus())).accountID,
        undefined,
      );
      assert.equal(
        await app.evaluate(
          async ({ session }, scope) =>
            (await session.fromPartition('teachshelf-' + scope + '-teaching').cookies.get({}))
              .length,
          scopeA,
        ),
        0,
      );
      await dialog.getByLabel('记住此资料库的教学网站登录', { exact: true }).uncheck();
      await waitRememberComplete(false);
      await page.waitForFunction(() =>
        window.teachshelf.websiteLoginStatus().then((s) => !s.enabled),
      );
    },
  );
  await check('Disabled preference persists on the next actual application launch', async () => {
    await app.close();
    app = undefined;
    await launch();
    dialog = await website();
    assert.equal(
      await dialog.getByLabel('记住此资料库的教学网站登录', { exact: true }).isChecked(),
      false,
    );
    assert.equal(
      (await page.evaluate(() => window.teachshelf.websiteLoginStatus())).enabled,
      false,
    );
  });
  await check(
    'Authenticated UI opt-in uses the application default helper and normal quit flushes a rotated synthetic session',
    async () => {
      if (process.platform === 'darwin') await fs.access(helper, fs.constants.X_OK);
      await installOfficialFixture(scopeA);
      await app.evaluate(async ({ session }, scope) => {
        const jar = session.fromPartition('teachshelf-' + scope + '-teaching').cookies;
        for (const c of [
          {
            url: 'https://selearning.nju.edu.cn',
            name: 'MoodleSession',
            value: 'synthetic-before-quit',
            domain: 'selearning.nju.edu.cn',
            path: '/',
            httpOnly: true,
          },
          {
            url: 'https://selearning.nju.edu.cn',
            name: 'MoodleSession_suffix',
            value: 'synthetic-expiring',
            domain: '.selearning.nju.edu.cn',
            path: '/',
            httpOnly: true,
            expirationDate: Date.now() / 1000 + 86400,
          },
          {
            url: 'https://selearning.nju.edu.cn',
            name: 'MOODLEID1_',
            value: 'synthetic-username',
            path: '/',
          },
          {
            url: 'https://authserver.nju.edu.cn',
            name: 'CASTGC',
            value: 'synthetic-cas-excluded',
            path: '/',
          },
          {
            url: 'https://selearning.nju.edu.cn',
            name: 'password',
            value: 'synthetic-password-excluded',
            path: '/',
          },
        ])
          await jar.set(c);
      }, scopeA);
      await authenticateFromUI(dialog);
      await dialog.getByLabel('记住此资料库的教学网站登录', { exact: true }).check();
      await waitRememberComplete(true);
      const status = await page.evaluate(() => window.teachshelf.websiteLoginStatus());
      if (process.platform === 'linux' && status.hasIssue) {
        assert.match(status.status, /basic_text|安全密钥存储/);
        secureStorageAvailable = false;
        await dialog.getByLabel('记住此资料库的教学网站登录', { exact: true }).uncheck();
        await waitRememberComplete(false);
        console.log(
          'Linux secure backend unavailable: persistence refused; authenticated restoration branch requires a working OS keyring',
        );
        return;
      }
      assert.equal(status.hasIssue, false, status.status);
      assert.match(status.status, /已加密/);
      // No helper path override or explicit flush: exercise packaged defaults and normal quit hooks.
      await app.evaluate(async ({ session }, scope) => {
        await session.fromPartition('teachshelf-' + scope + '-teaching').cookies.set({
          url: 'https://selearning.nju.edu.cn',
          name: 'MoodleSession',
          value: 'synthetic-rotated-at-normal-quit',
          domain: 'selearning.nju.edu.cn',
          path: '/',
          httpOnly: true,
        });
      }, scopeA);
      // Linux has no noninteractive safeStorage API; its documented path requires an explicit retry.
      if (process.platform === 'linux') {
        await dialog.getByRole('button', { name: '重试安全存储', exact: true }).click();
        await page.waitForFunction(() =>
          window.teachshelf.websiteLoginStatus().then((s) => !s.hasIssue),
        );
      }
      await normalQuit();
      await launch();
      dialog = await website();
      if (process.platform === 'linux') {
        await dialog.getByRole('button', { name: '重试安全存储', exact: true }).click();
        await page.waitForFunction(() =>
          window.teachshelf.websiteLoginStatus().then((s) => !s.hasIssue),
        );
      }
      const restoredStatus = await page.evaluate(() => window.teachshelf.websiteLoginStatus());
      assert.equal(restoredStatus.enabled, true);
      assert.equal(restoredStatus.hasIssue, false, restoredStatus.status);
      assert.equal(restoredStatus.accountID, undefined);
      assert.equal(restoredStatus.loginState, 'unknown');
      assert.equal(restoredStatus.canProbe, true);
      const restored = await cookieView(scopeA);
      assert.deepEqual(restored.map((c) => c.name).sort(), [
        'MoodleSession',
        'MoodleSession_suffix',
      ]);
      assert.ok(restored.every((c) => c.secure && c.httpOnly));
      assert.equal(restored.find((c) => c.name === 'MoodleSession').session, true);
      assert.equal(
        restored.find((c) => c.name === 'MoodleSession').value,
        'synthetic-rotated-at-normal-quit',
      );
      await page.screenshot({
        path: path.join(evidence, 'teachshell-login-restored-' + runKind + '.png'),
      });
    },
  );
  await check(
    'Restored cookies remain unverified until the real parser runs; disabling clears default secure storage across restart',
    async () => {
      if (secureStorageAvailable) {
        await installOfficialFixture(scopeA);
        await authenticateFromUI(dialog);
        const status = await page.evaluate(() => window.teachshelf.websiteLoginStatus());
        assert.equal(status.accountID, '99');
        assert.equal(status.canProbe, false);
        await dialog.getByLabel('记住此资料库的教学网站登录', { exact: true }).uncheck();
        await waitRememberComplete(false);
        await page.waitForFunction(() =>
          window.teachshelf.websiteLoginStatus().then((s) => !s.enabled),
        );
        const disabled = await page.evaluate(() => window.teachshelf.websiteLoginStatus());
        assert.equal(disabled.hasIssue, false, disabled.status);
        const preference = JSON.parse(
          await fs.readFile(
            path.join(root, 'app-data', 'TeachingSessions', scopeA + '.preferences.json'),
            'utf8',
          ),
        );
        assert.equal(preference.enabled, false, 'Disabling must persist before reporting success');
        assert.equal(preference.cleanupPending, undefined, 'Secure-store deletion must complete');
        assert.equal((await cookieView(scopeA)).length, 2);
      }
      await normalQuit();
      await launch();
      dialog = await website();
      assert.equal(
        (await page.evaluate(() => window.teachshelf.websiteLoginStatus())).enabled,
        false,
      );
      assert.deepEqual(await cookieView(scopeA), []);
      if (process.platform === 'darwin') {
        const record = JSON.parse(
          execFileSync(helper, [], {
            input: JSON.stringify({ operation: 'read', profile: scopeA, allowInteraction: false }),
            encoding: 'utf8',
          }),
        );
        assert.equal(record.ok, true);
        assert.equal(
          record.data === undefined,
          true,
          'Disabling must remove the synthetic secure-store record',
        );
      }
    },
  );
  await check(
    'Clicking disable and quitting immediately completes the authorized secure-store deletion',
    async () => {
      if (!secureStorageAvailable) return;
      await installOfficialFixture(scopeA);
      await app.evaluate(
        async ({ session }, scope) =>
          session.fromPartition('teachshelf-' + scope + '-teaching').cookies.set({
            url: 'https://selearning.nju.edu.cn',
            name: 'MoodleSession',
            value: 'synthetic-close-race',
            path: '/',
            httpOnly: true,
          }),
        scopeA,
      );
      await authenticateFromUI(dialog);
      await dialog.getByLabel('记住此资料库的教学网站登录', { exact: true }).check();
      await waitRememberComplete(true);
      assert.equal(
        (await page.evaluate(() => window.teachshelf.websiteLoginStatus())).hasIssue,
        false,
      );
      if (process.platform === 'darwin')
        await app.evaluate((_electron, scope) => {
          const childProcess = process.getBuiltinModule('node:child_process'),
            spawn = childProcess.spawn;
          childProcess.spawn = function (...args) {
            const child = spawn.apply(this, args);
            if (String(args[0]).endsWith('teaching-session-keychain')) {
              const end = child.stdin.end.bind(child.stdin);
              child.stdin.end = function (chunk, ...rest) {
                let request;
                try {
                  request = JSON.parse(String(chunk));
                } catch {}
                if (request?.operation === 'remove' && request.profile === scope) {
                  // Keep the real default helper and Security API; delay only delivery to expose the close race.
                  globalThis.__loginRemoveStarted = true;
                  setTimeout(() => end(chunk, ...rest), 150);
                  return this;
                }
                return end(chunk, ...rest);
              };
            }
            return child;
          };
        }, scopeA);
      await dialog.getByLabel('记住此资料库的教学网站登录', { exact: true }).uncheck();
      // Wait only until the request starts, deliberately not until the UI's busy state clears.
      await page.waitForFunction(() =>
        window.teachshelf.websiteLoginStatus().then((s) => !s.enabled),
      );
      if (process.platform === 'darwin') {
        for (
          let n = 0;
          n < 100 && !(await app.evaluate(() => globalThis.__loginRemoveStarted));
          n++
        )
          await new Promise((r) => setTimeout(r, 2));
        assert.equal(await app.evaluate(() => globalThis.__loginRemoveStarted), true);
        assert.equal(
          await dialog.getByLabel('记住此资料库的教学网站登录', { exact: true }).isDisabled(),
          true,
        );
      }
      await normalQuit();
      if (process.platform === 'darwin') {
        const record = JSON.parse(
          execFileSync(helper, [], {
            input: JSON.stringify({ operation: 'read', profile: scopeA, allowInteraction: false }),
            encoding: 'utf8',
          }),
        );
        assert.equal(record.ok, true);
        assert.equal(
          record.data === undefined,
          true,
          'Immediate normal quit must finish authorized deletion',
        );
      }
      const preference = JSON.parse(
        await fs.readFile(
          path.join(root, 'app-data', 'TeachingSessions', scopeA + '.preferences.json'),
          'utf8',
        ),
      );
      assert.equal(preference.enabled, false);
      assert.equal(preference.cleanupPending, undefined);
      await launch();
      dialog = await website();
      assert.equal(
        (await page.evaluate(() => window.teachshelf.websiteLoginStatus())).enabled,
        false,
      );
      assert.deepEqual(await cookieView(scopeA), []);
    },
  );
  assert.deepEqual(errors, []);
  const report = {
    passed: steps.length,
    rendererErrors: errors.length,
    mode: runKind,
    secureStorageAvailable,
    steps,
  };
  await fs.writeFile(
    path.join(evidence, 'teachshell-login-ui-' + runKind + '.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(
    JSON.stringify({
      passed: steps.length,
      rendererErrors: errors.length,
      mode: runKind,
      secureStorageAvailable,
    }),
  );
} finally {
  if (app) {
    await page?.evaluate(() => window.teachshelf.rememberWebsiteLogin(false)).catch(() => {});
    await app.close();
  }
  if (process.platform === 'darwin')
    for (const profile of profiles) {
      const cleared = JSON.parse(
        execFileSync(helper, [], {
          input: JSON.stringify({ operation: 'remove', profile, allowInteraction: false }),
          encoding: 'utf8',
        }),
      );
      assert.equal(cleared.ok, true, 'Temporary keychain profile cleanup must succeed');
    }
  await fs.rm(root, { recursive: true, force: true });
}
