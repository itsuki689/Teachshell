import { app, safeStorage } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { safePath, exists } from '../filesystem/paths.ts';
import {
  EncryptedLoginFile,
  KeychainLoginStore,
  LoginStorage,
  assertLoginBackend,
} from './login-storage.ts';
import type { LoginCrypto } from './login-storage.ts';
export interface LoginBrowserOptions {
  sessionRoot?: string;
  keychainHelper?: string;
  onLoginState?: (status: import('./login-session.ts').LoginStatus) => void;
}
/** Linux safeStorage has no no-prompt switch: secret access there requires an explicit action. */
export function electronLoginCrypto(): LoginCrypto {
  async function available(allowInteraction: boolean) {
    assertLoginBackend(
      process.platform,
      process.platform === 'linux' ? safeStorage.getSelectedStorageBackend() : '',
      allowInteraction,
    );
    if (
      !(await safeStorage.isAsyncEncryptionAvailable()) ||
      (process.platform === 'linux' &&
        ['basic_text', 'unknown'].includes(safeStorage.getSelectedStorageBackend()))
    )
      throw new Error('系统安全密钥存储不可用，请解锁后重试；不会以明文保存登录');
  }
  return {
    async encrypt(text, allowInteraction) {
      await available(allowInteraction);
      return safeStorage.encryptStringAsync(text);
    },
    async decrypt(encrypted, allowInteraction) {
      await available(allowInteraction);
      return (await safeStorage.decryptStringAsync(encrypted)).result;
    },
  };
}
export function desktopLoginStorage(scope: string, options: LoginBrowserOptions): LoginStorage {
  const root = options.sessionRoot ?? path.join(app.getPath('userData'), 'TeachingSessions');
  const secret =
    process.platform === 'darwin'
      ? new KeychainLoginStore(
          options.keychainHelper ??
            path.join(
              app.isPackaged ? process.resourcesPath : path.join(app.getAppPath(), 'dist-electron'),
              'teaching-session-keychain',
            ),
          scope,
        )
      : new EncryptedLoginFile(root, scope, electronLoginCrypto());
  return new LoginStorage(root, scope, secret);
}
/** Remove only our obsolete on-disk partitions, without opening/decrypting an old cookie DB. */
export async function clearLegacyLoginPartitions(
  scope: string,
  userData = app.getPath('userData'),
) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(scope)) throw new Error('无效登录资料库标识');
  const base = await safePath(userData, 'Partitions', true);
  if (!(await exists(base))) return;
  for (const kind of ['teaching', 'timetable']) {
    const target = await safePath(base, `teachshelf-${scope}-${kind}`.toLowerCase(), true);
    await fs.rm(target, { recursive: true, force: true });
  }
}
