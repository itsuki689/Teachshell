/** Actual application main/preload/renderer login settings; no real account or website access. */
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
const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'teachshell-login-ui-')));
let app, page;
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
}
async function website() {
  await page
    .locator('.titlebar-actions')
    .getByRole('button', { name: '打开设置', exact: true })
    .click();
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
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: steps.length, rendererErrors: errors.length }));
} finally {
  if (app) {
    await page?.evaluate(() => window.teachshelf.rememberWebsiteLogin(false)).catch(() => {});
    await app.close();
  }
  await fs.rm(root, { recursive: true, force: true });
}
