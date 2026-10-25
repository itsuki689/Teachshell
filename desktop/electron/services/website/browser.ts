import { BrowserWindow, session } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { WebsiteResult } from '../../../shared/api.ts';
import { observationSource, readObservation } from './observation.ts';
import { resourceHead } from './resource-head.ts';
import { teachingPageURL } from './teaching.ts';
import { sessionFetch } from './session-fetch.ts';
import { teachingPage } from './download.ts';
import { TeachingLoginSession, TeachingLoginRecovery } from './login-session.ts';
import type { LoginStatus, LoginCheck } from './login-session.ts';
import type { LoginStorage } from './login-storage.ts';
import { desktopLoginStorage, clearLegacyLoginPartitions } from './login-electron.ts';
import type { LoginBrowserOptions } from './login-electron.ts';
export type WebsiteKind = 'teaching' | 'timetable';
export function websiteURL(raw: string, kind: WebsiteKind): URL {
  const url = new URL(raw);
  const hosts =
    kind === 'teaching'
      ? ['selearning.nju.edu.cn', 'authserver.nju.edu.cn']
      : ['ehallapp.nju.edu.cn', 'authserver.nju.edu.cn', 'ehall.nju.edu.cn'];
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    (url.port && url.port !== '443') ||
    !hosts.includes(url.hostname)
  )
    throw new Error('只允许学校官方 HTTPS 教学与登录页面');
  return url;
}
export class WebsiteBrowser {
  private windows = new Map<WebsiteKind, BrowserWindow>();
  private scripts: string;
  private scope: string;
  private workers = new Set<BrowserWindow>();
  private reading: Promise<unknown> = Promise.resolve();
  private generation = 0;
  private cancellation = new AbortController();
  private login?: TeachingLoginSession;
  private initialization: Promise<void>;
  private preferenceIssue = '';
  private legacyIssue = '';
  private storage: LoginStorage;
  private closed = false;
  private closing?: Promise<void>;
  private visibleRecovery = new TeachingLoginRecovery();
  private cookieChanged = () => this.login?.cookiesChanged();
  constructor(scripts: string, scope: string, options: LoginBrowserOptions = {}) {
    this.scripts = scripts;
    this.scope = scope;
    const isolated = session.fromPartition(this.partition('teaching'));
    isolated.cookies.on('changed', this.cookieChanged);
    const storage = desktopLoginStorage(scope, options);
    this.storage = storage;
    this.initialization = (async () => {
      let enabled = false;
      try {
        enabled = await storage.loadEnabled();
      } catch {
        this.preferenceIssue = '登录偏好无法读取；本次不会恢复保存的会话';
      }
      try {
        await clearLegacyLoginPartitions(scope);
      } catch {
        this.legacyIssue = '旧版登录缓存未能清除；当前仅使用隔离内存会话';
      }
      this.login = new TeachingLoginSession({
        enabled,
        storage,
        changed: () => options.onLoginState?.(this.loginStatus()),
        jar: {
          all: async () =>
            (await isolated.cookies.get({})).map((c) => ({
              ...c,
              domain: c.domain ?? '',
              path: c.path ?? '',
            })),
          set: (cookie) =>
            isolated.cookies.set({ ...cookie, url: 'https://selearning.nju.edu.cn' + cookie.path }),
        },
      });
      if (this.closed) this.login.close();
      else options.onLoginState?.(this.loginStatus());
    })();
    isolated.on('will-download', (event) => event.preventDefault());
    isolated.webRequest.onBeforeRequest(
      { urls: ['https://selearning.nju.edu.cn/pluginfile.php/*'] },
      (details, callback) =>
        callback({
          cancel:
            details.method !== 'HEAD' &&
            [...this.workers].some(
              (w) => !w.isDestroyed() && w.webContents.id === details.webContentsId,
            ),
        }),
    );
  }
  partition(kind: WebsiteKind) {
    return 'teachshelf-' + this.scope + '-' + kind;
  }
  async prepareLogin() {
    await this.initialization;
    if (this.closed) throw new Error('网站会话已关闭');
    await this.login!.prepare();
    if (this.closed) throw new Error('网站会话已关闭');
    return this.loginStatus();
  }
  loginStatus(): LoginStatus {
    const status = this.login?.state() ?? {
      enabled: false,
      status: '正在准备隔离登录会话',
      hasIssue: false,
      loginState: 'unknown',
      canProbe: false,
    };
    const startupIssue = [
      this.storage.preferencesValid ? '' : this.preferenceIssue,
      this.legacyIssue,
      this.storage.warning,
    ]
      .filter(Boolean)
      .join('\n');
    return startupIssue ? { ...status, status: startupIssue, hasIssue: true } : status;
  }
  async setRememberLogin(enabled: boolean) {
    await this.initialization;
    await this.login!.setEnabled(enabled);
    if (this.storage.preferencesValid) this.preferenceIssue = '';
    if (this.legacyIssue) await this.retryStartupCleanup();
    return this.loginStatus();
  }
  async retryLogin() {
    await this.initialization;
    await this.login!.retry();
    if (this.storage.preferencesValid) this.preferenceIssue = '';
    if (this.legacyIssue) await this.retryStartupCleanup();
    return this.loginStatus();
  }
  private async retryStartupCleanup() {
    try {
      await clearLegacyLoginPartitions(this.scope);
      this.legacyIssue = '';
    } catch {
      this.legacyIssue = '旧版登录缓存未能清除；当前仅使用隔离内存会话';
    }
  }
  async flushLogin() {
    await this.initialization;
    await this.login!.saveNow();
  }
  observeLogin(result: WebsiteResult, check?: LoginCheck) {
    const source = teachingPageURL(result.url),
      page = teachingPage.parse(result.data);
    if (source.kind !== page.kind || (source.kind === 'course' && source.id !== page.courseID))
      throw new Error('登录观察来源不匹配');
    this.login?.didAuthenticate(page.accountID, check);
  }
  fetch: typeof fetch = async (input, init) => {
    await this.prepareLogin();
    if (this.closed) throw new Error('网站会话已关闭');
    return sessionFetch(
      session.fromPartition(this.partition('teaching')),
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      input instanceof Request ? { method: input.method, signal: input.signal, ...init } : init,
    );
  };
  async open(url: string, kind: WebsiteKind) {
    websiteURL(url, kind);
    await this.prepareLogin();
    if (this.closed) throw new Error('网站会话已关闭');
    if (kind === 'teaching') {
      this.visibleRecovery.begin(url);
      this.login!.setLoginState('checking');
    }
    let win = this.windows.get(kind);
    if (win && !win.isDestroyed()) {
      await win.loadURL(url);
      win.show();
      return;
    }
    const partition = this.partition(kind);
    const isolated = session.fromPartition(partition);
    isolated.setPermissionRequestHandler((_web, _permission, callback) => callback(false));
    isolated.setPermissionCheckHandler(() => false);
    win = new BrowserWindow({
      width: 1120,
      height: 800,
      title: kind === 'teaching' ? '教学网站' : '本科课表',
      webPreferences: {
        partition,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
      },
    });
    this.windows.set(kind, win);
    win.webContents.setWindowOpenHandler(({ url }) => {
      try {
        websiteURL(url, kind);
        void win!.loadURL(url);
      } catch {}
      return { action: 'deny' };
    });
    win.webContents.on('will-navigate', (e, url) => {
      try {
        websiteURL(url, kind);
        if (
          kind === 'teaching' &&
          new URL(url).hostname === 'selearning.nju.edu.cn' &&
          new URL(url).pathname === '/login/logout.php'
        ) {
          this.visibleRecovery.cancel();
          void this.login?.needsLogin(true);
        }
      } catch {
        e.preventDefault();
      }
    });
    win.webContents.on('will-redirect', (e, url) => {
      try {
        websiteURL(url, kind);
      } catch {
        e.preventDefault();
      }
    });
    isolated.on('will-download', (event) => event.preventDefault());
    win.webContents.on('did-finish-load', () => {
      if (kind !== 'teaching' || this.closed || win!.isDestroyed()) return;
      const loaded = win!.webContents.getURL(),
        next = this.visibleRecovery.next(loaded);
      if (next) {
        this.login?.setLoginState('renewing');
        void win!.loadURL(next).catch(() => {});
        return;
      }
      if (this.isLoginURL(loaded)) {
        void this.login?.needsLogin();
        return;
      }
      try {
        teachingPageURL(loaded);
        void this.inspect('teaching').catch(() => {});
      } catch {}
    });
    win.on('closed', () => this.windows.delete(kind));
    await win.loadURL(url);
  }
  private isLoginURL(raw: string) {
    try {
      const u = new URL(raw);
      return (
        u.hostname === 'authserver.nju.edu.cn' ||
        (u.hostname === 'selearning.nju.edu.cn' && u.pathname === '/login/index.php')
      );
    } catch {
      return false;
    }
  }
  async inspect(kind: WebsiteKind): Promise<WebsiteResult> {
    await this.prepareLogin();
    const win = this.windows.get(kind);
    if (!win || win.isDestroyed()) throw new Error('请先打开网站并登录，进入课程或课表页面');
    const url = win.webContents.getURL();
    websiteURL(url, kind);
    const script = await fs.readFile(
      path.join(this.scripts, kind === 'teaching' ? 'teaching.js' : 'timetable.js'),
      'utf8',
    );
    try {
      const observation = await win.webContents.executeJavaScriptInIsolatedWorld(999, [
        { code: observationSource(script, kind) },
      ]);
      const result = readObservation(observation, kind, url, win.webContents.getURL());
      if (kind === 'teaching') this.observeLogin(result);
      return result;
    } catch (error) {
      if (
        kind === 'teaching' &&
        (this.isLoginURL(win.webContents.getURL()) || String(error).includes('登录'))
      )
        await this.login?.needsLogin();
      throw error;
    }
  }
  /** One hidden, sandboxed reader at a time, sharing only the library's authenticated session. */
  readTeaching(
    url: string,
    expected: { accountID: string; courseID: string },
    signal: AbortSignal,
  ): Promise<WebsiteResult> {
    const generation = this.generation;
    const action = this.reading.then(async () => {
      signal.throwIfAborted();
      await this.prepareLogin();
      signal.throwIfAborted();
      if (generation !== this.generation) throw new Error('网站检查已取消');
      const source = teachingPageURL(url);
      const bounded = AbortSignal.any([
        signal,
        this.cancellation.signal,
        AbortSignal.timeout(35000),
      ]);
      if (source.kind === 'resource') {
        const file = await resourceHead(this.fetch as typeof fetch, url, bounded);
        bounded.throwIfAborted();
        if (generation !== this.generation) throw new Error('网站检查已取消');
        if (file)
          return {
            url,
            title: file.name,
            data: {
              kind: 'resource',
              accountID: expected.accountID,
              courseID: expected.courseID,
              title: file.name,
              files: [file],
              activities: [],
              intro: '',
              deadlineText: '',
              submitted: false,
            },
          };
      }
      bounded.throwIfAborted();
      const isolated = session.fromPartition(this.partition('teaching'));
      isolated.setPermissionRequestHandler((_web, _permission, cb) => cb(false));
      isolated.setPermissionCheckHandler(() => false);
      const win = new BrowserWindow({
        show: false,
        webPreferences: {
          partition: this.partition('teaching'),
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          webSecurity: true,
          allowRunningInsecureContent: false,
        },
      });
      this.workers.add(win);
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      const guardNavigation = (e: { preventDefault(): void }, target: string) => {
        try {
          websiteURL(target, 'teaching');
          if (new URL(target).pathname.startsWith('/pluginfile.php/')) e.preventDefault();
        } catch {
          e.preventDefault();
        }
      };
      win.webContents.on('will-navigate', guardNavigation);
      win.webContents.on('will-redirect', guardNavigation);
      let abort: () => void = () => {};
      const aborted = new Promise<never>((_resolve, reject) => {
        abort = () => {
          if (!win.isDestroyed()) win.destroy();
          reject(bounded.reason ?? new Error('网站检查已取消'));
        };
        bounded.addEventListener('abort', abort, { once: true });
      });
      const loginCheck = this.login!.beginCheck();
      try {
        return await Promise.race([
          aborted,
          (async () => {
            const recovery = new TeachingLoginRecovery();
            recovery.begin(url);
            let target = url;
            for (let n = 0; n < 3; n++) {
              await win.loadURL(target);
              bounded.throwIfAborted();
              const next = recovery.next(win.webContents.getURL());
              if (!next) break;
              this.login!.continueCheck(loginCheck);
              target = next;
            }
            bounded.throwIfAborted();
            const loaded = win.webContents.getURL();
            if (this.isLoginURL(loaded)) {
              await this.login!.needsLogin(false, loginCheck);
              throw new Error('需要在官方网页完成登录');
            }
            const actual = teachingPageURL(loaded);
            if (actual.kind !== source.kind || actual.id !== source.id)
              throw new Error('页面已变化或需要登录，请打开官方网页完成登录');
            const script = await fs.readFile(path.join(this.scripts, 'teaching.js'), 'utf8');
            const observation = await win.webContents.executeJavaScriptInIsolatedWorld(999, [
              { code: observationSource(script, 'teaching') },
            ]);
            const result = readObservation(
              observation,
              'teaching',
              loaded,
              win.webContents.getURL(),
            );
            if (generation !== this.generation) throw new Error('网站检查已取消');
            this.observeLogin(result, loginCheck);
            return result;
          })(),
        ]);
      } catch (error) {
        if (!bounded.aborted && String(error).includes('登录'))
          await this.login?.needsLogin(false, loginCheck);
        else this.login?.failCheck(loginCheck);
        throw error;
      } finally {
        bounded.removeEventListener('abort', abort);
        this.workers.delete(win);
        if (!win.isDestroyed()) win.destroy();
      }
    });
    this.reading = action.catch(() => {});
    return action;
  }
  cancelTeaching() {
    this.visibleRecovery.cancel();
    this.generation++;
    this.cancellation.abort(new Error('网站检查已取消'));
    this.cancellation = new AbortController();
    for (const win of this.workers) if (!win.isDestroyed()) win.destroy();
    this.workers.clear();
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    this.login?.close();
    this.cancelTeaching();
    this.closing = (async () => {
      await this.initialization;
      await this.login?.close();
      session
        .fromPartition(this.partition('teaching'))
        .cookies.removeListener('changed', this.cookieChanged);
      for (const win of this.windows.values()) if (!win.isDestroyed()) win.close();
      this.windows.clear();
      await Promise.all(
        ['teaching', 'timetable'].map(async (kind) => {
          const isolated = session.fromPartition(this.partition(kind as WebsiteKind));
          await isolated.clearStorageData();
          await isolated.clearCache();
          await isolated.clearAuthCache();
          await isolated.closeAllConnections();
        }),
      );
    })();
    return this.closing;
  }
}
