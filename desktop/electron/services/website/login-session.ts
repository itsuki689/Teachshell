/** Moodle login retention policy, independent of Electron and operating-system secrets. */
export interface LoginCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expirationDate?: number;
  httpOnly?: boolean;
  secure?: boolean;
  session?: boolean;
}
export interface SavedLoginCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
  httpOnly: boolean;
}
export interface SavedLoginSession {
  version: 1;
  savedAt: number;
  cookies: SavedLoginCookie[];
}
export type LoginState = 'unknown' | 'checking' | 'renewing' | 'signedIn' | 'needsLogin';
export interface LoginStatus {
  enabled: boolean;
  status: string;
  hasIssue: boolean;
  loginState: LoginState;
  accountID?: string;
  canProbe: boolean;
}
export interface LoginSessionStorage {
  setEnabled(enabled: boolean): Promise<void>;
  cancel?(): void;
  read(allowInteraction: boolean): Promise<string | undefined>;
  write(data: string, allowInteraction: boolean, valid: () => boolean): Promise<void>;
  remove(allowInteraction?: boolean): Promise<void>;
}
export interface LoginCookieJar {
  all(): Promise<LoginCookie[]>;
  set(cookie: LoginCookie): Promise<void>;
}
const host = 'selearning.nju.edu.cn';
const size = (text: string) => Buffer.byteLength(text, 'utf8');
function allowed(value: unknown): value is SavedLoginCookie {
  if (!value || typeof value !== 'object') return false;
  const c = value as SavedLoginCookie;
  return (
    typeof c.name === 'string' &&
    size(c.name) <= 128 &&
    /^MoodleSession[A-Za-z0-9_-]*$/.test(c.name) &&
    typeof c.domain === 'string' &&
    [host, '.' + host].includes(c.domain.toLowerCase()) &&
    typeof c.path === 'string' &&
    c.path.startsWith('/') &&
    size(c.path) <= 1024 &&
    !c.path.includes('\0') &&
    typeof c.value === 'string' &&
    !!c.value &&
    size(c.value) <= 8192 &&
    !/[\r\n]/.test(c.value) &&
    typeof c.httpOnly === 'boolean' &&
    (c.expires === undefined || (typeof c.expires === 'number' && Number.isFinite(c.expires)))
  );
}
export function savedLoginCookie(cookie: LoginCookie, now: number): SavedLoginCookie | undefined {
  const c = {
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path,
    ...(cookie.expirationDate === undefined ? {} : { expires: cookie.expirationDate }),
    httpOnly: cookie.httpOnly ?? false,
  };
  return allowed(c) && (c.expires === undefined || c.expires > now / 1000) ? c : undefined;
}
export function readSavedLoginSession(raw: string, now: number): SavedLoginSession | undefined {
  if (size(raw) > 96000) return;
  let r: SavedLoginSession;
  try {
    r = JSON.parse(raw);
  } catch {
    return;
  }
  if (
    !r ||
    r.version !== 1 ||
    typeof r.savedAt !== 'number' ||
    !Number.isFinite(r.savedAt) ||
    r.savedAt > now + 300000 ||
    now - r.savedAt >= 7 * 86400000 ||
    !Array.isArray(r.cookies) ||
    !r.cookies.length ||
    r.cookies.length > 8 ||
    !r.cookies.every((c) => allowed(c) && (c.expires === undefined || c.expires > now / 1000))
  )
    return;
  return r;
}
export function restoredLoginCookie(c: SavedLoginCookie): LoginCookie {
  return {
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path,
    secure: true,
    httpOnly: c.httpOnly,
    ...(c.expires === undefined ? {} : { expirationDate: c.expires }),
  };
}
const issue = (error: unknown) => (error instanceof Error ? error.message : String(error));
export class TeachingLoginSession {
  private value: LoginStatus;
  private storage: LoginSessionStorage;
  private jar: LoginCookieJar;
  private now: () => number;
  private changed?: (status: LoginStatus) => void;
  private prepared = false;
  private preparation?: Promise<void>;
  private generation = 0;
  private closed = false;
  private verified = false;
  private mayInvalidate = false;
  private savedCookies: SavedLoginCookie[] = [];
  private capture?: ReturnType<typeof setTimeout>;
  constructor(options: {
    enabled: boolean;
    storage: LoginSessionStorage;
    jar: LoginCookieJar;
    now?: () => number;
    changed?: (status: LoginStatus) => void;
  }) {
    this.storage = options.storage;
    this.jar = options.jar;
    this.now = options.now ?? Date.now;
    this.changed = options.changed;
    this.value = {
      enabled: options.enabled,
      status: options.enabled ? '将从本机安全存储恢复登录' : '只保留当前应用内登录',
      hasIssue: false,
      loginState: 'unknown',
      canProbe: false,
    };
  }
  state(): LoginStatus {
    return { ...this.value };
  }
  private update(patch: Partial<LoginStatus>) {
    Object.assign(this.value, patch);
    if (!this.closed) this.changed?.(this.state());
  }
  private invalidate() {
    this.generation++;
    if (this.capture) clearTimeout(this.capture);
    this.capture = undefined;
  }
  async prepare(allowInteraction = false): Promise<void> {
    if (this.preparation) return this.preparation;
    if (this.closed || this.prepared) return;
    this.prepared = true;
    if (!this.value.enabled) return;
    const expected = this.generation;
    const valid = () => !this.closed && this.value.enabled && expected === this.generation;
    this.preparation = (async () => {
      try {
        const data = await this.storage.read(allowInteraction);
        if (!valid()) return;
        if (data === undefined) {
          this.update({ status: '记住登录已开启，登录成功后保存' });
          return;
        }
        const record = readSavedLoginSession(data, this.now());
        if (!record) {
          await this.storage.remove(allowInteraction);
          this.update({ status: '保存的会话已过期，请重新登录', hasIssue: false });
          return;
        }
        for (const cookie of record.cookies) {
          if (!valid()) return;
          await this.jar.set(restoredLoginCookie(cookie));
        }
        if (!valid()) return;
        this.savedCookies = record.cookies;
        this.mayInvalidate = true;
        this.update({ status: '已恢复本机会话，等待网站验证', hasIssue: false, canProbe: true });
      } catch (error) {
        if (valid()) this.update({ status: issue(error), hasIssue: true });
      }
    })();
    try {
      await this.preparation;
    } finally {
      this.preparation = undefined;
    }
  }
  async setEnabled(enabled: boolean) {
    if (this.closed) return;
    this.invalidate();
    this.update({ enabled, ...(!enabled ? { canProbe: false } : {}) });
    try {
      if (enabled) {
        await this.storage.setEnabled(true);
        this.update({ status: '记住登录已开启，登录成功后保存', hasIssue: false });
        if (this.verified) await this.saveNow(true);
      } else {
        let preferenceError: unknown;
        try {
          await this.storage.setEnabled(false);
        } catch (error) {
          preferenceError = error;
        }
        await this.storage.remove(true);
        this.savedCookies = [];
        if (preferenceError)
          throw new Error('保存的登录已清除，但关闭偏好未能保存：' + issue(preferenceError));
        this.update({ status: '已关闭并清除保存的登录；当前网页登录保留', hasIssue: false });
      }
    } catch (error) {
      this.update({
        status: (enabled ? '' : '已停止恢复登录，但加密副本未清除。') + issue(error),
        hasIssue: true,
      });
    }
  }
  setLoginState(state: LoginState) {
    this.update({ loginState: state });
  }
  didAuthenticate(accountID?: string) {
    if (this.closed) return;
    this.verified = true;
    this.mayInvalidate = true;
    this.update({ loginState: 'signedIn', accountID, canProbe: false });
    if (this.value.enabled) this.cookiesChanged();
  }
  async needsLogin(explicitLogout = false) {
    if (this.closed) return;
    this.verified = false;
    this.invalidate();
    this.savedCookies = [];
    this.update({ loginState: 'needsLogin', accountID: undefined, canProbe: false });
    if (!this.value.enabled) return;
    if (!this.mayInvalidate && !explicitLogout) {
      if (!this.value.hasIssue) this.update({ status: '学校要求重新登录，成功后将保存新会话' });
      return;
    }
    try {
      await this.storage.remove();
      this.mayInvalidate = false;
      this.update({ status: '学校要求重新登录，成功后将保存新会话', hasIssue: false });
    } catch (error) {
      this.update({ status: issue(error), hasIssue: true });
    }
  }
  async saveNow(allowInteraction = false) {
    if (this.closed || !this.value.enabled || !this.verified) return;
    const expected = this.generation;
    const valid = () =>
      !this.closed && this.value.enabled && this.verified && this.generation === expected;
    try {
      const now = this.now();
      const cookies = (await this.jar.all())
        .map((c) => savedLoginCookie(c, now))
        .filter((c): c is SavedLoginCookie => !!c)
        .sort(
          (a, b) =>
            a.name.localeCompare(b.name) ||
            a.domain.localeCompare(b.domain) ||
            a.path.localeCompare(b.path),
        );
      if (!valid()) return;
      if (cookies.length > 8) {
        this.update({ status: '教学网站会话数量异常，未保存', hasIssue: true });
        return;
      }
      if (!cookies.length) {
        await this.needsLogin();
        return;
      }
      if (JSON.stringify(cookies) === JSON.stringify(this.savedCookies)) {
        this.update({ status: '登录已加密保存在本机', hasIssue: false });
        return;
      }
      await this.storage.write(
        JSON.stringify({ version: 1, savedAt: now, cookies } satisfies SavedLoginSession),
        allowInteraction,
        valid,
      );
      if (!valid()) return;
      this.savedCookies = cookies;
      this.update({ status: '登录已加密保存在本机', hasIssue: false });
    } catch (error) {
      if (valid()) this.update({ status: issue(error), hasIssue: true });
    }
  }
  async retry() {
    if (this.closed) return;
    if (!this.value.enabled) return this.setEnabled(false);
    this.update({ hasIssue: false });
    if (this.verified) return this.saveNow(true);
    if (this.preparation) await this.preparation;
    this.prepared = false;
    await this.prepare(true);
  }
  cookiesChanged() {
    if (this.closed || !this.value.enabled || !this.verified) return;
    this.invalidate();
    this.capture = setTimeout(() => {
      this.capture = undefined;
      void this.saveNow();
    }, 200);
  }
  close() {
    this.closed = true;
    this.invalidate();
    this.storage.cancel?.();
  }
}
/** Matches Swift's one official SSO attempt, with no credential/form submission. */
export class TeachingLoginRecovery {
  private destination?: string;
  private attempted = false;
  private returned = false;
  begin(raw: string) {
    this.cancel();
    try {
      const u = new URL(raw);
      if (
        official(u) &&
        (u.pathname === '/course/view.php' ||
          /^\/mod\/(assign|resource|folder)\/view.php$/.test(u.pathname)) &&
        /^\d+$/.test(u.searchParams.get('id') ?? '')
      )
        this.destination = u.href;
    } catch {}
  }
  next(raw: string): string | undefined {
    if (!this.destination) return;
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      return;
    }
    if (!official(u)) return;
    if (u.pathname === '/login/index.php' && !this.attempted) {
      this.attempted = true;
      return 'https://selearning.nju.edu.cn/login/index.php?authCAS=CAS';
    }
    if (
      this.attempted &&
      !this.returned &&
      ['/', '/index.php', '/my', '/my/', '/my/index.php'].includes(u.pathname)
    ) {
      this.returned = true;
      return this.destination;
    }
  }
  cancel() {
    this.destination = undefined;
    this.attempted = false;
    this.returned = false;
  }
}
function official(u: URL) {
  return (
    u.protocol === 'https:' &&
    u.hostname === host &&
    !u.username &&
    !u.password &&
    (!u.port || u.port === '443')
  );
}
