import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { MCPServer, newMCPToken, rpcResponse } from '../electron/services/mcp/server.ts';
import {
  selectTools,
  swiftToolCatalog,
  validateArguments,
} from '../electron/services/mcp/tools.ts';
const definition = selectTools(['teachshelf_list_courses']);
const tools = {
  definitions: definition,
  execute: () => ({ courses: [], library_id: 'local', library_revision: 'revision' }),
};
const request = (method: string, params?: unknown, id: unknown = 1) => ({
  jsonrpc: '2.0',
  id,
  method,
  ...(params === undefined ? {} : { params }),
});
async function running() {
  const server = new MCPServer(),
    token = newMCPToken(),
    port = await server.start({ port: 0, token, tools });
  return { server, token, port, url: `http://127.0.0.1:${port}/mcp` };
}
async function raw(port: number, body: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(port, '127.0.0.1');
    let result = '';
    socket.setTimeout(3000, () => socket.destroy(new Error('timeout')));
    socket.on('connect', () => socket.end(body));
    socket.on('data', (chunk) => (result += chunk));
    socket.on('end', () => resolve(result));
    socket.on('error', reject);
  });
}

test('Swift catalog has exactly 25 unique tools and 14 guarded writes', () => {
  assert.equal(swiftToolCatalog.length, 25);
  assert.equal(new Set(swiftToolCatalog.map((t) => t.name)).size, 25);
  assert.equal(swiftToolCatalog.filter((t) => !t.annotations?.readOnlyHint).length, 14);
  assert.throws(() => selectTools(['execute_shell']));
  assert.throws(() => selectTools(['teachshelf_context', 'teachshelf_context']));
});
test('schema validates types, limits and unknown fields without implicit HTTP coercion', () => {
  const schema = definition[0].inputSchema;
  assert.doesNotThrow(() => validateArguments({ limit: 20, archived: false }, schema));
  for (const value of [
    { limit: true },
    { limit: '20' },
    { limit: 101 },
    { offset: -1 },
    { archived: 'false' },
    { unknown: 1 },
    [],
  ])
    assert.throws(() => validateArguments(value, schema));
});
test('protocol negotiates versions, limits capabilities and never executes notifications', async () => {
  const initialized: any = await rpcResponse(
    request('initialize', {
      protocolVersion: 'unknown',
      capabilities: {},
      clientInfo: { name: 'test' },
    }),
    tools,
  );
  assert.equal(initialized.result.protocolVersion, '2025-11-25');
  const list: any = await rpcResponse(request('tools/list'), tools);
  assert.deepEqual(
    list.result.tools.map((t: any) => t.name),
    ['teachshelf_list_courses'],
  );
  let called = false;
  assert.equal(
    await rpcResponse(
      { jsonrpc: '2.0', method: 'tools/call', params: { name: 'teachshelf_list_courses' } },
      {
        ...tools,
        execute: () => {
          called = true;
          return {};
        },
      },
    ),
    undefined,
  );
  assert.equal(called, false);
  assert.equal(
    ((await rpcResponse(request('tools/call', { name: 'teachshelf_delete_course' }), tools)) as any)
      .error.code,
    -32602,
  );
  assert.equal(
    ((await rpcResponse(request('ping', undefined, true), tools)) as any).error.code,
    -32600,
  );
  assert.equal(((await rpcResponse([], tools)) as any).error.code, -32600);
  assert.equal(
    ((await rpcResponse(request('tools/list', { cursor: 'bad' }), tools)) as any).error.code,
    -32602,
  );
  assert.equal(((await rpcResponse(request('unknown'), tools)) as any).error.code, -32601);
});
test('tool errors are JSON-RPC results and strict validation prevents execution', async () => {
  let called = 0;
  const strict = {
    ...tools,
    execute: () => {
      called++;
      return {};
    },
  };
  const bad: any = await rpcResponse(
    request('tools/call', { name: 'teachshelf_list_courses', arguments: { limit: '10' } }),
    strict,
  );
  assert.equal(bad.result.isError, true);
  assert.equal(called, 0);
  const good: any = await rpcResponse(
    request('tools/call', { name: 'teachshelf_list_courses', arguments: { limit: 10 } }),
    strict,
  );
  assert.equal(good.result.isError, false);
  assert.equal(called, 1);
  const stopped: any = await rpcResponse(
    request('tools/call', { name: 'teachshelf_list_courses' }),
    strict,
    () => false,
  );
  assert.equal(stopped.result.isError, true);
  assert.equal(called, 1);
});
test('real HTTP enforces authorization, origin, host, path, method and version', async () => {
  const { server, token, port, url } = await running();
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body = JSON.stringify(request('ping'));
  try {
    assert.equal(
      (await fetch(url, { method: 'POST', body, headers: { 'Content-Type': 'application/json' } }))
        .status,
      401,
    );
    assert.equal((await fetch(url, { method: 'POST', body, headers })).status, 200);
    assert.equal(
      (
        await fetch(url, {
          method: 'POST',
          body,
          headers: { ...headers, Origin: 'https://attacker.invalid' },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(url, {
          method: 'POST',
          body,
          headers: { ...headers, Origin: `http://127.0.0.1:${port}` },
        })
      ).status,
      200,
    );
    assert.match(
      await raw(
        port,
        `POST /mcp HTTP/1.1\r\nHost: attacker.invalid\r\nAuthorization: Bearer ${token}\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
      ),
      /403/,
    );
    assert.equal(
      (
        await fetch(url, {
          method: 'POST',
          body,
          headers: { ...headers, 'MCP-Protocol-Version': '2099-01-01' },
        })
      ).status,
      400,
    );
    assert.equal((await fetch(url, { headers })).status, 405);
    assert.equal((await fetch(url + '/bad', { method: 'POST', body, headers })).status, 404);
    assert.equal(
      (
        await fetch(url, {
          method: 'POST',
          body,
          headers: { ...headers, 'Content-Type': 'text/plain' },
        })
      ).status,
      415,
    );
    const notification = await fetch(url, {
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
      headers,
    });
    assert.equal(notification.status, 202);
    assert.equal(await notification.text(), '');
    const parse = await fetch(url, { method: 'POST', body: '{broken', headers });
    assert.equal((await parse.json()).error.code, -32700);
  } finally {
    await server.stop();
  }
  assert.equal(server.port, undefined);
});
test('HTTP rejects oversized, duplicate and chunked request framing', async () => {
  const { server, port, token } = await running();
  try {
    const base = `POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nAuthorization: Bearer ${token}\r\nContent-Type: application/json\r\n`;
    assert.match(await raw(port, base + 'Content-Length: 1048577\r\n\r\n'), /413/);
    assert.match(await raw(port, base + 'Content-Length: 2\r\nContent-Length: 2\r\n\r\n{}'), /400/);
    assert.match(await raw(port, base + 'Transfer-Encoding: chunked\r\n\r\n0\r\n\r\n'), /400/);
    assert.match(
      await raw(port, base + 'X-Test: a\r\nX-Test: b\r\nContent-Length: 2\r\n\r\n{}'),
      /400/,
    );
  } finally {
    await server.stop();
  }
});
test('stop drains active tool mutations before returning and permits restart', async () => {
  const server = new MCPServer(),
    token = newMCPToken();
  let release: () => void = () => {},
    started = false,
    completed = false;
  const port = await server.start({
    port: 0,
    token,
    tools: {
      definitions: definition,
      execute: async () => {
        started = true;
        await new Promise<void>((r) => (release = r));
        completed = true;
        return {};
      },
    },
  });
  const call = fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST',
    body: JSON.stringify(request('tools/call', { name: 'teachshelf_list_courses' })),
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  }).catch(() => {});
  for (let i = 0; i < 200 && !started; i++) await new Promise((r) => setTimeout(r, 5));
  assert.equal(started, true);
  let stopped = false;
  const stop = server.stop().then(() => (stopped = true));
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(stopped, false);
  release();
  await stop;
  await call;
  assert.equal(completed, true);
  await server.start({ port: 0, token, tools });
  await server.stop();
});

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Repository } from '../electron/services/storage/repository.ts';
import {
  createRepositoryTools,
  libraryRevision,
  planRevision,
} from '../electron/services/mcp/repository-tools.ts';
const identifier = () => randomUUID().toUpperCase();
async function fixture() {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'teachshelf-tools-'))),
    repo = await Repository.open(path.join(root, 'Library'), { create: true }),
    provider = createRepositoryTools(() => repo);
  return {
    root,
    repo,
    provider,
    cleanup: async () => {
      await repo.close();
      await fs.rm(root, { recursive: true, force: true });
    },
  };
}
async function context(provider: ReturnType<typeof createRepositoryTools>) {
  return (await provider.execute('teachshelf_context', {})) as any;
}
async function write(
  provider: ReturnType<typeof createRepositoryTools>,
  name: string,
  args: Record<string, unknown>,
) {
  const c = await context(provider);
  return (await provider.execute('teachshelf_' + name, {
    library_id: c.library_id,
    expected_library_revision: c.library_revision,
    ...args,
  })) as any;
}

test('idempotent container patches retain nested folder paths and material manual ordering', async () => {
  const f = await fixture();
  let repo = f.repo;
  try {
    await repo.createCourse({ name: '幂等课程' });
    const courseID = repo.state.courses[0].id;
    await repo.createFolder({ name: '父目录', courseID });
    const parentID = repo.state.materialFolders[0].id;
    await repo.createFolder({ name: '子目录', courseID, parentID });
    const folderID = repo.state.materialFolders[1].id;
    const source = path.join(f.root, '原件.txt');
    await fs.writeFile(source, '文件布局和排序必须保留');
    await repo.importFiles([source], { courseID, folderID });
    const materialID = repo.state.materials[0].id;
    const saved = repo.state;
    saved.materials[0].customOrder = 17;
    saved.materials[0].storageDirectory = path.posix.dirname(saved.materials[0].storedPath);
    await repo.close();
    await fs.writeFile(path.join(repo.root, 'library.json'), JSON.stringify(saved));
    repo = await Repository.open(repo.root);
    const provider = createRepositoryTools(() => repo);
    await repo.sync();
    const before = repo.state,
      filePath = await repo.resolveMaterial(materialID),
      stat = await fs.stat(filePath);
    const folderResult = await write(provider, 'update_material_folder', {
      id: folderID,
      patch: { course_id: courseID },
    });
    assert.equal(folderResult.changed, false);
    assert.equal(repo.state.materialFolders.find((v) => v.id === folderID)?.parentID, parentID);
    assert.deepEqual(repo.state.materialFolders, before.materialFolders);
    const moved = await write(provider, 'move_materials', {
      ids: [materialID],
      course_id: courseID,
      folder_id: folderID,
    });
    assert.equal(moved.changed, false);
    assert.deepEqual(repo.state.materials, before.materials);
    assert.equal(await repo.resolveMaterial(materialID), filePath);
    assert.equal((await fs.stat(filePath)).ino, stat.ino);
    assert.equal(await fs.readFile(filePath, 'utf8'), '文件布局和排序必须保留');
  } finally {
    await repo.close();
    await f.cleanup();
  }
});

test('folder metadata edits preserve observed storage paths while actual rename retains its parent', async () => {
  const f = await fixture();
  try {
    await f.repo.createCourse({ name: '元数据课程' });
    const courseID = f.repo.state.courses[0].id;
    await f.repo.createFolder({ name: '父目录', courseID });
    const parentID = f.repo.state.materialFolders[0].id;
    await f.repo.createFolder({ name: '子目录', courseID, parentID });
    const folderID = f.repo.state.materialFolders[1].id;
    await f.repo.sync();
    const before = f.repo.state.materialFolders.find((v) => v.id === folderID)!;
    assert.ok(before.storageDirectory);
    const physicalPath = path.join(f.repo.root, before.storageDirectory!),
      stat = await fs.stat(physicalPath);
    await fs.writeFile(path.join(physicalPath, '未索引.bin'), '保留');
    await write(f.provider, 'update_material_folder', {
      id: folderID,
      patch: { color_hex: '#336699' },
    });
    assert.equal(
      f.repo.state.materialFolders.find((v) => v.id === folderID)?.storageDirectory,
      before.storageDirectory,
    );
    assert.equal((await fs.stat(physicalPath)).ino, stat.ino);
    await write(f.provider, 'update_material_folder', { id: folderID, patch: { name: '重命名' } });
    const renamed = f.repo.state.materialFolders.find((v) => v.id === folderID)!;
    assert.equal(renamed.parentID, parentID);
    assert.equal(
      renamed.storageDirectory,
      path.posix.dirname(before.storageDirectory!) + '/重命名',
    );
    assert.equal(
      await fs.readFile(path.join(f.repo.root, renamed.storageDirectory!, '未索引.bin'), 'utf8'),
      '保留',
    );
    assert.equal((await fs.stat(path.join(f.repo.root, renamed.storageDirectory!))).ino, stat.ino);
  } finally {
    await f.cleanup();
  }
});

test('repository catalog exposes all 25 original Swift tool schemas including occurrence scopes', async () => {
  const f = await fixture();
  try {
    assert.equal(f.provider.definitions.length, 25);
    assert.ok(f.provider.definitions.some((t) => t.name === 'teachshelf_list_occurrences'));
    assert.deepEqual(
      f.provider.definitions.find((t) => t.name === 'teachshelf_update_plan')!.inputSchema
        .properties!.scope.enum,
      ['all', 'thisOccurrence', 'thisAndFuture'],
    );
    for (const definition of f.provider.definitions)
      assert.deepEqual(definition.inputSchema, selectTools([definition.name])[0].inputSchema);
  } finally {
    await f.cleanup();
  }
});
test('course/material/folder tools roundtrip metadata and physical operations without path disclosure', async () => {
  const f = await fixture();
  try {
    const courseID = identifier(),
      folderID = identifier();
    await write(f.provider, 'create_course', {
      request_id: courseID,
      fields: { name: '计算机', teacher: '陈老师', archived: true, color_hex: '#123456' },
    });
    assert.equal(f.repo.state.courses[0].isArchived, true);
    await write(f.provider, 'create_material_folder', {
      request_id: folderID,
      name: '第一章',
      course_id: courseID,
      color_hex: '#112233',
    });
    assert.equal(f.repo.state.materialFolders[0].colorHex, '#112233');
    const source = path.join(f.root, '讲义.txt');
    await fs.writeFile(source, '课程资料');
    await f.repo.importFiles([source], { courseID, folderID });
    const materialID = f.repo.state.materials[0].id;
    await write(f.provider, 'update_material', {
      id: materialID,
      patch: { title: '复习资料', filename: '新的讲义.txt', notes: '重点', favorite: true },
    });
    const detail: any = await f.provider.execute('teachshelf_get_material', { id: materialID });
    assert.equal(detail.material.filename, '新的讲义.txt');
    assert.equal(detail.material.notes, '重点');
    assert.ok(!JSON.stringify(detail).includes(f.root));
    assert.equal(await fs.readFile(await f.repo.resolveMaterial(materialID), 'utf8'), '课程资料');
    await write(f.provider, 'update_material_folder', {
      id: folderID,
      patch: { name: '考试复习', color_hex: null },
    });
    assert.equal(f.repo.state.materialFolders[0].colorHex, undefined);
    await write(f.provider, 'move_materials', {
      ids: [materialID],
      course_id: null,
      folder_id: null,
    });
    assert.equal(f.repo.state.materials[0].courseID, undefined);
    const retained = await f.repo.resolveMaterial(materialID);
    await write(f.provider, 'remove_materials', { ids: [materialID] });
    assert.equal(f.repo.state.materials.length, 0);
    assert.equal(await fs.readFile(retained, 'utf8'), '课程资料');
    await write(f.provider, 'delete_course', { id: courseID });
    assert.equal(f.repo.state.courses.length, 0);
    assert.equal(await fs.readFile(source, 'utf8'), '课程资料');
  } finally {
    await f.cleanup();
  }
});
test('stale revisions, wrong library and repeated identifiers never mutate', async () => {
  const f = await fixture();
  try {
    const before = await context(f.provider),
      id = identifier();
    await write(f.provider, 'create_course', { request_id: id, fields: { name: '数学' } });
    await assert.rejects(
      f.provider.execute('teachshelf_update_course', {
        library_id: before.library_id,
        expected_library_revision: before.library_revision,
        id,
        patch: { name: '过期编辑' },
      }),
      /revision_conflict/,
    );
    await assert.rejects(
      write(f.provider, 'create_course', { request_id: id, fields: { name: '重复' } }),
      /request_id/,
    );
    const c = await context(f.provider);
    await assert.rejects(
      f.provider.execute('teachshelf_delete_course', {
        library_id: 'wrong',
        expected_library_revision: c.library_revision,
        id,
      }),
      /资料库/,
    );
    assert.equal(f.repo.state.courses[0].name, '数学');
  } finally {
    await f.cleanup();
  }
});
test('library revisions ignore last-opened and UI preferences but retain notes and plan changes', async () => {
  const f = await fixture();
  try {
    const id = identifier();
    await f.repo.createCourse({ id, name: '课程' });
    const source = path.join(f.root, 'a.txt');
    await fs.writeFile(source, 'a');
    await f.repo.importFiles([source], { courseID: id });
    const original = f.repo.state,
      first = libraryRevision(original);
    const ui = structuredClone(original);
    ui.appearance = 'dark';
    ui.materials[0].lastOpenedAt = 42;
    assert.equal(libraryRevision(ui), first);
    ui.materials[0].notes = 'changed';
    assert.notEqual(libraryRevision(ui), first);
  } finally {
    await f.cleanup();
  }
});
test('ordinary plans support RFC3339 edits, statuses, conflict-safe undo and restart persistence', async () => {
  const f = await fixture();
  try {
    const lib = (await context(f.provider)).library_id,
      id = identifier();
    const created: any = await f.provider.execute('teachshelf_create_plan', {
      library_id: lib,
      request_id: id,
      fields: { title: '复习', deadline: '2026-10-25T20:00:00+08:00' },
    });
    assert.equal(created.changed, true);
    assert.equal(f.repo.state.tasks[0].hasExecutionTime, false);
    assert.equal(
      new Date((f.repo.state.tasks[0].deadline as number) * 1000 + 978307200000).toISOString(),
      '2026-10-25T12:00:00.000Z',
    );
    const first: any = await f.provider.execute('teachshelf_get_plan', { id });
    const edited: any = await f.provider.execute('teachshelf_update_plan', {
      library_id: lib,
      id,
      expected_revision: first.plan.revision,
      patch: {
        content: '完成习题',
        starts_at: '2026-10-25T18:00:00+08:00',
        ends_at: '2026-10-25T19:00:00+08:00',
      },
    });
    assert.equal(f.repo.state.tasks[0].hasExecutionTime, true);
    assert.ok(edited.change_id);
    await assert.rejects(
      f.provider.execute('teachshelf_update_plan', {
        library_id: lib,
        id,
        expected_revision: first.plan.revision,
        patch: { title: '旧内容' },
      }),
      /revision_conflict/,
    );
    await f.provider.execute('teachshelf_undo_change', {
      library_id: lib,
      change_id: edited.change_id,
    });
    assert.equal(f.repo.state.tasks[0].hasExecutionTime, false);
    assert.equal(f.repo.state.tasks[0].endsAt, undefined);
    const completed: any = await f.provider.execute('teachshelf_set_plan_status', {
      library_id: lib,
      id,
      expected_revision: planRevision(f.repo.state.tasks[0]),
      action: 'complete',
    });
    assert.ok(f.repo.state.tasks[0].completedAt);
    await f.provider.execute('teachshelf_undo_change', {
      library_id: lib,
      change_id: completed.change_id,
    });
    assert.equal(f.repo.state.tasks[0].completedAt, undefined);
    const removed: any = await f.provider.execute('teachshelf_delete_plan', {
      library_id: lib,
      id,
      expected_revision: planRevision(f.repo.state.tasks[0]),
    });
    assert.equal(f.repo.state.tasks.length, 0);
    await f.provider.execute('teachshelf_undo_change', {
      library_id: lib,
      change_id: removed.change_id,
    });
    assert.equal(f.repo.state.tasks[0].title, '复习');
    await assert.rejects(
      f.provider.execute('teachshelf_create_plan', {
        library_id: lib,
        request_id: identifier(),
        fields: { title: '坏日期', starts_at: '2026-02-31T10:00:00+08:00' },
      }),
      /无效日期/,
    );
    await assert.rejects(
      f.provider.execute('teachshelf_create_plan', {
        library_id: lib,
        request_id: identifier(),
        fields: { title: '重复', repeat_rule: { frequency: 'daily' } },
      }),
      /需要执行或截止时间/,
    );
    assert.equal(f.repo.state.tasks.length, 1);
    const persisted = f.repo.state.tasks[0];
    await f.repo.close();
    const reopened = await Repository.open(f.repo.root);
    try {
      assert.deepEqual(reopened.state.tasks[0], JSON.parse(JSON.stringify(persisted)));
      const freshProvider = createRepositoryTools(() => reopened),
        detail: any = await freshProvider.execute('teachshelf_get_plan', { id });
      assert.equal(detail.plan.title, '复习');
      assert.equal(detail.plan.revision, planRevision(persisted));
      await assert.rejects(
        freshProvider.execute('teachshelf_undo_change', {
          library_id: lib,
          change_id: removed.change_id,
        }),
        /过期/,
      );
    } finally {
      await reopened.close();
    }
  } finally {
    await f.cleanup();
  }
});
test('undo refuses later UI edits while fixed plans support guarded delete and restore', async () => {
  const f = await fixture();
  try {
    const lib = (await context(f.provider)).library_id,
      id = identifier();
    const created: any = await f.provider.execute('teachshelf_create_plan', {
      library_id: lib,
      request_id: id,
      fields: { title: '原计划' },
    });
    await f.repo.saveTask({ id, title: '界面改过' });
    await assert.rejects(
      f.provider.execute('teachshelf_undo_change', {
        library_id: lib,
        change_id: created.change_id,
      }),
      /不能撤销/,
    );
    const fixedID = identifier();
    await f.repo.savePlan({ id: fixedID, title: '固定计划', origin: 'fixed' });
    const removed: any = await f.provider.execute('teachshelf_delete_plan', {
      library_id: lib,
      id: fixedID,
      expected_revision: planRevision(f.repo.state.tasks.find((p) => p.id === fixedID)!),
    });
    assert.deepEqual(removed.deleted_ids, [fixedID]);
    await f.provider.execute('teachshelf_undo_change', {
      library_id: lib,
      change_id: removed.change_id,
    });
    assert.equal(f.repo.state.tasks.find((p) => p.id === fixedID)!.origin, 'fixed');
  } finally {
    await f.cleanup();
  }
});

async function weekly(
  f: Awaited<ReturnType<typeof fixture>>,
  fields: Record<string, unknown> = {},
) {
  const library_id = (await context(f.provider)).library_id,
    id = identifier();
  await f.provider.execute('teachshelf_create_plan', {
    library_id,
    request_id: id,
    fields: {
      title: '每周实验',
      starts_at: '2026-10-12T19:00:00+08:00',
      ends_at: '2026-10-12T20:00:00+08:00',
      deadline: '2026-10-16T23:59:00+08:00',
      repeat_rule: { frequency: 'weekly', until: '2026-11-30' },
      ...fields,
    },
  });
  return { id, library_id };
}
async function planWrite(
  f: Awaited<ReturnType<typeof fixture>>,
  name: string,
  id: string,
  args: Record<string, unknown>,
) {
  const c = await context(f.provider);
  return (await f.provider.execute('teachshelf_' + name, {
    library_id: c.library_id,
    id,
    expected_revision: planRevision(f.repo.state.tasks.find((p) => p.id === id)!),
    ...args,
  })) as any;
}

test('occurrence queries return execution and deadline DTOs with inclusive Shanghai days and parent revisions', async () => {
  const f = await fixture();
  try {
    const { id } = await weekly(f);
    const result: any = await f.provider.execute('teachshelf_list_occurrences', {
      from: '2026-10-12',
      to: '2026-10-23',
    });
    assert.equal(result.events.length, 4);
    assert.deepEqual(
      result.events.map((e: any) => [e.day, e.event_kind, e.original_date]),
      [
        ['2026-10-12', 'execution', '2026-10-12'],
        ['2026-10-16', 'deadline', '2026-10-12'],
        ['2026-10-19', 'execution', '2026-10-19'],
        ['2026-10-23', 'deadline', '2026-10-19'],
      ],
    );
    for (const event of result.events) {
      assert.equal(event.id, id);
      assert.equal(event.revision, planRevision(f.repo.state.tasks[0]));
      assert.equal(event.repeat_rule.interval, 1);
    }
    assert.equal(result.events[0].event_date, '2026-10-12T11:00:00.000Z');
    assert.equal(result.events[1].deadline, '2026-10-16T15:59:00.000Z');
    for (const args of [
      { from: '2026-10-01', to: '2026-11-01' },
      { from: '2026-10-02', to: '2026-10-01' },
      { from: '2026-02-30', to: '2026-03-01' },
    ])
      await assert.rejects(f.provider.execute('teachshelf_list_occurrences', args));
    await f.provider.execute('teachshelf_list_occurrences', {
      from: '2026-10-01',
      to: '2026-10-31',
    });
  } finally {
    await f.cleanup();
  }
});

test('single occurrence edits use the original anchor after moving execution and preserve inherited fields', async () => {
  const f = await fixture();
  try {
    const { id } = await weekly(f);
    const parentBefore = f.repo.state.tasks[0];
    await planWrite(f, 'update_plan', id, {
      scope: 'thisOccurrence',
      original_date: '2026-10-19',
      patch: {
        title: '临时实验',
        starts_at: '2026-10-20T20:00:00+08:00',
        ends_at: '2026-10-20T21:00:00+08:00',
        deadline: null,
        color_hex: '#123456',
      },
    });
    const effective: any = await f.provider.execute('teachshelf_get_plan', {
      id,
      original_date: '2026-10-19',
    });
    assert.equal(effective.plan.title, '临时实验');
    assert.equal(effective.plan.starts_at, '2026-10-20T12:00:00.000Z');
    assert.equal(effective.plan.deadline, null);
    assert.equal(effective.plan.original_date, '2026-10-19');
    assert.equal(effective.plan.revision, planRevision(f.repo.state.tasks[0]));
    assert.deepEqual(effective.plan.exception_dates, ['2026-10-19']);
    assert.equal(f.repo.state.tasks[0].title, parentBefore.title);
    await assert.rejects(
      f.provider.execute('teachshelf_get_plan', { id, original_date: '2026-10-20' }),
      /原始发生/,
    );
    await assert.rejects(
      planWrite(f, 'update_plan', id, {
        scope: 'thisOccurrence',
        original_date: '2026-10-19',
        patch: { origin: 'fixed' },
      }),
      /仅本次/,
    );
    await assert.rejects(
      planWrite(f, 'delete_plan', id, { scope: 'thisOccurrence' }),
      /original_date/,
    );
    await planWrite(f, 'update_plan', id, { patch: { content: '整组新正文' } });
    const updated: any = await f.provider.execute('teachshelf_get_plan', {
      id,
      original_date: '2026-10-19',
    });
    assert.equal(updated.plan.title, '临时实验');
    assert.equal(updated.plan.content, '整组新正文');
  } finally {
    await f.cleanup();
  }
});

test('this-and-future edits return both changed series and undo restores only those records with redo support', async () => {
  const f = await fixture();
  try {
    const { id, library_id } = await weekly(f);
    await planWrite(f, 'update_plan', id, {
      scope: 'thisOccurrence',
      original_date: '2026-10-26',
      patch: { title: '第三次例外' },
    });
    const original = JSON.parse(JSON.stringify(f.repo.state.tasks[0]));
    const split = await planWrite(f, 'update_plan', id, {
      scope: 'thisAndFuture',
      original_date: '2026-10-19',
      patch: { title: '未来系列', location: '新地点' },
    });
    assert.equal(split.plans.length, 2);
    assert.deepEqual(split.deleted_ids, []);
    const future = split.plans.find((p: any) => p.id !== id);
    assert.equal(future.title, '未来系列');
    assert.equal(split.plans.find((p: any) => p.id === id).repeat_rule.until, '2026-10-18');
    const later: any = await f.provider.execute('teachshelf_get_plan', {
      id: future.id,
      original_date: '2026-10-26',
    });
    assert.equal(later.plan.title, '第三次例外');
    const independent = identifier();
    await f.repo.savePlan({ id: independent, title: '后来创建的其他计划' });
    const undo: any = await f.provider.execute('teachshelf_undo_change', {
      library_id,
      change_id: split.change_id,
    });
    assert.deepEqual(undo.deleted_ids, [future.id]);
    assert.equal(undo.plans.length, 1);
    assert.deepEqual(
      f.repo.state.tasks.find((p) => p.id === id),
      original,
    );
    assert.equal(f.repo.state.tasks.find((p) => p.id === independent)!.title, '后来创建的其他计划');
    const redo: any = await f.provider.execute('teachshelf_undo_change', {
      library_id,
      change_id: undo.change_id,
    });
    assert.equal(redo.plans.length, 2);
    assert.ok(f.repo.state.tasks.some((p) => p.id === future.id));
    assert.equal(f.repo.state.tasks.find((p) => p.id === independent)!.title, '后来创建的其他计划');
  } finally {
    await f.cleanup();
  }
});

test('multi-series undo refuses a modified or removed split record and keeps every later change', async () => {
  for (const action of ['modify', 'delete']) {
    const f = await fixture();
    try {
      const { id, library_id } = await weekly(f),
        split = await planWrite(f, 'update_plan', id, {
          scope: 'thisAndFuture',
          original_date: '2026-10-19',
          patch: { title: '未来' },
        }),
        future = split.plans.find((p: any) => p.id !== id);
      if (action === 'modify') await f.repo.savePlan({ id: future.id, title: '用户后来改过' });
      else await f.repo.deletePlan(future.id);
      const before = f.repo.state;
      await assert.rejects(
        f.provider.execute('teachshelf_undo_change', { library_id, change_id: split.change_id }),
        /不能撤销/,
      );
      assert.deepEqual(f.repo.state, before);
    } finally {
      await f.cleanup();
    }
  }
});

test('delete scopes cancel one occurrence, truncate future series or remove the whole group and all are undoable', async () => {
  const f = await fixture();
  try {
    const { id, library_id } = await weekly(f);
    let removed = await planWrite(f, 'delete_plan', id, {
      scope: 'thisOccurrence',
      original_date: '2026-10-19',
    });
    assert.equal(removed.plans.length, 1);
    assert.deepEqual(removed.deleted_ids, []);
    assert.equal(
      (
        (await f.provider.execute('teachshelf_list_occurrences', {
          from: '2026-10-19',
          to: '2026-10-23',
        })) as any
      ).events.length,
      0,
    );
    await f.provider.execute('teachshelf_undo_change', {
      library_id,
      change_id: removed.change_id,
    });
    removed = await planWrite(f, 'delete_plan', id, {
      scope: 'thisAndFuture',
      original_date: '2026-10-19',
    });
    assert.equal(removed.plans[0].repeat_rule.until, '2026-10-18');
    await f.provider.execute('teachshelf_undo_change', {
      library_id,
      change_id: removed.change_id,
    });
    removed = await planWrite(f, 'delete_plan', id, { scope: 'all' });
    assert.deepEqual(removed.deleted_ids, [id]);
    assert.deepEqual(removed.plans, []);
    await f.provider.execute('teachshelf_undo_change', {
      library_id,
      change_id: removed.change_id,
    });
    assert.equal(f.repo.state.tasks.length, 1);
    assert.equal(f.repo.state.tasks[0].repeatRule!.until !== undefined, true);
  } finally {
    await f.cleanup();
  }
});

test('repeat statuses preserve individual edits and enforce supported scopes before mutation', async () => {
  const f = await fixture();
  try {
    const { id, library_id } = await weekly(f, { origin: 'fixed' });
    await planWrite(f, 'update_plan', id, {
      scope: 'thisOccurrence',
      original_date: '2026-10-19',
      patch: { location: '临时教室' },
    });
    for (const action of ['complete', 'cancel', 'restore'])
      await planWrite(f, 'set_plan_status', id, {
        action,
        scope: 'thisOccurrence',
        original_date: '2026-10-19',
      });
    const effective: any = await f.provider.execute('teachshelf_get_plan', {
      id,
      original_date: '2026-10-19',
    });
    assert.equal(effective.plan.location, '临时教室');
    assert.ok(effective.plan.completed_at);
    assert.equal(effective.plan.cancelled_at, null);
    const prior = f.repo.state;
    await assert.rejects(
      planWrite(f, 'set_plan_status', id, {
        action: 'complete',
        scope: 'thisAndFuture',
        original_date: '2026-10-19',
      }),
      /不支持/,
    );
    await assert.rejects(
      planWrite(f, 'set_plan_status', id, {
        action: 'archive',
        scope: 'thisOccurrence',
        original_date: '2026-10-19',
      }),
      /只支持整组/,
    );
    assert.deepEqual(f.repo.state, prior);
    const cancel = await planWrite(f, 'set_plan_status', id, {
      action: 'cancel',
      scope: 'thisAndFuture',
      original_date: '2026-10-19',
    });
    assert.equal(cancel.plans.length, 2);
    assert.ok(cancel.plans.find((p: any) => p.id !== id).cancelled_at);
    await f.provider.execute('teachshelf_undo_change', { library_id, change_id: cancel.change_id });
    assert.equal(f.repo.state.tasks.length, 1);
  } finally {
    await f.cleanup();
  }
});

test('undo baseline is captured inside the transaction and never includes an unrelated queued UI edit', async () => {
  const f = await fixture();
  try {
    const { id, library_id } = await weekly(f),
      other = identifier();
    await f.repo.savePlan({ id: other, title: '其他计划' });
    const originalGuard = f.repo.withMutationGuard.bind(f.repo);
    let inject = true;
    f.repo.withMutationGuard = async (guard, action) => {
      if (inject) {
        inject = false;
        await f.repo.savePlan({ id: other, title: '并发界面编辑' });
      }
      return originalGuard(guard, action);
    };
    const changed = await planWrite(f, 'update_plan', id, { patch: { title: 'MCP编辑' } });
    assert.deepEqual(
      changed.plans.map((p: any) => p.id),
      [id],
    );
    await f.provider.execute('teachshelf_undo_change', {
      library_id,
      change_id: changed.change_id,
    });
    assert.equal(f.repo.state.tasks.find((p) => p.id === other)!.title, '并发界面编辑');
    assert.equal(f.repo.state.tasks.find((p) => p.id === id)!.title, '每周实验');
  } finally {
    await f.cleanup();
  }
});
