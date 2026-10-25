import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TeachingLoginSession,
  TeachingLoginRecovery,
  savedLoginCookie,
  readSavedLoginSession,
} from '../electron/services/website/login-session.ts';
import type {
  LoginCookie,
  LoginSessionStorage,
} from '../electron/services/website/login-session.ts';
const now = 1_800_000_000_000;
const cookie = (patch: Partial<LoginCookie> = {}): LoginCookie => ({
  name: 'MoodleSession',
  value: 'synthetic-session-only',
  domain: 'selearning.nju.edu.cn',
  path: '/',
  httpOnly: true,
  ...patch,
});
function fixture(enabled = false) {
  let data: string | undefined,
    failRead = false,
    failWrite = false,
    reads = 0,
    writes = 0,
    deletes = 0,
    pref = enabled;
  let contents: LoginCookie[] = [cookie()],
    installed: LoginCookie[] = [],
    waitRead: (() => Promise<LoginCookie[]>) | undefined;
  const storage: LoginSessionStorage = {
    setEnabled: async (value) => {
      pref = value;
    },
    read: async () => {
      reads++;
      if (failRead) throw Error('locked');
      return data;
    },
    write: async (value, _interactive, valid) => {
      if (failWrite) throw Error('locked');
      if (valid()) {
        data = value;
        writes++;
      }
    },
    remove: async () => {
      data = undefined;
      deletes++;
    },
  };
  const jar = {
    all: async () => (waitRead ? waitRead() : contents),
    set: async (c: LoginCookie) => {
      installed.push(c);
    },
  };
  const session = new TeachingLoginSession({ enabled, storage, jar, now: () => now });
  return {
    session,
    storage,
    jar,
    installed,
    setContents: (v: LoginCookie[]) => (contents = v),
    delay: (v: () => Promise<LoginCookie[]>) => (waitRead = v),
    setData: (v: string) => (data = v),
    readData: () => data,
    failRead: (v: boolean) => (failRead = v),
    failWrite: (v: boolean) => (failWrite = v),
    counts: () => ({ reads, writes, deletes, pref }),
  };
}
test('default off saves nothing; opt-in keeps only Moodle cookies and restores Secure, HttpOnly and session-only', async () => {
  const f = fixture();
  try {
    f.setContents([
      cookie({ secure: false }),
      cookie({ name: 'MOODLEID1_' }),
      cookie({ name: 'CASTGC', domain: 'authserver.nju.edu.cn' }),
      cookie({ domain: '.nju.edu.cn' }),
    ]);
    await f.session.prepare();
    f.session.didAuthenticate('99');
    await f.session.saveNow();
    assert.equal(f.counts().reads, 0);
    assert.equal(f.readData(), undefined);
    await f.session.setEnabled(true);
    await f.session.saveNow();
    const record = JSON.parse(f.readData()!);
    assert.equal(record.cookies.length, 1);
    const restored = new TeachingLoginSession({
      enabled: true,
      storage: f.storage,
      jar: f.jar,
      now: () => now,
    });
    try {
      await Promise.all([restored.prepare(), restored.prepare()]);
      assert.equal(f.installed.length, 1);
      assert.equal(f.installed[0].secure, true);
      assert.equal(f.installed[0].httpOnly, true);
      assert.equal(f.installed[0].expirationDate, undefined);
      assert.equal(restored.state().canProbe, true);
      assert.equal(restored.state().accountID, undefined);
      assert.equal(restored.state().loginState, 'unknown');
    } finally {
      restored.close();
    }
  } finally {
    f.session.close();
  }
});
test('disable deletes the secret and preference without clearing the current cookie jar', async () => {
  const f = fixture(true);
  try {
    f.session.didAuthenticate('99');
    await f.session.saveNow();
    assert.ok(f.readData());
    await f.session.setEnabled(false);
    assert.equal(f.readData(), undefined);
    assert.equal(f.counts().pref, false);
    assert.equal((await f.jar.all()).length, 1);
  } finally {
    f.session.close();
  }
});
test('disabling or closing during cookie read cannot save late credentials', async () => {
  for (const close of [false, true]) {
    const f = fixture(true);
    let resolve!: (v: LoginCookie[]) => void;
    f.delay(() => new Promise((r) => (resolve = r)));
    f.session.didAuthenticate('99');
    const saving = f.session.saveNow();
    await Promise.resolve();
    if (close) f.session.close();
    else await f.session.setEnabled(false);
    resolve([cookie()]);
    await saving;
    assert.equal(f.readData(), undefined);
    f.session.close();
  }
});
test('rejected restored sessions and explicit logout remove records, but locked reads cannot erase a prior record', async () => {
  const f = fixture(true);
  try {
    f.setData(
      JSON.stringify({ version: 1, savedAt: now, cookies: [savedLoginCookie(cookie(), now)] }),
    );
    const before = f.readData();
    f.failRead(true);
    await f.session.prepare();
    await f.session.needsLogin();
    assert.equal(f.readData(), before);
    assert.equal(f.counts().deletes, 0);
    assert.equal(f.session.state().hasIssue, true);
    f.failRead(false);
    await f.session.retry();
    assert.equal(f.installed.length, 1);
    await f.session.needsLogin();
    assert.equal(f.readData(), undefined);
    assert.equal(f.session.state().canProbe, false);
    f.setData(before!);
    await f.session.needsLogin(true);
    assert.equal(f.readData(), undefined);
  } finally {
    f.session.close();
  }
});
test('seven-day lifetime, five-minute future tolerance, count, expiry and decoded whitelist validation', () => {
  const c = savedLoginCookie(cookie(), now)!;
  const record = (patch: object = {}) =>
    JSON.stringify({ version: 1, savedAt: now, cookies: [c], ...patch });
  assert.ok(readSavedLoginSession(record({ savedAt: now - 7 * 86400000 + 1 }), now));
  for (const raw of [
    'corrupt',
    record({ version: 2 }),
    record({ savedAt: now - 7 * 86400000 }),
    record({ savedAt: now + 300001 }),
    record({ cookies: [] }),
    record({ cookies: Array(9).fill(c) }),
    record({ cookies: [{ ...c, expires: now / 1000 }] }),
    record({ cookies: [{ ...c, name: 'CASTGC' }] }),
    record({ cookies: [{ ...c, domain: '.nju.edu.cn' }] }),
    record({ cookies: [{ ...c, path: 'relative' }] }),
    record({ cookies: [{ ...c, value: 'a\r\nb' }] }),
  ])
    assert.equal(readSavedLoginSession(raw, now), undefined);
  assert.equal(savedLoginCookie(cookie({ expirationDate: now / 1000 - 1 }), now), undefined);
  assert.ok(
    readSavedLoginSession(
      record({
        cookies: [{ ...c, name: 'MoodleSession_app-1', domain: '.selearning.nju.edu.cn' }],
      }),
      now,
    ),
  );
});
test('expired and malformed saved records never reach the cookie jar', async () => {
  for (const raw of [
    'corrupt',
    JSON.stringify({
      version: 1,
      savedAt: now - 8 * 86400000,
      cookies: [savedLoginCookie(cookie(), now)],
    }),
  ]) {
    const f = fixture(true);
    f.setData(raw);
    await f.session.prepare();
    assert.equal(f.installed.length, 0);
    assert.equal(f.readData(), undefined);
    f.session.close();
  }
});
test('unchanged cookie saves do not extend seven-day lifetime, writes fail closed and can retry', async () => {
  const f = fixture(true);
  try {
    f.failWrite(true);
    f.session.didAuthenticate('99');
    await f.session.saveNow();
    assert.equal(f.readData(), undefined);
    assert.equal(f.session.state().hasIssue, true);
    f.failWrite(false);
    await f.session.retry();
    assert.ok(f.readData());
    const original = f.readData();
    await f.session.saveNow();
    assert.equal(f.readData(), original);
    assert.equal(f.counts().writes, 1);
    f.setContents([]);
    await f.session.saveNow();
    assert.equal(f.readData(), undefined);
    assert.equal(f.session.state().accountID, undefined);
  } finally {
    f.session.close();
  }
});
test('cookie changes debounce only after authenticated page observation and close cancels capture', async () => {
  const f = fixture(true);
  f.session.cookiesChanged();
  await new Promise((r) => setTimeout(r, 220));
  assert.equal(f.counts().writes, 0);
  f.session.didAuthenticate('99');
  f.session.cookiesChanged();
  f.session.close();
  await new Promise((r) => setTimeout(r, 220));
  assert.equal(f.counts().writes, 0);
});
test('single official SSO attempt returns to original course and stops on cancellation or foreign origins', () => {
  const r = new TeachingLoginRecovery(),
    target = 'https://selearning.nju.edu.cn/mod/assign/view.php?id=91',
    login = 'https://selearning.nju.edu.cn/login/index.php';
  r.begin(target);
  for (const url of [
    'https://evil.test/login/index.php',
    'http://selearning.nju.edu.cn/login/index.php',
    'https://selearning.nju.edu.cn:8443/login/index.php',
  ])
    assert.equal(r.next(url), undefined);
  assert.equal(r.next(login), login + '?authCAS=CAS');
  assert.equal(r.next(login), undefined);
  assert.equal(r.next('https://selearning.nju.edu.cn/my/'), target);
  assert.equal(r.next('https://selearning.nju.edu.cn/my/'), undefined);
  r.begin(target);
  r.cancel();
  assert.equal(r.next(login), undefined);
});

test('cookie rotation cancels an older asynchronous capture and disable still removes secrets if preference write fails', async () => {
  const f = fixture(true);
  let resolve!: (v: LoginCookie[]) => void;
  f.delay(() => new Promise((r) => (resolve = r)));
  f.session.didAuthenticate('99');
  const saving = f.session.saveNow();
  await Promise.resolve();
  f.session.cookiesChanged();
  resolve([cookie({ value: 'stale-cookie' })]);
  await saving;
  assert.equal(f.counts().writes, 0);
  f.session.close();
  const g = fixture(true);
  try {
    g.session.didAuthenticate('99');
    await g.session.saveNow();
    g.storage.setEnabled = async () => {
      throw Error('disk failure');
    };
    await g.session.setEnabled(false);
    assert.equal(g.readData(), undefined);
    assert.equal(g.session.state().enabled, false);
    assert.equal(g.session.state().hasIssue, true);
  } finally {
    g.session.close();
  }
});
