import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadBridgeConfig, runBridge } from '../electron/services/mcp/stdio.ts';
import { MCPServer, newMCPToken } from '../electron/services/mcp/server.ts';
test('stdio forwards real initialize and notifications with no credential output', async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'teachshelf-stdio-')));
  const file = path.join(root, 'config.json'),
    token = newMCPToken(),
    server = new MCPServer();
  let output = '',
    errors = '';
  try {
    const port = await server.start({
      port: 0,
      token,
      tools: {
        definitions: [],
        execute() {
          throw new Error('not used');
        },
      },
    });
    await fs.writeFile(file, JSON.stringify({ mcpEnabled: true, mcpPort: port, mcpToken: token }), {
      mode: 0o600,
    });
    const messages = [
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'test', version: '1' },
        },
      },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'ping' },
    ];
    const raw = Buffer.from(messages.map((m) => JSON.stringify(m)).join('\n'));
    async function* input() {
      yield raw.subarray(0, 7);
      yield raw.subarray(7);
    }
    await runBridge(
      file,
      input(),
      (s) => (output += s),
      (s) => (errors += s),
    );
    const lines = output
      .trim()
      .split('\n')
      .map((s) => JSON.parse(s));
    assert.equal(lines.length, 2);
    assert.equal(lines[0].result.protocolVersion, '2025-06-18');
    assert.equal(lines[1].id, 2);
    assert.equal(errors, '');
    assert.ok(!output.includes(token));
  } finally {
    await server.stop();
    await fs.rm(root, { recursive: true, force: true });
  }
});
test('stdio config denies unsafe permissions and emits only RPC error for failed requests', async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'teachshelf-stdio-'))),
    file = path.join(root, 'config.json');
  try {
    await fs.writeFile(
      file,
      JSON.stringify({ enabled: false, port: 53142, token: newMCPToken() }),
      { mode: 0o600 },
    );
    assert.equal((await loadBridgeConfig(file)).enabled, false);
    let output = '',
      errors = '';
    async function* input() {
      yield Buffer.from(
        '{"jsonrpc":"2.0","id":4,"method":"ping"}\n{"jsonrpc":"2.0","method":"notifications/initialized"}\n',
      );
    }
    await runBridge(
      file,
      input(),
      (s) => (output += s),
      (s) => (errors += s),
    );
    assert.equal(JSON.parse(output).id, 4);
    assert.equal(JSON.parse(output).error.code, -32000);
    assert.ok(errors);
    if (process.platform !== 'win32') {
      await fs.chmod(file, 0o644);
      await assert.rejects(loadBridgeConfig(file), /0600/);
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
