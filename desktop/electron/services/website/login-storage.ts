import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { atomicWrite } from '../storage/atomic.ts';
import { safePath, exists } from '../filesystem/paths.ts';
import type { LoginSessionStorage } from './login-session.ts';
export interface LoginSecretStore {
  cancel?(): void;
  read(allowInteraction: boolean): Promise<string | undefined>;
  write(data: string, allowInteraction: boolean, valid: () => boolean): Promise<void>;
  remove(allowInteraction?: boolean): Promise<void>;
}
export interface LoginCrypto {
  encrypt(plain: string, allowInteraction: boolean): Promise<Buffer>;
  decrypt(encrypted: Buffer, allowInteraction: boolean): Promise<string>;
}
/** A background check must never trigger Linux's unlock/authentication UI. */
export function assertLoginBackend(platform: string, backend: string, allowInteraction: boolean) {
  if (platform === 'linux' && backend === 'basic_text')
    throw new Error('系统安全密钥存储不可用；不会以明文或 basic_text 保存登录');
  if (platform === 'linux' && !allowInteraction)
    throw new Error('后台不会弹出系统密钥环授权；请点击重试以解锁并恢复登录');
}
function profileName(profile: string) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(profile)) throw new Error('无效登录资料库标识');
  return profile;
}
/** Preferences have no credentials. All secret operations serialize with disabling. */
export class LoginStorage implements LoginSessionStorage {
  private queue: Promise<unknown> = Promise.resolve();
  readonly filename: string;
  private enabled = false;
  private cleanupPending = false;
  warning = '';
  preferencesValid = false;
  private root: string;
  private secret: LoginSecretStore;
  constructor(root: string, profile: string, secret: LoginSecretStore) {
    this.root = root;
    this.secret = secret;
    this.filename = profileName(profile) + '.preferences.json';
  }
  private serial<T>(action: () => Promise<T>): Promise<T> {
    const result = this.queue.then(action);
    this.queue = result.catch(() => {});
    return result;
  }
  async loadEnabled() {
    await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
    const filename = await safePath(this.root, this.filename, true);
    if (!(await exists(filename))) {
      this.preferencesValid = true;
      return false;
    }
    const stat = await fs.stat(filename);
    if (stat.size > 1024) throw new Error('登录偏好文件无效');
    const data = JSON.parse(await fs.readFile(filename, 'utf8'));
    if (data?.version !== 1 || typeof data.enabled !== 'boolean')
      throw new Error('登录偏好文件无效');
    this.preferencesValid = true;
    this.enabled = data?.enabled === true;
    this.cleanupPending = data?.cleanupPending === true;
    if (this.cleanupPending) {
      // A previous explicit disable authorizes retrying its unfinished deletion, never restoration.
      this.enabled = false;
      try {
        await this.secret.remove(false);
        await this.savePreference(false, false);
        this.warning = '';
      } catch {
        this.warning = '此前关闭登录记忆时未能清除安全存储副本，已停止恢复；请点击重试。';
      }
    }
    return this.enabled;
  }
  private async savePreference(enabled: boolean, cleanupPending: boolean) {
    await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
    await atomicWrite(
      this.root,
      this.filename,
      JSON.stringify({ version: 1, enabled, ...(cleanupPending ? { cleanupPending: true } : {}) }) +
        '\n',
    );
    this.preferencesValid = true;
    this.enabled = enabled;
    this.cleanupPending = cleanupPending;
  }
  setEnabled(enabled: boolean) {
    return this.serial(async () => {
      if (enabled && this.cleanupPending) await this.secret.remove(true);
      await this.savePreference(enabled, !enabled);
      if (enabled) this.warning = '';
    });
  }
  read(allowInteraction: boolean) {
    return this.serial(() => this.secret.read(allowInteraction));
  }
  write(data: string, allowInteraction: boolean, valid: () => boolean) {
    return this.serial(async () => {
      if (valid()) await this.secret.write(data, allowInteraction, valid);
    });
  }
  remove(allowInteraction = false) {
    return this.serial(async () => {
      try {
        await this.secret.remove(allowInteraction);
        if (this.cleanupPending) await this.savePreference(this.enabled, false);
        this.warning = '';
      } catch (error) {
        this.warning = '安全存储副本未能清除；已停止恢复，请重试。';
        throw error;
      }
    });
  }
  cancel() {
    this.secret.cancel?.();
  }
}
/** A copied encrypted file cannot be restored into a different library profile. */
export class EncryptedLoginFile implements LoginSecretStore {
  readonly filename: string;
  private root: string;
  private profile: string;
  private crypto: LoginCrypto;
  constructor(root: string, profile: string, crypto: LoginCrypto) {
    this.root = root;
    this.profile = profile;
    this.crypto = crypto;
    this.filename = profileName(profile) + '.encrypted';
  }
  async read(allowInteraction: boolean) {
    const filename = await safePath(this.root, this.filename, true);
    if (!(await exists(filename))) return undefined;
    const stat = await fs.stat(filename);
    if (stat.size > 160000) throw new Error('加密登录文件过大');
    const data = JSON.parse(
      await this.crypto.decrypt(
        Buffer.from(await fs.readFile(filename, 'utf8'), 'base64'),
        allowInteraction,
      ),
    );
    if (data?.profile !== this.profile || typeof data.data !== 'string')
      throw new Error('加密登录文件不属于当前资料库');
    return data.data;
  }
  async write(data: string, allowInteraction: boolean, valid: () => boolean) {
    if (Buffer.byteLength(data) > 96000) throw new Error('登录会话过大');
    const encrypted = await this.crypto.encrypt(
      JSON.stringify({ profile: this.profile, data }),
      allowInteraction,
    );
    if (!valid()) return;
    await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
    await atomicWrite(this.root, this.filename, encrypted.toString('base64'));
  }
  async remove() {
    const filename = await safePath(this.root, this.filename, true);
    await fs.rm(filename, { force: true });
  }
}
export class KeychainLoginStore implements LoginSecretStore {
  private children = new Map<
    ReturnType<typeof spawn>,
    { operation: string; interactive: boolean }
  >();
  private closed = false;
  cancel() {
    this.closed = true;
    // Already-authorized noninteractive deletion may finish; credential reads/writes and prompts stop.
    for (const [child, request] of this.children)
      if (request.operation !== 'remove' || request.interactive) child.kill();
  }
  private executable: string;
  private profile: string;
  constructor(executable: string, profile: string) {
    this.executable = executable;
    this.profile = profile;
    profileName(profile);
    if (!path.isAbsolute(executable)) throw new Error('钥匙串辅助程序路径无效');
  }
  private request(
    operation: 'read' | 'write' | 'remove',
    allowInteraction: boolean,
    data?: string,
  ): Promise<string | undefined> {
    if (this.closed && operation !== 'remove') return Promise.reject(new Error('登录存储已关闭'));
    if (this.closed) allowInteraction = false;
    return new Promise((resolve, reject) => {
      const child = spawn(this.executable, [], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
      this.children.set(child, { operation, interactive: allowInteraction });
      child.once('close', () => this.children.delete(child));
      let output = Buffer.alloc(0),
        finished = false;
      const finish = (error?: Error, value?: string) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        error ? reject(error) : resolve(value);
      };
      const timer = setTimeout(
        () => {
          child.kill();
          finish(new Error('系统钥匙串响应超时，请解锁后重试'));
        },
        allowInteraction ? 120000 : 10000,
      );
      child.on('error', () =>
        finish(new Error('系统钥匙串辅助程序不可用；登录仅保留在当前应用内')),
      );
      child.stdout.on('data', (chunk: Buffer) => {
        output = Buffer.concat([output, chunk]);
        if (output.length > 160000) {
          child.kill();
          finish(new Error('钥匙串返回数据过大'));
        }
      });
      // Never forward stderr or request payloads to logs: they can contain credentials.
      child.stderr.resume();
      child.stdin.on('error', () => {});
      child.on('close', () => {
        if (finished) return;
        try {
          const result = JSON.parse(output.toString('utf8'));
          if (!result.ok) throw new Error('系统钥匙串暂不可用，可解锁后点击重试；仍可手动登录。');
          if (result.data !== undefined && typeof result.data !== 'string')
            throw new Error('钥匙串返回数据无效');
          finish(undefined, result.data);
        } catch (error) {
          finish(error instanceof Error ? error : new Error('钥匙串返回数据无效'));
        }
      });
      child.stdin.end(
        JSON.stringify({
          operation,
          profile: this.profile,
          allowInteraction,
          ...(data === undefined ? {} : { data }),
        }),
      );
    });
  }
  read(allowInteraction: boolean) {
    return this.request('read', allowInteraction);
  }
  async write(data: string, allowInteraction: boolean, valid: () => boolean) {
    if (valid()) await this.request('write', allowInteraction, data);
  }
  async remove(allowInteraction = false) {
    const mayRetry = allowInteraction && !this.closed;
    try {
      await this.request('remove', allowInteraction);
    } catch (error) {
      if (this.closed && mayRetry) await this.request('remove', false);
      else throw error;
    }
  }
}
