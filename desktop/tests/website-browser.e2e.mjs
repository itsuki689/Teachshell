/** Real Chromium/session transport; official HTTPS routes are intercepted with local fixtures. */
import { _electron } from 'playwright';
import electronPath from 'electron';
import { build } from 'esbuild';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'teaching-browser-e2e-')));
let app;
try {
  const bundled = path.join(root, 'browser.cjs');
  await build({
    entryPoints: [path.join(desktop, 'electron/services/website/browser.ts')],
    outfile: bundled,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['electron'],
  });
  const entry = path.join(root, 'main.cjs');
  await fs.writeFile(
    entry,
    `const {app,BrowserWindow}=require('electron');
    app.setPath('userData',${JSON.stringify(path.join(root, 'UserData'))});
    app.whenReady().then(()=>{global.reader=new (require(${JSON.stringify(bundled)}).WebsiteBrowser)(${JSON.stringify(path.join(desktop, 'electron/services/website/scripts'))},'test-batch');const w=new BrowserWindow({show:false});w.loadURL('about:blank');});`,
  );
  app = await _electron.launch({
    executablePath: electronPath,
    args: [entry],
    cwd: desktop,
    timeout: 30000,
  });
  await app.firstWindow();
  await app.evaluate(async ({ session, app }) => {
    globalThis.requests = [];
    globalThis.workerPreferences = [];
    app.on('browser-window-created', (_event, win) =>
      globalThis.workerPreferences.push(win.webContents.getLastWebPreferences()),
    );
    await session
      .fromPartition('persist:teachshelf-test-batch-teaching')
      .protocol.handle('https', (request) => {
        const url = new URL(request.url);
        globalThis.requests.push({ url: request.url, method: request.method });
        if (url.hostname !== 'selearning.nju.edu.cn')
          return new Response('blocked', { status: 403 });
        if (url.pathname.startsWith('/mod/resource/'))
          return new Response(null, {
            status: 302,
            headers: {
              location: globalThis.badRedirect
                ? 'https://evil.test/file'
                : 'https://selearning.nju.edu.cn/pluginfile.php/1/mod_resource/content/0/lecture.txt',
            },
          });
        if (url.pathname.startsWith('/pluginfile.php/'))
          return new Response(
            request.method === 'HEAD' ? null : 'attachment body must not be read',
            {
              headers: {
                'content-type': 'application/octet-stream',
                'content-disposition': 'attachment; filename="lecture.txt"',
              },
            },
          );
        const html =
          '<nav class="usermenu"><a href="https://selearning.nju.edu.cn/user/profile.php?id=99">用户</a></nav><h1>课程</h1><main id="region-main"><div class="course-content"><section class="section" data-sectionid="1"><h3 class="sectionname">资料</h3><a href="https://selearning.nju.edu.cn/mod/resource/view.php?id=11"><span class="instancename">讲义</span></a><img src="https://selearning.nju.edu.cn/pluginfile.php/1/mod_resource/content/0/lecture.txt"></section></div></main>';
        return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
      });
  });
  const course = await app.evaluate(async () =>
    globalThis.reader.readTeaching(
      'https://selearning.nju.edu.cn/course/view.php?id=42',
      { accountID: '99', courseID: '42' },
      new AbortController().signal,
    ),
  );
  assert.equal(course.data.accountID, '99');
  assert.equal(course.data.courseID, '42');
  assert.equal(course.data.activities[0].id, '11');
  const resource = await app.evaluate(async () =>
    globalThis.reader.readTeaching(
      'https://selearning.nju.edu.cn/mod/resource/view.php?id=11',
      { accountID: '99', courseID: '42' },
      new AbortController().signal,
    ),
  );
  assert.equal(resource.data.files[0].name, 'lecture.txt');
  const observed = await app.evaluate(({ BrowserWindow }) => ({
    requests: globalThis.requests,
    preferences: globalThis.workerPreferences,
    windows: BrowserWindow.getAllWindows().length,
  }));
  const downloads = observed.requests.filter((r) => r.url.includes('/pluginfile.php/'));
  assert.equal(downloads.length, 1);
  assert.equal(downloads[0].method, 'HEAD');
  assert.ok(observed.requests.some((r) => r.url.includes('/mod/resource/') && r.method === 'HEAD'));
  assert.equal(observed.windows, 1);
  assert.ok(observed.preferences.length > 0);
  for (const p of observed.preferences) {
    assert.equal(p.nodeIntegration, false);
    assert.equal(p.contextIsolation, true);
    assert.equal(p.sandbox, true);
    assert.ok(!p.preload);
  }
  console.log(
    'PASS actual Chromium course parser, worker isolation, blocked attachment GET and HEAD-only resource redirect',
  );
  const body = await app.evaluate(async () => {
    const response = await globalThis.reader.fetch(
      'https://selearning.nju.edu.cn/pluginfile.php/1/mod_resource/content/0/lecture.txt',
      { redirect: 'manual' },
    );
    return response.text();
  });
  assert.equal(body, 'attachment body must not be read');
  console.log('PASS explicit main-process download streams the selected response body');
  await app.evaluate(() => {
    globalThis.badRedirect = true;
  });
  await assert.rejects(
    app.evaluate(async () =>
      globalThis.reader.readTeaching(
        'https://selearning.nju.edu.cn/mod/resource/view.php?id=11',
        { accountID: '99', courseID: '42' },
        new AbortController().signal,
      ),
    ),
  );
  console.log('PASS actual session HEAD rejects off-origin redirects before fetching');
} finally {
  await app?.evaluate(() => globalThis.reader.close()).catch(() => {});
  await app?.close();
  await fs.rm(root, { recursive: true, force: true });
}
