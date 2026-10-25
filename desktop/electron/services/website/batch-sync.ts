import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Repository } from '../storage/repository.ts';
import type { LibraryState, StudyTask } from '../../../shared/model.ts';
import type { Snapshot, WebsiteResult } from '../../../shared/api.ts';
import { digest } from '../storage/atomic.ts';
import { downloadFile, teachingPage } from './download.ts';
import { teachingFileState } from './material-sync.ts';
import type { TeachingFile } from './material-sync.ts';
import {
  getTeachingConnection,
  teachingConnections,
  teachingPageURL,
  validateTeachingObservation,
  mergeTeachingAssignment,
  isExperiment,
  teachingDeadline,
} from './teaching.ts';
import type {
  TeachingActivity,
  TeachingConnection,
  TeachingDeadlineChange,
  TeachingPage,
} from './teaching.ts';

export interface TeachingBatchTransport {
  readTeaching(
    url: string,
    expected: { accountID: string; courseID: string },
    signal: AbortSignal,
  ): Promise<WebsiteResult>;
  fetch: typeof fetch;
  cancelTeaching?(): void;
}
export type BatchRowStatus =
  | 'new-file'
  | 'missing-file'
  | 'verify-file'
  | 'new-plan'
  | 'update-plan'
  | 'deadline-conflict'
  | 'local-modified';
export interface BatchReviewRow {
  id: string;
  connectionID: string;
  courseID: string;
  courseTitle: string;
  activity: TeachingActivity;
  kind: 'file' | 'plan';
  status: BatchRowStatus;
  title: string;
  detail: string;
  selectedByDefault: boolean;
  file?: TeachingFile;
  before?: StudyTask;
  proposed?: StudyTask;
  pendingDeadline?: TeachingDeadlineChange;
  error?: string;
}
export interface BatchMessage {
  connectionID: string;
  text: string;
  isIssue: boolean;
}
export interface BatchReview {
  id: string;
  revision: string;
  createdAt: number;
  expiresAt: number;
  connectionIDs: string[];
  rows: BatchReviewRow[];
  messages: BatchMessage[];
  skippedFiles: number;
  unverifiedFiles: number;
  interrupted: boolean;
}
export interface BatchCheckInput {
  connectionIDs?: string[];
  includeExisting?: boolean;
}
export interface BatchApplyInput {
  reviewID: string;
  selectedIDs: string[];
  deadlineChoices?: Record<string, boolean>;
  adoptLocalFileIDs?: string[];
}
export interface BatchRowResult {
  id: string;
  success: boolean;
  status: string;
  message: string;
}
export interface BatchApplyResult {
  review: BatchReview;
  snapshot: Snapshot;
  results: BatchRowResult[];
  downloaded: number;
  interrupted: boolean;
}
interface PendingRow {
  row: BatchReviewRow;
  page: TeachingPage;
  hash: string;
  connection: TeachingConnection;
}
interface PendingReview {
  review: BatchReview;
  repo: Repository;
  rows: Map<string, PendingRow>;
}
const canonical = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(canonical)
    : v && typeof v === 'object'
      ? Object.fromEntries(
          Object.entries(v)
            .filter(([, x]) => x !== undefined)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, x]) => [k, canonical(x)]),
        )
      : v;
const hash = (v: unknown) => digest(JSON.stringify(canonical(v)));
const courseURL = (c: TeachingConnection) =>
  `https://selearning.nju.edu.cn/course/view.php?id=${c.remoteCourseID}`;
const configuration = (c: TeachingConnection) => ({
  courseID: c.courseID,
  remoteCourseID: c.remoteCourseID,
  accountID: c.accountID,
  timeZone: c.timeZone,
  includeMaterials: c.includeMaterials,
  includeAssignments: c.includeAssignments,
  includeExperiments: c.includeExperiments,
  includeHistory: c.includeHistory,
});
const allowed = (c: TeachingConnection, a: TeachingActivity) =>
  a.kind === 'assign'
    ? isExperiment(a)
      ? c.includeExperiments
      : c.includeAssignments
    : c.includeMaterials;
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Read-only discovery followed by bounded, explicitly selected transactions. */
export class TeachingBatchService {
  private options: {
    repository: () => Repository;
    transport: () => TeachingBatchTransport;
    cacheRoot: string;
    now?: () => number;
  };
  private pending?: PendingReview;
  private controller?: AbortController;
  private activeTransport?: TeachingBatchTransport;
  constructor(options: TeachingBatchService['options']) {
    this.options = options;
  }
  private now() {
    return (this.options.now ?? Date.now)();
  }
  cancel() {
    this.controller?.abort(new Error('批量更新已取消'));
    this.activeTransport?.cancelTeaching?.();
  }
  clear() {
    this.cancel();
    this.pending = undefined;
  }
  private begin() {
    if (this.controller) throw new Error('教学网站操作正在进行');
    this.controller = new AbortController();
    this.activeTransport = this.options.transport();
    return { signal: this.controller.signal, transport: this.activeTransport };
  }
  private finish() {
    this.controller = undefined;
    this.activeTransport = undefined;
  }
  private verifyState(
    repo: Repository,
    state: LibraryState,
    expectedRevision?: string,
    c?: TeachingConnection,
  ) {
    this.controller?.signal.throwIfAborted();
    if (repo !== this.options.repository()) throw new Error('资料库已切换，请重新检查');
    if (expectedRevision && digest(JSON.stringify(state)) !== expectedRevision)
      throw new Error('revision_conflict：本地资料已改变，请重新检查');
    if (c) {
      const current = getTeachingConnection(state, c.id);
      if (
        hash(configuration(current)) !== hash(configuration(c)) ||
        !state.courses.some((x) => x.id === c.courseID && !x.isArchived)
      )
        throw new Error('课程或连接设置已改变，请重新检查');
    }
  }
  private async readCourse(
    transport: TeachingBatchTransport,
    c: TeachingConnection,
    signal: AbortSignal,
  ) {
    signal.throwIfAborted();
    const observed = await transport.readTeaching(
      courseURL(c),
      { accountID: c.accountID, courseID: c.remoteCourseID },
      signal,
    );
    const page = teachingPage.parse(observed.data),
      url = teachingPageURL(observed.url);
    if (page.accountID !== c.accountID) throw new Error('网站账号与绑定账号不同，请切换到原账号');
    if (
      url.kind !== 'course' ||
      url.id !== c.remoteCourseID ||
      page.kind !== 'course' ||
      page.courseID !== c.remoteCourseID
    )
      throw new Error('课程页面已变化或需要登录');
    return page;
  }
  private async readActivity(
    transport: TeachingBatchTransport,
    c: TeachingConnection,
    a: TeachingActivity,
    signal: AbortSignal,
  ) {
    signal.throwIfAborted();
    const observed = await transport.readTeaching(
      a.url,
      { accountID: c.accountID, courseID: c.remoteCourseID },
      signal,
    );
    const page = validateTeachingObservation(a, observed.data, observed.url);
    if (page.accountID !== c.accountID) throw new Error('网站账号与绑定账号不同，请切换到原账号');
    if (page.courseID !== c.remoteCourseID) throw new Error('活动所属课程已变化');
    return page;
  }
  async check(input: BatchCheckInput = {}): Promise<BatchReview> {
    const { signal, transport } = this.begin(),
      repo = this.options.repository();
    this.pending = undefined;
    try {
      const initial = await repo.withWorkspace(async (state) => {
        this.verifyState(repo, state);
        return { state, revision: repo.snapshot().revision };
      });
      const requested =
        input.connectionIDs === undefined ? undefined : new Set(input.connectionIDs);
      if (requested && (requested.size !== input.connectionIDs!.length || requested.size > 100))
        throw new Error('请选择不重复且不超过100个课程连接');
      const connections = teachingConnections(initial.state).filter(
        (c) =>
          (!requested || requested.has(c.id)) &&
          initial.state.courses.some((x) => x.id === c.courseID && !x.isArchived),
      );
      if (
        !connections.length ||
        connections.length > 100 ||
        (requested && connections.length !== requested.size)
      )
        throw new Error('没有可检查的有效课程连接或选择超过100门');
      const now = this.now(),
        review: BatchReview = {
          id: randomUUID(),
          revision: initial.revision,
          createdAt: now,
          expiresAt: now + 15 * 60000,
          connectionIDs: connections.map((c) => c.id),
          rows: [],
          messages: [],
          skippedFiles: 0,
          unverifiedFiles: 0,
          interrupted: false,
        };
      const rows = new Map<string, PendingRow>();
      let pages = 0;
      const add = (row: BatchReviewRow, page: TeachingPage, c: TeachingConnection) => {
        if (rows.size >= 5000) throw new Error('审核项目超过5000项，请分课程检查');
        if (rows.has(row.id)) return;
        rows.set(row.id, { row, page, hash: hash(page), connection: c });
        review.rows.push(row);
      };
      for (const c of connections) {
        try {
          this.verifyState(repo, repo.state, initial.revision, c);
          const course = await this.readCourse(transport, c, signal);
          const activities = course.activities.filter((a) => allowed(c, a));
          for (const a of activities) {
            signal.throwIfAborted();
            if (++pages > 1000) throw new Error('活动页面超过1000项，请分课程检查');
            const link = c.items.find((x) => x.id === 'plan:' + a.id),
              before = initial.state.tasks.find(
                (x) => x.id === link?.localID && x.courseID === c.courseID,
              );
            if (a.kind === 'assign' && link && (link.ignored || !before)) continue;
            try {
              const page = await this.readActivity(transport, c, a, signal);
              if (a.kind === 'assign' && !link && !c.includeHistory) {
                const due = teachingDeadline(page.deadlineText, c.timeZone).date;
                if (page.submitted || (due !== undefined && due < (now - 978307200000) / 1000))
                  continue;
              }
              let newFiles = false;
              for (const file of page.files) {
                const state = teachingFileState(initial.state, c.id, a, file);
                if (state === 'ignored') continue;
                if (state === 'existing') {
                  review.unverifiedFiles++;
                  if (input.includeExisting === false) {
                    review.skippedFiles++;
                    continue;
                  }
                }
                newFiles ||= state === 'new';
                add(
                  {
                    id: `${c.id}:file:${a.kind}:${a.id}:${file.key}`,
                    connectionID: c.id,
                    courseID: c.courseID,
                    courseTitle: c.remoteTitle,
                    activity: a,
                    kind: 'file',
                    status:
                      state === 'new'
                        ? 'new-file'
                        : state === 'missing'
                          ? 'missing-file'
                          : 'verify-file',
                    title: file.name,
                    detail:
                      state === 'existing'
                        ? '正文尚未下载核验；仅勾选后下载并比较摘要'
                        : state === 'missing'
                          ? '本地副本缺失；明确勾选后补下载'
                          : [a.section, a.title, ...file.subfolders].join(' / '),
                    selectedByDefault: state === 'new',
                    file,
                  },
                  page,
                  c,
                );
              }
              if (a.kind === 'assign') {
                const change = mergeTeachingAssignment(
                  structuredClone(initial.state),
                  c.id,
                  a,
                  page,
                  (now - 978307200000) / 1000,
                );
                if (change.reviewable || (newFiles && before && !before.archivedAt))
                  add(
                    {
                      id: `${c.id}:plan:${a.id}`,
                      connectionID: c.id,
                      courseID: c.courseID,
                      courseTitle: c.remoteTitle,
                      activity: a,
                      kind: 'plan',
                      status: change.pendingDeadline
                        ? 'deadline-conflict'
                        : before
                          ? 'update-plan'
                          : 'new-plan',
                      title: a.title,
                      detail: change.message,
                      selectedByDefault: true,
                      before: change.before,
                      proposed: change.proposed,
                      pendingDeadline: change.pendingDeadline,
                    },
                    page,
                    c,
                  );
                else if (
                  page.deadlineText &&
                  teachingDeadline(page.deadlineText, c.timeZone).date === undefined
                )
                  review.messages.push({
                    connectionID: c.id,
                    text: a.title + '：截止时间待核对 · ' + page.deadlineText,
                    isIssue: true,
                  });
              } else if (!page.files.length)
                review.messages.push({
                  connectionID: c.id,
                  text: a.title + '：未发现可下载文件',
                  isIssue: true,
                });
            } catch (error) {
              if (signal.aborted) throw error;
              if (/账号|登录/.test(message(error))) throw error;
              review.messages.push({
                connectionID: c.id,
                text: a.title + '：' + message(error),
                isIssue: true,
              });
            }
          }
          await this.readCourse(transport, c, signal);
        } catch (error) {
          review.messages.push({ connectionID: c.id, text: message(error), isIssue: true });
          for (const [id, p] of rows)
            if (p.connection.id === c.id) {
              rows.delete(id);
              review.rows = review.rows.filter((r) => r.id !== id);
            }
          if (signal.aborted) {
            review.interrupted = true;
            break;
          }
        }
      }
      this.verifyState(repo, repo.state, initial.revision);
      review.unverifiedFiles =
        review.rows.filter((r) => r.status === 'verify-file').length + review.skippedFiles;
      this.pending = { review, repo, rows };
      return structuredClone(review);
    } finally {
      this.finish();
    }
  }
  async apply(input: BatchApplyInput): Promise<BatchApplyResult> {
    const pending = this.pending;
    if (!pending || pending.review.id !== input.reviewID || this.now() > pending.review.expiresAt)
      throw new Error('更新清单已过期，请重新检查');
    if (
      !input.selectedIDs.length ||
      new Set(input.selectedIDs).size !== input.selectedIDs.length ||
      input.selectedIDs.some((id) => !pending.rows.has(id))
    )
      throw new Error('请选择存在且不重复的审核项目');
    const selected = new Set(input.selectedIDs);
    if (
      Object.keys(input.deadlineChoices ?? {}).some(
        (id) => !selected.has(id) || !pending.rows.get(id)?.row.pendingDeadline,
      ) ||
      (input.adoptLocalFileIDs ?? []).some(
        (id) => !selected.has(id) || pending.rows.get(id)?.row.status !== 'local-modified',
      )
    )
      throw new Error('截止或本地文件选择与清单不匹配');
    for (const id of selected)
      if (
        pending.rows.get(id)!.row.pendingDeadline &&
        typeof input.deadlineChoices?.[id] !== 'boolean'
      )
        throw new Error('请选择采用网站或保留本地截止');
    const { signal, transport } = this.begin(),
      repo = pending.repo,
      results: BatchRowResult[] = [];
    let downloaded = 0,
      interrupted = false;
    try {
      this.verifyState(repo, repo.state, pending.review.revision);
      const chosen = [...pending.rows.values()]
        .filter((p) => selected.has(p.row.id))
        .sort((a, b) => Number(a.row.kind === 'plan') - Number(b.row.kind === 'plan'));
      for (const item of chosen) {
        let staging: string | undefined;
        try {
          signal.throwIfAborted();
          if (this.now() > pending.review.expiresAt) throw new Error('更新清单已过期，请重新检查');
          this.verifyState(repo, repo.state, pending.review.revision, item.connection);
          if (item.row.kind === 'plan') {
            const waiting = chosen.filter(
              (dependency) =>
                dependency.row.kind === 'file' &&
                dependency.connection.id === item.connection.id &&
                dependency.row.activity.kind === item.row.activity.kind &&
                dependency.row.activity.id === item.row.activity.id &&
                pending.rows.has(dependency.row.id),
            );
            if (waiting.length) {
              const text =
                '所选作业附件尚未成功：' +
                waiting.map((dependency) => dependency.row.title).join('、') +
                '。请重试附件后再应用计划。';
              item.row.error = text;
              results.push({
                id: item.row.id,
                success: false,
                status: 'waiting-attachments',
                message: text,
              });
              continue;
            }
          }
          const course = await this.readCourse(transport, item.connection, signal);
          if (!course.activities.some((a) => hash(a) === hash(item.row.activity)))
            throw new Error('课程活动已变化，请重新检查');
          const fresh = await this.readActivity(
            transport,
            item.connection,
            item.row.activity,
            signal,
          );
          if (hash(fresh) !== item.hash) throw new Error('网站活动内容已变化，请重新检查');
          let status: string, resultMessage: string, snapshot: Snapshot;
          if (item.row.file) {
            await fs.mkdir(this.options.cacheRoot, { recursive: true });
            staging = await fs.mkdtemp(
              path.join(await fs.realpath(this.options.cacheRoot), 'teaching-batch-'),
            );
            const target = path.join(staging, 'payload');
            await downloadFile(
              ((url, init) =>
                transport.fetch(url, {
                  ...init,
                  signal: AbortSignal.any([signal, ...(init?.signal ? [init.signal] : [])]),
                })) as typeof fetch,
              item.row.file.url,
              target,
              item.row.file.name,
            );
            downloaded++;
            await this.readCourse(transport, item.connection, signal);
            const finalPage = await this.readActivity(
              transport,
              item.connection,
              item.row.activity,
              signal,
            );
            if (hash(finalPage) !== item.hash)
              throw new Error('下载期间网站内容已变化，请重新检查');
            const value = await repo.withMutationGuard(
              (state) => this.verifyState(repo, state, pending.review.revision, item.connection),
              () =>
                repo.syncTeachingFile(
                  item.connection.id,
                  item.row.activity,
                  item.row.file!,
                  target,
                  {
                    restoreMissing: item.row.status === 'missing-file',
                    allowLocalChanges: input.adoptLocalFileIDs?.includes(item.row.id) ?? false,
                  },
                ),
            );
            snapshot = value.snapshot;
            status = value.status;
            resultMessage = value.message;
          } else {
            const value = await repo.withMutationGuard(
              (state) => this.verifyState(repo, state, pending.review.revision, item.connection),
              () =>
                repo.syncTeachingAssignment(
                  item.connection.id,
                  item.row.activity,
                  fresh,
                  (this.now() - 978307200000) / 1000,
                  item.row.proposed?.id,
                  input.deadlineChoices?.[item.row.id],
                ),
            );
            snapshot = value.snapshot;
            status = 'applied';
            resultMessage = value.message;
          }
          pending.review.revision = snapshot.revision;
          if (status === 'local-modified' || status === 'missing') {
            item.row.status = status === 'local-modified' ? 'local-modified' : 'missing-file';
            item.row.error = resultMessage;
            item.row.selectedByDefault = false;
            results.push({ id: item.row.id, success: false, status, message: resultMessage });
          } else {
            pending.rows.delete(item.row.id);
            pending.review.rows = pending.review.rows.filter((r) => r.id !== item.row.id);
            results.push({ id: item.row.id, success: true, status, message: resultMessage });
          }
        } catch (error) {
          const text = message(error);
          item.row.error = text;
          results.push({ id: item.row.id, success: false, status: 'error', message: text });
          if (
            signal.aborted ||
            repo !== this.options.repository() ||
            /revision_conflict|账号|登录|过期|连接设置/.test(text)
          ) {
            interrupted = true;
            break;
          }
        } finally {
          if (staging) await fs.rm(staging, { recursive: true, force: true });
        }
      }
      if (!interrupted) {
        for (const connectionID of new Set(chosen.map((item) => item.connection.id))) {
          const connection = chosen.find((item) => item.connection.id === connectionID)!.connection;
          const ids = new Set(
            chosen.filter((item) => item.connection.id === connectionID).map((item) => item.row.id),
          );
          const completed = results
            .filter((result) => ids.has(result.id))
            .every((result) => result.success);
          const notes = results
            .filter((result) => ids.has(result.id))
            .map((result) => ({
              id: randomUUID().toUpperCase(),
              text: result.message,
              isIssue: !result.success,
            }));
          try {
            const snapshot = await repo.withMutationGuard(
              (state) => this.verifyState(repo, state, pending.review.revision, connection),
              () => repo.finishTeachingUpdate(connectionID, notes, completed),
            );
            pending.review.revision = snapshot.revision;
          } catch (error) {
            pending.review.messages.push({
              connectionID,
              text: '同步记录未保存：' + message(error),
              isIssue: true,
            });
            interrupted = true;
            break;
          }
        }
      }
      for (const result of results) {
        const item = chosen.find((item) => item.row.id === result.id)!;
        pending.review.messages.push({
          connectionID: item.connection.id,
          text: result.message,
          isIssue: !result.success,
        });
      }
      pending.review.messages = pending.review.messages.slice(-500);
      pending.review.unverifiedFiles =
        pending.review.rows.filter((r) => r.status === 'verify-file').length +
        pending.review.skippedFiles;
      pending.review.interrupted = interrupted;
      return {
        review: structuredClone(pending.review),
        snapshot: repo.snapshot(),
        results,
        downloaded,
        interrupted,
      };
    } finally {
      this.finish();
    }
  }
}
