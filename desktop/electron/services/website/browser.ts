import { BrowserWindow, session } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { WebsiteResult } from '../../../shared/api.ts';
import { observationSource, readObservation } from './observation.ts';
import { resourceHead } from './resource-head.ts';
import { teachingPageURL } from './teaching.ts';
import { sessionFetch } from './session-fetch.ts';
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
  constructor(scripts: string, scope: string) {
    this.scripts = scripts;
    this.scope = scope;
    const isolated = session.fromPartition(this.partition('teaching'));
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
    return 'persist:teachshelf-' + this.scope + '-' + kind;
  }
  fetch: typeof fetch = (input, init) =>
    sessionFetch(
      session.fromPartition(this.partition('teaching')),
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      input instanceof Request ? { method: input.method, signal: input.signal, ...init } : init,
    );
  async open(url: string, kind: WebsiteKind) {
    websiteURL(url, kind);
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
    win.on('closed', () => this.windows.delete(kind));
    await win.loadURL(url);
  }
  async inspect(kind: WebsiteKind): Promise<WebsiteResult> {
    const win = this.windows.get(kind);
    if (!win || win.isDestroyed()) throw new Error('请先打开网站并登录，进入课程或课表页面');
    const url = win.webContents.getURL();
    websiteURL(url, kind);
    const script = await fs.readFile(
      path.join(this.scripts, kind === 'teaching' ? 'teaching.js' : 'timetable.js'),
      'utf8',
    );
    const observation = await win.webContents.executeJavaScriptInIsolatedWorld(999, [
      { code: observationSource(script, kind) },
    ]);
    return readObservation(observation, kind, url, win.webContents.getURL());
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
      try {
        return await Promise.race([
          aborted,
          (async () => {
            await win.loadURL(url);
            bounded.throwIfAborted();
            const loaded = win.webContents.getURL();
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
            return result;
          })(),
        ]);
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
    this.generation++;
    this.cancellation.abort(new Error('网站检查已取消'));
    this.cancellation = new AbortController();
    for (const win of this.workers) if (!win.isDestroyed()) win.destroy();
    this.workers.clear();
  }
  close() {
    this.cancelTeaching();
    for (const win of this.windows.values()) win.close();
    this.windows.clear();
  }
}
