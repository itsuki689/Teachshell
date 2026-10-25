import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { Repository } from '../storage/repository.ts';
import { atomicWrite, digest } from '../storage/atomic.ts';
import { safeExternal, safePath } from '../filesystem/paths.ts';
import { teachingConnections } from './teaching.ts';
import type { BatchReview, TeachingBatchService } from './batch-sync.ts';

export interface BackgroundPreferences {
  enabled: boolean;
  intervalMinutes: number;
}
export interface BackgroundReadiness {
  online: boolean;
  idle: boolean;
  loginState: 'unknown' | 'checking' | 'renewing' | 'signedIn' | 'needsLogin';
  /** Obtained from an authenticated official page, never inferred from cookies. */
  accountID?: string;
  /** True only after the login service restores a valid remembered session. */
  allowSessionProbe?: boolean;
}
export interface BackgroundStatus {
  preferences: BackgroundPreferences;
  phase:
    'disabled' | 'waiting' | 'checking' | 'review' | 'paused' | 'blocked' | 'backoff' | 'error';
  reason?: string;
  lastCheckedAt?: number;
  nextCheckAt?: number;
  failureCount: number;
  review?: BatchReview;
}
export interface BackgroundClock {
  now(): number;
  setTimeout(callback: () => void, delay: number): unknown;
  clearTimeout(handle: unknown): void;
}
interface Options {
  settingsRoot: string;
  repository: () => Repository;
  batch: Pick<TeachingBatchService, 'check' | 'cancel'>;
  readiness: () => BackgroundReadiness;
  onChange?: (status: BackgroundStatus) => void;
  clock?: BackgroundClock;
}
const preferences = z
  .object({
    enabled: z.boolean(),
    intervalMinutes: z.number().int().min(5).max(1440),
  })
  .strict();
const persisted = preferences.extend({ version: z.literal(1) }).strict();
const defaults = (): BackgroundPreferences => ({ enabled: false, intervalMinutes: 30 });
const firstDelay = 30_000,
  blockedDelay = 60_000,
  maximumBackoff = 6 * 60 * 60_000;
const systemClock: BackgroundClock = {
  now: Date.now,
  setTimeout: (callback, delay) => {
    const timer = setTimeout(callback, delay);
    timer.unref();
    return timer;
  },
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Opt-in discovery only. This service has no apply or attachment-download capability. */
export class BackgroundTeachingSyncService {
  private options: Options;
  private clock: BackgroundClock;
  private repo?: Repository;
  private settingsRoot?: string;
  private settingsName?: string;
  private status: BackgroundStatus = {
    preferences: defaults(),
    phase: 'disabled',
    failureCount: 0,
  };
  private timer?: unknown;
  private due = 0;
  private generation = 0;
  private runToken = 0;
  private running?: Promise<void>;
  private activeAccount?: string;
  private foreground = false;
  private reviewAccount?: string;
  private configurationError?: string;
  private failureReason?: string;
  private saveQueue = Promise.resolve();
  private lastPublished = '';

  constructor(options: Options) {
    this.options = options;
    this.clock = options.clock ?? systemClock;
  }
  getStatus(): BackgroundStatus {
    return structuredClone(this.status);
  }

  /** Call after selecting a library; stop() must finish before replacing its shared batch/browser. */
  async start(): Promise<BackgroundStatus> {
    await this.stop();
    const generation = this.generation;
    this.repo = this.options.repository();
    this.foreground = false;
    this.configurationError = undefined;
    this.failureReason = undefined;
    this.status = { preferences: defaults(), phase: 'disabled', failureCount: 0 };
    try {
      await fs.mkdir(this.options.settingsRoot, { recursive: true, mode: 0o700 });
      this.settingsRoot = await safeExternal(this.options.settingsRoot);
      this.settingsName = `background-sync-${digest(this.repo.root)}.json`;
      const target = await safePath(this.settingsRoot, this.settingsName, true);
      try {
        const stat = await fs.stat(target);
        if (!stat.isFile() || stat.size > 16384) throw new Error('后台巡检设置文件无效或过大');
        const { version: _, ...value } = persisted.parse(
          JSON.parse(await fs.readFile(target, 'utf8')),
        );
        if (generation === this.generation) this.status.preferences = value;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    } catch (error) {
      if (generation === this.generation)
        this.configurationError = '后台巡检设置读取失败：' + errorText(error);
    }
    if (generation === this.generation) {
      this.due = this.clock.now() + firstDelay;
      this.evaluate();
    }
    return this.getStatus();
  }

  async updatePreferences(input: Partial<BackgroundPreferences>): Promise<BackgroundStatus> {
    const patch = preferences.partial().parse(input),
      generation = this.generation;
    const operation = this.saveQueue.then(async () => {
      if (!this.repo || !this.settingsRoot || !this.settingsName || generation !== this.generation)
        throw new Error('资料库已切换或后台巡检尚未初始化');
      const value = preferences.parse({ ...this.status.preferences, ...patch });
      await atomicWrite(
        this.settingsRoot,
        this.settingsName,
        JSON.stringify({ version: 1, ...value }, null, 2),
        true,
      );
      if (generation !== this.generation) throw new Error('资料库已切换，请重新设置');
      const enabledBefore = this.status.preferences.enabled;
      this.status.preferences = value;
      this.configurationError = undefined;
      if (!value.enabled) await this.cancelOwnCheck();
      else if (!enabledBefore) this.due = this.clock.now() + firstDelay;
      else if (patch.intervalMinutes !== undefined)
        this.due = this.clock.now() + value.intervalMinutes * 60_000;
      this.evaluate();
    });
    this.saveQueue = operation.catch(() => {});
    await operation;
    return this.getStatus();
  }

  notifyReadinessChanged(): void {
    this.evaluate();
  }

  /** Await before foreground check/apply so cancellation cannot target that subsequent operation. */
  async pauseForForeground(): Promise<void> {
    this.foreground = true;
    this.clearTimer();
    await this.cancelOwnCheck();
    this.evaluate();
  }
  resumeAfterForeground(review?: BatchReview): void {
    this.foreground = false;
    this.setReview(review);
  }
  /** Pass the remaining review after apply, or undefined after an explicit discard. */
  setReview(review?: BatchReview): void {
    this.status.review = review?.rows.length ? structuredClone(review) : undefined;
    this.reviewAccount = this.status.review ? this.readiness().accountID : undefined;
    if (!this.status.review)
      this.due = this.clock.now() + this.status.preferences.intervalMinutes * 60_000;
    this.evaluate();
  }
  async stop(): Promise<void> {
    this.generation++;
    this.clearTimer();
    this.repo = undefined;
    this.settingsRoot = this.settingsName = undefined;
    await this.cancelOwnCheck();
    this.status.review = undefined;
    this.reviewAccount = undefined;
    this.status.phase = 'paused';
    this.status.reason = '后台巡检已停止';
    delete this.status.nextCheckAt;
    this.publish();
  }
  private async cancelOwnCheck() {
    if (!this.running) return;
    this.runToken++;
    this.options.batch.cancel();
    await this.running;
  }
  private readiness(): BackgroundReadiness {
    try {
      return this.options.readiness();
    } catch {
      return { online: false, idle: false, loginState: 'unknown' };
    }
  }
  private clearTimer() {
    if (this.timer !== undefined) this.clock.clearTimeout(this.timer);
    this.timer = undefined;
  }
  private schedule(at: number) {
    this.clearTimer();
    this.timer = this.clock.setTimeout(
      () => {
        this.timer = undefined;
        this.evaluate();
      },
      Math.max(0, at - this.clock.now()),
    );
  }
  private publish() {
    const serialized = JSON.stringify(this.status);
    if (serialized === this.lastPublished) return;
    this.lastPublished = serialized;
    this.options.onChange?.(this.getStatus());
  }
  private gate(readiness: BackgroundReadiness): {
    reason?: string;
    connections: string[];
    accountID?: string;
  } {
    if (this.repo !== this.options.repository())
      return { reason: '资料库已切换，等待重新初始化', connections: [] };
    if (this.foreground || !readiness.idle) return { reason: '等待前台操作完成', connections: [] };
    if (!readiness.online) return { reason: '网络离线，等待连接恢复', connections: [] };
    const candidates = teachingConnections(this.repo!.state).filter((connection) =>
      this.repo!.state.courses.some(
        (course) => course.id === connection.courseID && !course.isArchived,
      ),
    );
    const probe = readiness.loginState === 'unknown' && readiness.allowSessionProbe;
    const inProgress = this.running && ['checking', 'renewing'].includes(readiness.loginState);
    const accountID = probe
      ? candidates[0]?.accountID
      : inProgress
        ? this.activeAccount
        : readiness.accountID;
    if (
      (!probe && !inProgress && readiness.loginState !== 'signedIn') ||
      !/^\d{1,16}$/.test(accountID ?? '')
    )
      return { reason: '请先在学校网页确认登录；后台不会自动登录', connections: [] };
    const connections = candidates
      .filter((connection) => connection.accountID === accountID)
      .map((connection) => connection.id);
    if (!connections.length) return { reason: '当前账号没有已连接且未归档的课程', connections };
    if (connections.length > 100)
      return { reason: '课程超过100门，请在前台分批检查', connections: [] };
    return { connections, accountID };
  }
  private evaluate() {
    this.clearTimer();
    delete this.status.nextCheckAt;
    if (!this.repo) return;
    const readiness = this.readiness(),
      gate = this.gate(readiness);
    if (
      this.status.review &&
      (this.status.review.expiresAt <= this.clock.now() ||
        readiness.loginState === 'needsLogin' ||
        (readiness.loginState === 'signedIn' && readiness.accountID !== this.reviewAccount))
    ) {
      this.status.review = undefined;
      this.reviewAccount = undefined;
    }
    if (this.running) {
      if (
        !this.status.preferences.enabled ||
        gate.reason ||
        (readiness.loginState === 'signedIn' && readiness.accountID !== this.activeAccount)
      ) {
        this.runToken++;
        this.options.batch.cancel();
      }
      this.status.phase = 'checking';
      this.status.reason = gate.reason ?? '正在只读检查教学网页';
    } else if (this.configurationError) {
      this.status.phase = 'error';
      this.status.reason = this.configurationError;
    } else if (!this.status.preferences.enabled) {
      this.status.phase = 'disabled';
      this.status.reason = '后台巡检已关闭';
      if (this.status.review) this.schedule(this.status.review.expiresAt);
    } else if (this.foreground) {
      this.status.phase = 'paused';
      this.status.reason = '前台正在操作教学网站';
    } else if (this.status.review) {
      this.status.phase = 'review';
      this.status.reason = '检查完成，等待用户审核；未下载正文或写入课程';
      this.schedule(this.status.review.expiresAt);
    } else if (gate.reason) {
      this.status.phase = 'blocked';
      this.status.reason = gate.reason;
      this.schedule(this.clock.now() + blockedDelay);
    } else if (this.clock.now() < this.due) {
      this.status.phase = this.status.failureCount ? 'backoff' : 'waiting';
      this.status.reason = this.status.failureCount ? this.failureReason : '等待下次只读检查';
      this.status.nextCheckAt = this.due;
      this.schedule(this.due);
    } else {
      this.status.phase = 'checking';
      this.status.reason = '正在只读检查教学网页';
      const generation = this.generation,
        token = ++this.runToken,
        repo = this.repo;
      this.activeAccount = gate.accountID;
      // Start in a microtask so even a synchronous check failure sees the acquired running lock.
      this.running = Promise.resolve().then(() =>
        this.run(repo, generation, token, gate.accountID!, gate.connections),
      );
    }
    this.publish();
  }
  private async run(
    repo: Repository,
    generation: number,
    token: number,
    accountID: string,
    connectionIDs: string[],
  ) {
    try {
      if (generation !== this.generation || token !== this.runToken) return;
      const review = await this.options.batch.check({ connectionIDs, includeExisting: true });
      const readiness = this.readiness();
      if (
        generation !== this.generation ||
        token !== this.runToken ||
        repo !== this.options.repository()
      )
        return;
      if (readiness.loginState === 'signedIn' && readiness.accountID !== accountID) return;
      if (readiness.loginState !== 'signedIn')
        throw new Error('学校网页尚未确认登录，请手动打开学校网站');
      this.status.lastCheckedAt = this.clock.now();
      const issues = review.messages.filter((value) => value.isIssue);
      if (!review.rows.length && (issues.length || review.interrupted))
        throw new Error(issues.map((value) => value.text).join('；') || '检查中断');
      this.status.failureCount = 0;
      this.failureReason = undefined;
      this.due = this.clock.now() + this.status.preferences.intervalMinutes * 60_000;
      if (review.rows.length) {
        this.status.review = review;
        this.reviewAccount = accountID;
      }
    } catch (error) {
      if (
        generation !== this.generation ||
        token !== this.runToken ||
        repo !== this.options.repository()
      )
        return;
      this.status.failureCount++;
      this.status.reason = this.failureReason = '只读检查失败，将稍后重试：' + errorText(error);
      this.due =
        this.clock.now() +
        Math.min(
          Math.max(maximumBackoff, this.status.preferences.intervalMinutes * 60_000),
          this.status.preferences.intervalMinutes *
            60_000 *
            2 ** Math.min(this.status.failureCount - 1, 16),
        );
    } finally {
      this.running = undefined;
      this.activeAccount = undefined;
      if (generation === this.generation) this.evaluate();
    }
  }
}
