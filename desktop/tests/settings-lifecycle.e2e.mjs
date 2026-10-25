/** Exercise real renderer, IPC, secure persistence and loopback MCP with isolated data. */
import { _electron } from 'playwright';
import electronPath from 'electron';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Repository } from '../electron/services/storage/repository.ts';
const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const executable = process.env.TEACHSHELF_EXECUTABLE;
if (executable && !path.isAbsolute(executable)) throw new Error('Expected absolute executable');
const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'teachshell-settings-')));
const evidence = process.env.TEACHSHELF_SCREENSHOT_DIR ?? os.tmpdir();
await fs.mkdir(evidence, { recursive: true });
let app, page;
const steps = [],
  errors = [];
async function check(name, action) {
  await action();
  steps.push(name);
  console.log('PASS', name);
}
async function idle() {
  await page.waitForFunction(() => !document.querySelector('.statusbar .spinning'));
}
async function holdReply(method) {
  await app.evaluate(({ ipcMain }, method) => {
    const name = 'teachshelf:' + method,
      original = ipcMain._invokeHandlers.get(name);
    globalThis.settingsHeld = false;
    ipcMain.removeHandler(name);
    ipcMain.handle(name, async (...args) => {
      ipcMain.removeHandler(name);
      ipcMain.handle(name, original);
      const result = await original(...args);
      globalThis.settingsHeld = true;
      await new Promise((resolve) => {
        globalThis.settingsRelease = resolve;
      });
      return result;
    });
  }, method);
}
async function held() {
  for (let i = 0; i < 200; i++) {
    if (await app.evaluate(() => globalThis.settingsHeld)) return;
    await page.waitForTimeout(20);
  }
  throw new Error('IPC did not reach reply barrier');
}
async function openSettings(tab = 'AI 助手') {
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+,' : 'Control+,');
  await page.getByRole('tab', { name: tab, exact: true }).click();
}
async function port() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const value = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return value;
}
async function save(input) {
  return page.evaluate((input) => window.teachshelf.saveSettings(input), input);
}
async function settings() {
  return page.evaluate(() => window.teachshelf.settings());
}
async function ping(config) {
  const response = await fetch(`http://127.0.0.1:${config.port}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${config.token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).result, {});
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
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.waitForSelector('.app-body');
  await idle();
  assert.match(page.url(), /index\.html$/);
}
try {
  await launch();
  await check(
    'Unconfigured chat send shortcut preserves the composer without creating a message',
    async () => {
      await page.locator('.sidebar').getByRole('button', { name: 'AI 助手', exact: true }).click();
      await idle();
      const composer = page.getByLabel('给 AI 助手的消息', { exact: true });
      await composer.fill('尚未配置模型时保留的输入');
      await composer.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter');
      assert.equal(await composer.inputValue(), '尚未配置模型时保留的输入');
      assert.deepEqual(await page.evaluate(() => window.teachshelf.chatHistory()), []);
    },
  );
  await check('Settings fields remain disabled until their initial values arrive', async () => {
    await holdReply('settings');
    await openSettings();
    await held();
    for (const label of ['API 基础地址', '模型名称', 'API 密钥'])
      assert.equal(await page.getByLabel(label, { exact: true }).isDisabled(), true);
    await app.evaluate(() => globalThis.settingsRelease());
    await idle();
    assert.equal(await page.getByLabel('模型名称', { exact: true }).isEnabled(), true);
  });
  await check(
    'Settings drafts guard navigation and window close; cancel keeps all inputs',
    async () => {
      await page.getByLabel('模型名称', { exact: true }).fill('未保存模型');
      assert.equal(
        await page.evaluate(() => {
          const event = new Event('beforeunload', { cancelable: true });
          window.dispatchEvent(event);
          return event.defaultPrevented;
        }),
        true,
      );
      await page.locator('.sidebar').getByRole('button', { name: '全部资料', exact: true }).click();
      await page
        .getByRole('dialog', { name: '丢弃未保存的设置？', exact: true })
        .getByRole('button', { name: '取消', exact: true })
        .click();
      assert.equal(await page.getByLabel('模型名称', { exact: true }).inputValue(), '未保存模型');
    },
  );
  await check(
    'Saving AI settings preserves continued model and secret drafts without persisting them',
    async () => {
      await page.getByLabel('API 基础地址', { exact: true }).fill('http://127.0.0.1:12345/v1/');
      await page.getByLabel('模型名称', { exact: true }).fill('submitted-model');
      await holdReply('saveSettings');
      await page.getByRole('button', { name: '保存模型设置', exact: true }).click();
      await held();
      await page.getByLabel('模型名称', { exact: true }).fill('continued-model');
      await page.getByLabel('API 密钥', { exact: true }).fill('synthetic-unsaved-secret');
      await app.evaluate(() => globalThis.settingsRelease());
      await idle();
      assert.equal(
        await page.getByLabel('模型名称', { exact: true }).inputValue(),
        'continued-model',
      );
      assert.equal(
        await page.getByLabel('API 密钥', { exact: true }).inputValue(),
        'synthetic-unsaved-secret',
      );
      assert.equal(
        await page.getByLabel('API 基础地址', { exact: true }).inputValue(),
        'http://127.0.0.1:12345/v1',
      );
      assert.equal((await settings()).ai.model, 'submitted-model');
      const stored = await fs.readFile(path.join(root, 'app-data/desktop-settings.json'), 'utf8');
      assert.ok(
        !stored.includes('continued-model') && !stored.includes('synthetic-unsaved-secret'),
      );
      await page.locator('.sidebar').getByRole('button', { name: '全部资料', exact: true }).click();
      await page
        .getByRole('dialog', { name: '丢弃未保存的设置？', exact: true })
        .getByRole('button', { name: '丢弃修改', exact: true })
        .click();
      await page.locator('.settings-workspace').waitFor({ state: 'hidden' });
    },
  );
  const firstPort = await port();
  await save({ mcpEnabled: true, mcpPort: firstPort });
  await app.evaluate(async () => {
    const { Server } = process.getBuiltinModule('node:net');
    const original = Server.prototype.listen;
    globalThis.settingsListenCalls = 0;
    Server.prototype.listen = function (...args) {
      globalThis.settingsListenCalls++;
      return original.apply(this, args);
    };
  });
  await check('AI and unchanged MCP saves keep the running MCP listener intact', async () => {
    await save({ model: 'new-model' });
    await save({ mcpEnabled: true, mcpPort: firstPort });
    assert.equal(await app.evaluate(() => globalThis.settingsListenCalls), 0);
    await ping((await settings()).mcp);
  });
  await check(
    'Occupied MCP port rolls back the complete settings transaction and restores service',
    async () => {
      const occupied = net.createServer();
      await new Promise((resolve) => occupied.listen(0, '127.0.0.1', resolve));
      try {
        const before = await settings();
        const bytes = await fs.readFile(path.join(root, 'app-data/desktop-settings.json'));
        await assert.rejects(
          save({ model: 'must-not-persist', mcpPort: occupied.address().port }),
          /MCP.*失败/,
        );
        assert.deepEqual(await settings(), before);
        assert.deepEqual(
          await fs.readFile(path.join(root, 'app-data/desktop-settings.json')),
          bytes,
        );
        await ping(before.mcp);
      } finally {
        await new Promise((resolve) => occupied.close(resolve));
      }
    },
  );
  await check(
    'Disk commit failure restores the original MCP listener and keeps settings bytes',
    async () => {
      const nextPort = await port(),
        before = await settings();
      const bytes = await fs.readFile(path.join(root, 'app-data/desktop-settings.json'));
      await app.evaluate(async () => {
        const fs = process.getBuiltinModule('node:fs/promises'),
          original = fs.rename;
        fs.rename = async function (from, to) {
          if (String(to).endsWith('desktop-settings.json')) {
            fs.rename = original;
            throw new Error('injected settings disk failure');
          }
          return original(from, to);
        };
      });
      await assert.rejects(save({ mcpPort: nextPort }), /injected settings disk failure/);
      assert.deepEqual(await settings(), before);
      assert.deepEqual(await fs.readFile(path.join(root, 'app-data/desktop-settings.json')), bytes);
      await ping(before.mcp);
    },
  );
  await check(
    'Concurrent MCP changes serialize restart and persistence in request order',
    async () => {
      const a = await port(),
        b = await port();
      const results = await page.evaluate(
        async ([a, b]) =>
          Promise.all([
            window.teachshelf.saveSettings({ mcpPort: a }),
            window.teachshelf.saveSettings({ mcpPort: b }),
          ]),
        [a, b],
      );
      assert.equal(results[0].mcp.port, a);
      assert.equal(results[1].mcp.port, b);
      assert.equal((await settings()).mcp.port, b);
      await ping((await settings()).mcp);
    },
  );
  await save({ mcpEnabled: false });
  await check('Settings render and save cleanly at minimum window size', async () => {
    await openSettings('MCP');
    await idle();
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setBounds({ width: 1020, height: 680 }),
    );
    await page.getByRole('button', { name: '保存 MCP 设置', exact: true }).click();
    await idle();
    assert.equal(
      await page.evaluate(() => {
        const event = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(event);
        return event.defaultPrevented;
      }),
      false,
    );
    assert.equal(await page.locator('[role=dialog]').count(), 0);
    await page.screenshot({ path: path.join(evidence, 'teachshell-settings-minimum.png') });
    await page.getByRole('tab', { name: 'AI 助手', exact: true }).click();
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setBounds({ width: 1300, height: 900 }),
    );
    await page.screenshot({ path: path.join(evidence, 'teachshell-settings-desktop.png') });
  });
  await check(
    'Concurrent library opens choose one owner after asynchronous path resolution',
    async () => {
      const roots = [path.join(root, 'library-a'), path.join(root, 'library-b')];
      for (const target of roots) {
        const repo = await Repository.open(target, { create: true });
        await repo.createCourse({ name: path.basename(target) });
        await repo.close();
      }
      await app.evaluate(({ dialog }, roots) => {
        const fs = process.getBuiltinModule('node:fs/promises'),
          original = fs.realpath;
        const waiting = [];
        fs.realpath = async function (target, ...args) {
          const result = await original(target, ...args);
          if (roots.includes(String(target))) {
            await new Promise((resolve) => {
              waiting.push(resolve);
              if (waiting.length === 2) {
                fs.realpath = original;
                for (const release of waiting) release();
              }
            });
          }
          return result;
        };
        let count = 0;
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [roots[count++]] });
      }, roots);
      const results = await page.evaluate(() =>
        Promise.allSettled([window.teachshelf.openLibrary(), window.teachshelf.openLibrary()]),
      );
      assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
      assert.equal(results.filter((r) => r.status === 'rejected').length, 1);
      const current = await page.evaluate(() => window.teachshelf.snapshot());
      assert.ok(roots.includes(current.root));
      assert.equal(current.state.courses[0].name, path.basename(current.root));
      await page.getByRole('heading', { name: '全部资料', exact: true }).waitFor();
      const changed = await page.evaluate(() =>
        window.teachshelf.createCourse({ name: '切库后写入验证' }),
      );
      assert.equal(changed.root, current.root);
      assert.equal(changed.state.courses.length, 2);
      const other = JSON.parse(
        await fs.readFile(
          path.join(
            roots.find((r) => r !== current.root),
            'library.json',
          ),
          'utf8',
        ),
      );
      assert.equal(other.courses.length, 1);
    },
  );
  await check(
    'Startup port conflicts show actual MCP status and saving unchanged settings retries',
    async () => {
      const retryPort = await port();
      await save({ mcpEnabled: true, mcpPort: retryPort });
      await app.evaluate(({ app }) => app.quit());
      await app.close();
      app = undefined;
      const occupied = net.createServer();
      await new Promise((resolve) => occupied.listen(retryPort, '127.0.0.1', resolve));
      try {
        await launch();
        assert.equal((await settings()).mcp.enabled, true);
        assert.equal((await settings()).mcp.running, false);
        await openSettings('MCP');
        await idle();
        assert.match(await page.locator('.service-state').textContent(), /服务未启动/);
      } finally {
        await new Promise((resolve) => occupied.close(resolve));
      }
      await page.getByRole('button', { name: '保存 MCP 设置', exact: true }).click();
      await idle();
      assert.equal((await settings()).mcp.running, true);
      assert.match(await page.locator('.service-state').textContent(), /服务已启用/);
      await ping((await settings()).mcp);
    },
  );
  assert.deepEqual(errors, []);
  await fs.writeFile(
    path.join(evidence, 'teachshell-settings-lifecycle.json'),
    JSON.stringify({ steps, rendererErrors: errors, packaged: !!executable }, null, 2),
  );
  console.log(JSON.stringify({ passed: steps.length, rendererErrors: errors.length }));
} finally {
  if (app) {
    await app
      .evaluate(({ app, dialog }) => {
        globalThis.settingsRelease?.();
        dialog.showMessageBoxSync = () => 1;
        app.quit();
      })
      .catch(() => {});
    await app.close().catch(() => {});
  }
  await fs.rm(root, { recursive: true, force: true });
}
