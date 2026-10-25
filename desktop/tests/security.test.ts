import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  downloadFile,
  downloadURL,
  validateDownload,
} from '../electron/services/website/download.ts';
import { canOpenDocument } from '../electron/services/resource/openable.ts';
import { applyAIEndpoint } from '../electron/services/storage/settings-policy.ts';
import { trustedSender, materialPatch, taskInput } from '../electron/main/validation.ts';

const fileURL = 'https://selearning.nju.edu.cn/pluginfile.php/42/mod_folder/content/0/notes.txt';
async function temporary(run: (root: string) => Promise<void>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'teachshelf-security-'));
  try {
    await run(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

test('download URL only accepts supported official attachment routes', () => {
  assert.equal(downloadURL(fileURL).hostname, 'selearning.nju.edu.cn');
  for (const url of [
    fileURL.replace('https:', 'http:'),
    fileURL.replace('selearning.nju.edu.cn', 'selearning.nju.edu.cn.evil.test'),
    fileURL.replace('/pluginfile.php/', '/login/'),
    fileURL.replace('/mod_folder/content/', '/user/private/'),
    fileURL.replace('https://', 'https://user:pass@'),
    fileURL.replace('.edu.cn/', '.edu.cn:444/'),
  ])
    assert.throws(() => downloadURL(url));
});

test('HTML and XHTML MIME login responses are refused before a destination is created', async () => {
  await temporary(async (root) => {
    for (const type of ['text/html; charset=utf-8', 'application/xhtml+xml', 'TEXT/HTML']) {
      let cancelled = false;
      const response = new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(Buffer.from('<!-- login shell --> <head><title>登录</title></head>'));
          },
          cancel() {
            cancelled = true;
          },
        }),
        { headers: { 'content-type': type } },
      );
      const destination = path.join(root, 'notes.txt');
      await assert.rejects(
        downloadFile(async () => response, fileURL, destination, 'notes.txt'),
        /HTML/,
      );
      assert.equal(cancelled, true);
      await assert.rejects(fs.stat(destination), { code: 'ENOENT' });
    }
  });
});

test('cross-origin and unsupported redirects are blocked without fetching the target', async () => {
  await temporary(async (root) => {
    for (const location of [
      'https://evil.test/file.pdf',
      'https://selearning.nju.edu.cn/login/index.php',
      'http://selearning.nju.edu.cn/pluginfile.php/42/mod_folder/content/0/a.pdf',
    ]) {
      let calls = 0;
      const fetcher: typeof fetch = async (_url, init) => {
        calls++;
        assert.equal(init?.redirect, 'manual');
        return new Response('redirect', { status: 302, headers: { location } });
      };
      await assert.rejects(
        downloadFile(fetcher, fileURL, path.join(root, 'file.pdf'), 'file.pdf'),
        /下载地址/,
      );
      assert.equal(calls, 1);
    }
  });
});

test('download validation cleans incomplete files and never overwrites an existing destination', async () => {
  await temporary(async (root) => {
    const destination = path.join(root, 'file.pdf');
    await assert.rejects(
      downloadFile(
        async () => new Response('login html with wrong MIME'),
        fileURL,
        destination,
        'file.pdf',
      ),
      /PDF/,
    );
    await assert.rejects(fs.stat(destination), { code: 'ENOENT' });
    const data = '%PDF-1.7\nfixture';
    await downloadFile(
      async () => new Response(data, { headers: { 'content-type': 'application/pdf' } }),
      fileURL,
      destination,
      'file.pdf',
    );
    assert.equal(await fs.readFile(destination, 'utf8'), data);
    await assert.rejects(
      downloadFile(async () => new Response('%PDF-new'), fileURL, destination, 'file.pdf'),
      { code: 'EEXIST' },
    );
    assert.equal(await fs.readFile(destination, 'utf8'), data);
  });
  for (const [prefix, name] of [
    ['<html>登录', 'notes.txt'],
    ['invalid', 'slides.pptx'],
    ['invalid', 'archive.zip'],
  ])
    assert.throws(() => validateDownload(Buffer.from(prefix), prefix.length, name));
  assert.throws(() => validateDownload(Buffer.alloc(0), 0, 'empty.txt'));
  assert.throws(() => validateDownload(Buffer.from('ok'), 512 * 1024 * 1024 + 1, 'big.txt'));
});

test('opening files permits documents but denies executable and script OS handlers', () => {
  for (const filename of [
    '中文课件.PDF',
    'slides.pptx',
    'audio.mp3',
    'C:\\课程\\讲义.docx',
    '/课程/笔记.txt',
  ])
    assert.equal(canOpenDocument(filename), true, filename);
  for (const ext of [
    'app',
    'exe',
    'command',
    'scpt',
    'applescript',
    'workflow',
    'terminal',
    'hta',
    'wsf',
    'jse',
    'vbe',
    'cpl',
    'msc',
    'reg',
    'desktop',
    'sh',
    'js',
    'ps1',
    'lnk',
    'url',
    'bat',
    'cmd',
    'scr',
  ])
    assert.equal(canOpenDocument('lecture.pdf.' + ext), false, ext);
  for (const filename of ['README', 'program', 'notes.pdf.exe', 'script.py', 'binary.so'])
    assert.equal(canOpenDocument(filename), false, filename);
});

test('API credentials remain bound to the exact normalized completion endpoint', () => {
  const settings = {
    baseURL: 'https://model.example/v1',
    encryptedKey: 'encrypted-fixture',
    keyEndpoint: 'https://model.example/v1/chat/completions',
    model: 'fixture',
  };
  const equivalent = applyAIEndpoint(
    settings,
    'secret-fixture',
    'https://MODEL.example:443/v1/chat/completions',
  );
  assert.equal(equivalent.apiKey, 'secret-fixture');
  assert.equal(equivalent.value.encryptedKey, 'encrypted-fixture');
  for (const target of [
    'https://other.example/v1',
    'https://model.example/another',
    'http://127.0.0.1:1234/v1',
  ]) {
    const changed = applyAIEndpoint(settings, 'secret-fixture', target);
    assert.equal(changed.apiKey, '');
    assert.equal(changed.value.encryptedKey, undefined);
    assert.equal(changed.value.keyEndpoint, undefined);
    assert.equal(changed.value.model, 'fixture');
  }
  assert.equal(settings.encryptedKey, 'encrypted-fixture');
  assert.equal(
    applyAIEndpoint(
      { ...settings, keyEndpoint: 'https://other.example/v1/chat/completions' },
      'secret-fixture',
    ).apiKey,
    '',
  );
  for (const target of [
    'http://remote.example/v1',
    'https://secret@model.example/v1',
    'https://model.example/v1?q=secret',
    'file:///etc/passwd',
  ])
    assert.throws(() => applyAIEndpoint(settings, 'secret-fixture', target));
});

test('IPC sender and strict patch validation deny embedded website and filesystem fields', () => {
  const expected = 'file:///app/dist/index.html';
  assert.equal(trustedSender(7, expected, true, 7, expected), true);
  for (const [sender, url, main] of [
    [8, expected, true],
    [7, expected, false],
    [7, 'https://selearning.nju.edu.cn', true],
    [7, expected + '?injected', true],
  ] as const)
    assert.equal(trustedSender(sender, url, main, 7, expected), false);
  assert.throws(() => materialPatch.parse({ storedPath: '/etc/passwd' }));
  assert.throws(() => materialPatch.parse({ sourcePath: '/home/private' }));
  assert.throws(() => materialPatch.parse({ isManaged: false }));
  assert.throws(() => taskInput.parse({ title: 'task', repeatRule: { frequency: 'daily' } }));
});
