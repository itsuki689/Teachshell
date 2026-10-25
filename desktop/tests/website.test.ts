import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  downloadURL,
  validateDownload,
  downloadFile,
} from '../electron/services/website/download.ts';
test('teaching downloads require exact official HTTPS origin and resource path', () => {
  assert.equal(
    downloadURL('https://selearning.nju.edu.cn/pluginfile.php/1/mod_resource/content/0/lecture.pdf')
      .hostname,
    'selearning.nju.edu.cn',
  );
  for (const raw of [
    'http://selearning.nju.edu.cn/pluginfile.php/1/mod_resource/content/0/x',
    'https://selearning.nju.edu.cn.evil.test/pluginfile.php/1/mod_resource/content/0/x',
    'https://user:password@selearning.nju.edu.cn/pluginfile.php/1/mod_resource/content/0/x',
    'https://selearning.nju.edu.cn/login/index.php',
  ])
    assert.throws(() => downloadURL(raw));
});
test('login pages and mismatched PDF/Office payloads are rejected', () => {
  assert.throws(() => validateDownload(Buffer.from('<html><input type="password">'), 500, 'x.pdf'));
  assert.throws(() => validateDownload(Buffer.from('not pdf'), 10, 'x.pdf'));
  assert.throws(() => validateDownload(Buffer.from('not zip'), 10, 'x.pptx'));
  validateDownload(Buffer.from('%PDF-1.7'), 50, 'x.pdf');
});
test('download rejects redirect out of approved origin before fetching it', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'website-test-'));
  let requests = 0;
  try {
    await assert.rejects(
      downloadFile(
        (async () => {
          requests++;
          return new Response(null, {
            status: 302,
            headers: { location: 'https://evil.test/file' },
          });
        }) as typeof fetch,
        'https://selearning.nju.edu.cn/pluginfile.php/1/mod_resource/content/0/x',
        path.join(dir, 'x'),
        'x',
      ),
      /非教学/,
    );
    assert.equal(requests, 1);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
