/** Real Chromium cookie jars and the production platform secret store, with synthetic accounts only. */
import { _electron } from 'playwright';
import electronPath from 'electron';
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'teachshell-login-e2e-')));
const profile = 'test-' + randomUUID(),
  otherProfile = profile + '-other',
  userData = path.join(root, 'UserData');
const helper = path.join(root, 'teaching-session-keychain');
let app;
async function launch() {
  app = await _electron.launch({
    executablePath: electronPath,
    args: [path.join(root, 'main.cjs')],
    cwd: desktop,
    timeout: 30000,
  });
  await app.firstWindow();
  await app.evaluate(() =>
    Promise.all([globalThis.reader.prepareLogin(), globalThis.reader.prepareLogin()]),
  );
}
async function fixture() {
  await app.evaluate(async ({ session }) => {
    await session
      .fromPartition(globalThis.reader.partition('teaching'))
      .protocol.handle('https', (request) => {
        const u = new URL(request.url);
        if (u.hostname !== 'selearning.nju.edu.cn') return new Response('blocked', { status: 403 });
        return new Response(
          '<!doctype html><html><title>Fixture</title><body><nav class="usermenu"><a href="https://selearning.nju.edu.cn/user/profile.php?id=99">Synthetic user</a></nav><h1>Fixture course</h1><main id="region-main"><div class="course-content"><section class="section" data-sectionid="1"><h3 class="sectionname">Test</h3><a href="https://selearning.nju.edu.cn/mod/folder/view.php?id=1"><span class="instancename">Fixture</span></a></section></div></main></body></html>',
          { headers: { 'content-type': 'text/html' } },
        );
      });
  });
}
async function stop() {
  if (app) {
    await app.evaluate(() => globalThis.reader.close()).catch(() => {});
    await app.close();
    app = undefined;
  }
}
try {
  if (process.platform === 'darwin')
    execFileSync(
      'swiftc',
      [
        '-swift-version',
        '5',
        '-O',
        '-module-cache-path',
        path.join(root, 'ModuleCache'),
        path.join(desktop, 'electron/services/website/native/TeachingSessionKeychain.swift'),
        '-o',
        helper,
      ],
      { stdio: 'pipe' },
    );
  await fs.mkdir(path.join(userData, 'Partitions', 'teachshelf-' + profile + '-teaching'), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(userData, 'Partitions', 'teachshelf-' + profile + '-teaching', 'Cookies'),
    'obsolete synthetic cookies',
  );
  await fs.mkdir(path.join(userData, 'Partitions', 'teachshelf-' + otherProfile + '-teaching'), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(userData, 'Partitions', 'teachshelf-' + otherProfile + '-teaching', 'Cookies'),
    'unrelated profile',
  );
  await build({
    entryPoints: [path.join(desktop, 'electron/services/website/browser.ts')],
    outfile: path.join(root, 'browser.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['electron'],
  });
  await fs.writeFile(
    path.join(root, 'main.cjs'),
    `const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(userData)});app.whenReady().then(()=>{global.profile=${JSON.stringify(profile)};global.Browser=require(${JSON.stringify(path.join(root, 'browser.cjs'))}).WebsiteBrowser;global.scripts=${JSON.stringify(path.join(desktop, 'electron/services/website/scripts'))};global.options={keychainHelper:${JSON.stringify(helper)}};global.reader=new global.Browser(global.scripts,global.profile,global.options);const w=new BrowserWindow({show:false});w.loadURL('about:blank');});`,
  );
  await launch();
  await assert.rejects(
    fs.stat(path.join(userData, 'Partitions', 'teachshelf-' + profile + '-teaching')),
    { code: 'ENOENT' },
  );
  assert.equal(
    await fs.readFile(
      path.join(userData, 'Partitions', 'teachshelf-' + otherProfile + '-teaching', 'Cookies'),
      'utf8',
    ),
    'unrelated profile',
  );
  assert.equal(await app.evaluate(() => globalThis.reader.loginStatus().enabled), false);
  assert.equal(
    await app.evaluate(() => globalThis.reader.partition('teaching').startsWith('persist:')),
    false,
  );
  await fixture();
  await app.evaluate(async ({ session }) => {
    const jar = session.fromPartition(globalThis.reader.partition('teaching')).cookies;
    for (const c of [
      {
        name: 'MoodleSession',
        value: 'synthetic-session-cookie',
        url: 'https://selearning.nju.edu.cn',
        domain: 'selearning.nju.edu.cn',
        path: '/',
        httpOnly: true,
        secure: false,
      },
      {
        name: 'MoodleSession_suffix',
        value: 'synthetic-expiring-cookie',
        url: 'https://selearning.nju.edu.cn',
        domain: '.selearning.nju.edu.cn',
        path: '/',
        httpOnly: true,
        expirationDate: Date.now() / 1000 + 86400,
      },
      {
        name: 'MOODLEID1_',
        value: 'synthetic-username',
        url: 'https://selearning.nju.edu.cn',
        path: '/',
      },
      {
        name: 'CASTGC',
        value: 'synthetic-cas-ticket',
        url: 'https://authserver.nju.edu.cn',
        path: '/',
      },
      {
        name: 'password',
        value: 'synthetic-never-save',
        url: 'https://selearning.nju.edu.cn',
        path: '/',
      },
    ])
      await jar.set(c);
    await globalThis.reader.open('https://selearning.nju.edu.cn/course/view.php?id=17', 'teaching');
    await globalThis.reader.inspect('teaching');
    await globalThis.reader.flushLogin();
  });
  const initial = await app.evaluate(() => globalThis.reader.loginStatus());
  assert.equal(initial.loginState, 'signedIn');
  assert.equal(initial.accountID, '99');
  const remembered = await app.evaluate(() => globalThis.reader.setRememberLogin(true));
  if (process.platform === 'linux' && remembered.hasIssue) {
    assert.match(remembered.status, /basic_text|安全密钥存储/);
    await assert.rejects(fs.stat(path.join(userData, 'TeachingSessions', profile + '.encrypted')), {
      code: 'ENOENT',
    });
    await app.evaluate(() => globalThis.reader.setRememberLogin(false));
    await stop();
    await launch();
    assert.equal(
      await app.evaluate(
        async ({ session }) =>
          (await session.fromPartition(globalThis.reader.partition('teaching')).cookies.get({}))
            .length,
      ),
      0,
    );
    console.log(
      'PASS actual Electron: unsafe/unavailable Linux keyring refuses persistence; no plaintext fallback or restart cookies',
    );
  } else {
    assert.equal(remembered.hasIssue, false, remembered.status);
    await app.evaluate(() => globalThis.reader.flushLogin());
    const pref = await fs.readFile(
      path.join(userData, 'TeachingSessions', profile + '.preferences.json'),
      'utf8',
    );
    assert.equal(JSON.parse(pref).enabled, true);
    assert.ok(!pref.includes('synthetic-'));
    await stop();
    await launch();
    const restored = await app.evaluate(async ({ session }) => ({
      status: globalThis.reader.loginStatus(),
      cookies: (
        await session.fromPartition(globalThis.reader.partition('teaching')).cookies.get({})
      ).map((c) => ({ name: c.name, secure: c.secure, httpOnly: c.httpOnly, session: c.session })),
    }));
    // Linux intentionally requires a user retry because Electron cannot suppress keyring prompts.
    if (process.platform === 'linux') {
      assert.equal(restored.status.hasIssue, true);
      await app.evaluate(() => globalThis.reader.retryLogin());
      restored.cookies = await app.evaluate(async ({ session }) =>
        (await session.fromPartition(globalThis.reader.partition('teaching')).cookies.get({})).map(
          (c) => ({ name: c.name, secure: c.secure, httpOnly: c.httpOnly, session: c.session }),
        ),
      );
      restored.status = await app.evaluate(() => globalThis.reader.loginStatus());
    }
    assert.deepEqual(restored.cookies.map((c) => c.name).sort(), [
      'MoodleSession',
      'MoodleSession_suffix',
    ]);
    assert.ok(restored.cookies.every((c) => c.secure && c.httpOnly));
    assert.equal(restored.cookies.find((c) => c.name === 'MoodleSession').session, true);
    assert.equal(restored.status.canProbe, true);
    assert.equal(restored.status.accountID, undefined);
    assert.equal(restored.status.loginState, 'unknown');
    await app.evaluate(async ({ session }) => {
      const other = new globalThis.Browser(
        globalThis.scripts,
        globalThis.profile + '-isolated',
        globalThis.options,
      );
      await other.prepareLogin();
      globalThis.otherCount = (
        await session.fromPartition(other.partition('teaching')).cookies.get({})
      ).length;
      await other.close();
    });
    assert.equal(await app.evaluate(() => globalThis.otherCount), 0);
    const raced = await app.evaluate(async ({ session }) => {
      const reader = new globalThis.Browser(
        globalThis.scripts,
        globalThis.profile + '-race',
        globalThis.options,
      );
      const preparing = reader.prepareLogin(),
        first = reader.close(),
        second = reader.close();
      const same = first === second;
      const outcome = await Promise.allSettled([preparing, first, second]);
      let rejected = false;
      try {
        await reader.open('https://selearning.nju.edu.cn/course/view.php?id=17', 'teaching');
      } catch {
        rejected = true;
      }
      return {
        same,
        prepare: outcome[0].status,
        rejected,
        cookies: (await session.fromPartition(reader.partition('teaching')).cookies.get({})).length,
      };
    });
    assert.deepEqual(raced, { same: true, prepare: 'rejected', rejected: true, cookies: 0 });
    await app.evaluate(() => globalThis.reader.setRememberLogin(false));
    assert.equal(
      await app.evaluate(
        async ({ session }) =>
          (await session.fromPartition(globalThis.reader.partition('teaching')).cookies.get({}))
            .length,
      ),
      2,
    );
    await stop();
    await launch();
    assert.equal(
      await app.evaluate(
        async ({ session }) =>
          (await session.fromPartition(globalThis.reader.partition('teaching')).cookies.get({}))
            .length,
      ),
      0,
    );
    assert.equal(await app.evaluate(() => globalThis.reader.loginStatus().enabled), false);
    if (process.platform === 'darwin') {
      const faultProfile = profile + '-pending';
      await fs.writeFile(
        path.join(userData, 'TeachingSessions', faultProfile + '.preferences.json'),
        JSON.stringify({ version: 1, enabled: false, cleanupPending: true }),
      );
      const retried = await app.evaluate(async (_electron, profile) => {
        const cp = process.getBuiltinModule('node:child_process'),
          original = cp.spawn;
        let fail = true;
        cp.spawn = function (...args) {
          const child = original.apply(this, args);
          if (String(args[0]).endsWith('teaching-session-keychain')) {
            const end = child.stdin.end.bind(child.stdin);
            child.stdin.end = function (chunk, ...rest) {
              let request;
              try {
                request = JSON.parse(String(chunk));
              } catch {}
              if (fail && request?.operation === 'remove' && request.profile === profile)
                return end(JSON.stringify({ ...request, profile: 'invalid profile' }), ...rest);
              return end(chunk, ...rest);
            };
          }
          return child;
        };
        const browser = new globalThis.Browser(globalThis.scripts, profile, globalThis.options);
        try {
          await browser.prepareLogin();
          const before = browser.loginStatus();
          fail = false;
          const after = await browser.retryLogin();
          return { before, after };
        } finally {
          await browser.close();
          cp.spawn = original;
        }
      }, faultProfile);
      assert.equal(retried.before.hasIssue, true);
      assert.match(retried.before.status, /未能清除/);
      assert.equal(retried.after.hasIssue, false);
      assert.equal(retried.after.enabled, false);
      console.log(
        'PASS actual Electron cleanup failure warning clears after successful secure-store retry',
      );
    }
    console.log(
      'PASS actual Electron: default-off, no persistent partition, scoped legacy cleanup, authenticated opt-in, secret retention across restart, Moodle-only HTTPS cookie restore, profile isolation, disable without logout, disabled restart',
    );
  }
} finally {
  if (app) await app.evaluate(() => globalThis.reader.setRememberLogin(false)).catch(() => {});
  await stop();
  if (process.platform === 'darwin')
    try {
      execFileSync(helper, [], {
        input: JSON.stringify({ operation: 'remove', profile, allowInteraction: false }),
        stdio: ['pipe', 'ignore', 'ignore'],
      });
    } catch {}
  await fs.rm(root, { recursive: true, force: true });
}
