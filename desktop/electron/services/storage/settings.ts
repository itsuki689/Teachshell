import { safeStorage } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { completionURL } from '../ai/stream.ts';
import { applyAIEndpoint } from './settings-policy.ts';
import { atomicWrite } from './atomic.ts';
import { safePath, exists } from '../filesystem/paths.ts';
import type { Settings } from '../../../shared/api.ts';
interface Stored {
  baseURL: string;
  model: string;
  encryptedKey?: string;
  keyEndpoint?: string;
  mcpEnabled: boolean;
  mcpPort: number;
  mcpToken: string;
  theme: string;
  libraryPath?: string;
}
export class SettingsService {
  warning = '';
  private root: string;
  private value: Stored = {
    baseURL: 'https://api.openai.com/v1',
    model: '',
    mcpEnabled: false,
    mcpPort: 53142,
    mcpToken: randomBytes(32).toString('hex'),
    theme: 'system',
  };
  private key = '';
  private queue: Promise<unknown> = Promise.resolve();
  constructor(root: string) {
    this.root = root;
  }
  async load() {
    await fs.mkdir(this.root, { recursive: true });
    const p = await safePath(this.root, 'desktop-settings.json', true);
    if (await exists(p)) {
      this.value = { ...this.value, ...JSON.parse(await fs.readFile(p, 'utf8')) };
      if (this.value.encryptedKey) {
        try {
          if (
            this.value.keyEndpoint &&
            this.value.keyEndpoint !== completionURL(this.value.baseURL)
          )
            throw new Error('密钥绑定地址不同');
          const result = await safeStorage.decryptStringAsync(
            Buffer.from(this.value.encryptedKey, 'base64'),
          );
          this.key = result.result;
        } catch {
          this.warning =
            '系统密钥存储无法解密 API Key 或密钥绑定地址已变化；配置已保留，请检查模型地址和系统密钥环。离线资料管理仍可使用。';
        }
      }
    }
    return this;
  }
  view(): Settings {
    return {
      ai: { baseURL: this.value.baseURL, model: this.value.model, hasKey: !!this.key },
      mcp: { enabled: this.value.mcpEnabled, port: this.value.mcpPort, token: this.value.mcpToken },
      theme: this.value.theme,
    };
  }
  ai() {
    return { baseURL: this.value.baseURL, model: this.value.model, apiKey: this.key };
  }
  get libraryPath() {
    return this.value.libraryPath;
  }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work);
    this.queue = result.catch(() => {});
    return result;
  }
  async setLibraryPath(libraryPath: string) {
    await this.serial(() => this.save({ ...this.value, libraryPath }));
  }
  private async save(value: Stored) {
    await atomicWrite(
      this.root,
      'desktop-settings.json',
      JSON.stringify(value, null, 2) + '\n',
      true,
    );
    this.value = value;
  }
  update(input: {
    baseURL?: string;
    model?: string;
    apiKey?: string;
    mcpEnabled?: boolean;
    mcpPort?: number;
    theme?: string;
  }) {
    return this.serial(() => this.updateNow(input));
  }
  private async updateNow(input: {
    baseURL?: string;
    model?: string;
    apiKey?: string;
    mcpEnabled?: boolean;
    mcpPort?: number;
    theme?: string;
  }) {
    const endpoint = applyAIEndpoint(this.value, this.key, input.baseURL),
      next = endpoint.value;
    let nextKey = endpoint.apiKey;
    if (input.model !== undefined) next.model = input.model;
    if (input.mcpEnabled !== undefined) next.mcpEnabled = input.mcpEnabled;
    if (input.mcpPort !== undefined) next.mcpPort = input.mcpPort;
    if (input.theme !== undefined) next.theme = input.theme;
    if (input.apiKey !== undefined) {
      if (input.apiKey) {
        if (
          !(await safeStorage.isAsyncEncryptionAvailable()) ||
          (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')
        )
          throw new Error('系统安全密钥存储不可用，请启用系统密钥环后保存；不会以明文保存');
        next.encryptedKey = (await safeStorage.encryptStringAsync(input.apiKey)).toString('base64');
        next.keyEndpoint = completionURL(next.baseURL);
      } else {
        delete next.encryptedKey;
        delete next.keyEndpoint;
      }
      nextKey = input.apiKey;
    }
    await this.save(next);
    this.key = nextKey;
    return this.view();
  }
}
