import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import {
  EncryptedLoginFile,
  LoginStorage,
  assertLoginBackend,
} from '../electron/services/website/login-storage.ts';
import type { LoginCrypto } from '../electron/services/website/login-storage.ts';
function crypto() {
  const key = randomBytes(32);
  const c: LoginCrypto = {
    encrypt: async (text) => {
      const iv = randomBytes(12),
        cipher = createCipheriv('aes-256-gcm', key, iv),
        data = Buffer.concat([cipher.update(text), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), data]);
    },
    decrypt: async (data) => {
      const cipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
      cipher.setAuthTag(data.subarray(12, 28));
      return Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString('utf8');
    },
  };
  return c;
}
test('encrypted persistence has no plaintext cookies or backup; profile copies are rejected; disabling retains no secret', async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'login-store-')));
  try {
    const crypt = crypto(),
      secret = new EncryptedLoginFile(root, 'A', crypt),
      store = new LoginStorage(root, 'A', secret);
    assert.equal(await store.loadEnabled(), false);
    await store.setEnabled(true);
    assert.equal(await store.loadEnabled(), true);
    await store.write('synthetic-secret-session', false, () => true);
    const bytes = await fs.readFile(path.join(root, secret.filename));
    assert.ok(!bytes.includes('synthetic-secret-session'));
    assert.equal(await store.read(false), 'synthetic-secret-session');
    await fs.copyFile(path.join(root, 'A.encrypted'), path.join(root, 'B.encrypted'));
    await assert.rejects(new EncryptedLoginFile(root, 'B', crypt).read(false), /当前资料库/);
    await store.setEnabled(false);
    await store.remove();
    assert.equal(await store.read(false), undefined);
    assert.equal(
      (await fs.readdir(root)).some((name) => name.includes('bak')),
      false,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
test('failed or cancelled encryption cannot leave plaintext or a late saved secret', async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'login-store-')));
  try {
    const secret = new EncryptedLoginFile(root, 'A', {
      encrypt: async () => {
        throw Error('locked');
      },
      decrypt: async () => '',
    });
    await assert.rejects(
      secret.write('synthetic-secret', false, () => true),
      /locked/,
    );
    assert.deepEqual(await fs.readdir(root), []);
    let valid = true;
    const crypt = crypto();
    const delayed = new EncryptedLoginFile(root, 'A', {
      ...crypt,
      encrypt: async (text, interactive) => {
        valid = false;
        return crypt.encrypt(text, interactive);
      },
    });
    await delayed.write('synthetic-secret', false, () => valid);
    assert.deepEqual(await fs.readdir(root), []);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
test('symbolic-link preferences and encrypted targets cannot access outside paths', async (t) => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'login-store-')));
  try {
    const outside = path.join(root, 'outside');
    await fs.writeFile(outside, 'do not touch');
    const storageRoot = path.join(root, 'storage');
    await fs.mkdir(storageRoot);
    try {
      await fs.symlink(outside, path.join(storageRoot, 'A.encrypted'));
    } catch (e) {
      if (process.platform === 'win32' && e.code === 'EPERM') {
        t.skip('Windows symlink privilege unavailable');
        return;
      }
      throw e;
    }
    const secret = new EncryptedLoginFile(storageRoot, 'A', crypto());
    await assert.rejects(secret.read(false));
    await assert.rejects(secret.write('secret', false, () => true));
    await assert.rejects(secret.remove());
    assert.equal(await fs.readFile(outside, 'utf8'), 'do not touch');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('Linux rejects basic_text even for explicit actions and never accesses a keyring in the background', () => {
  for (const interactive of [true, false])
    assert.throws(() => assertLoginBackend('linux', 'basic_text', interactive), /basic_text/);
  assert.throws(() => assertLoginBackend('linux', 'gnome_libsecret', false), /后台/);
  assert.doesNotThrow(() => assertLoginBackend('linux', 'gnome_libsecret', true));
  assert.doesNotThrow(() => assertLoginBackend('win32', '', false));
});

test('failed disable cleanup persists off and retries deletion before any later restoration or re-enabling', async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'login-pending-')));
  let fail = true,
    secret = 'synthetic',
    reads = 0;
  const vault = {
    read: async () => {
      reads++;
      return secret;
    },
    write: async () => {},
    remove: async () => {
      if (fail) throw Error('locked');
      secret = '';
    },
  };
  try {
    const first = new LoginStorage(root, 'A', vault);
    await first.loadEnabled();
    await first.setEnabled(true);
    await first.setEnabled(false);
    await assert.rejects(first.remove(), /locked/);
    const disk = JSON.parse(await fs.readFile(path.join(root, first.filename), 'utf8'));
    assert.equal(disk.enabled, false);
    assert.equal(disk.cleanupPending, true);
    const restarted = new LoginStorage(root, 'A', vault);
    assert.equal(await restarted.loadEnabled(), false);
    assert.match(restarted.warning, /未能清除/);
    assert.equal(reads, 0);
    await assert.rejects(restarted.setEnabled(true), /locked/);
    fail = false;
    await restarted.setEnabled(false);
    await restarted.remove(true);
    assert.equal(restarted.warning, '');
    const recovered = new LoginStorage(root, 'A', vault);
    assert.equal(await recovered.loadEnabled(), false);
    assert.equal(secret, '');
    assert.equal(reads, 0);
    assert.equal(
      JSON.parse(await fs.readFile(path.join(root, first.filename), 'utf8')).cleanupPending,
      undefined,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
