import { randomUUID } from 'node:crypto';
import type { Repository } from '../storage/repository.ts';
import { digest } from '../storage/atomic.ts';
import {
  getTeachingConnection,
  isExperiment,
  mergeTeachingAssignment,
  validateTeachingObservation,
} from './teaching.ts';
import type { TeachingActivity, TeachingPage, TeachingAssignmentChange } from './teaching.ts';

export interface AssignmentPreview extends TeachingAssignmentChange {
  proposalID: string;
  connectionID: string;
  activity: TeachingActivity;
  revision: string;
  createdAt: number;
  expiresAt: number;
}
interface Pending {
  preview: AssignmentPreview;
  repository: Repository;
  page: TeachingPage;
  pageHash: string;
  sourceURL: string;
  now: number;
}
const canonical = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.entries(value)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([key, v]) => [key, canonical(v)]),
        )
      : value;
const fingerprint = (page: TeachingPage) => digest(JSON.stringify(canonical(page)));
/** Preparation never downloads, saves a connection, or mutates a plan. */
export class AssignmentSyncService {
  private getRepository: () => Repository;
  private now: () => number;
  private pending = new Map<string, Pending>();
  constructor(getRepository: () => Repository, now: () => number = Date.now) {
    this.getRepository = getRepository;
    this.now = now;
  }
  clear() {
    this.pending.clear();
  }
  async preview(
    connectionID: string,
    activity: TeachingActivity,
    input: unknown,
    sourceURL: string,
  ): Promise<AssignmentPreview> {
    const repo = this.getRepository(),
      page = validateTeachingObservation(activity, input, sourceURL),
      createdAt = this.now(),
      now = (createdAt - 978307200000) / 1000;
    return repo.withWorkspace(async (state) => {
      if (repo !== this.getRepository()) throw new Error('资料库已切换');
      const connection = getTeachingConnection(state, connectionID);
      if (isExperiment(activity) ? !connection.includeExperiments : !connection.includeAssignments)
        throw new Error('该连接已关闭此类作业同步');
      const revision = repo.snapshot().revision,
        change = mergeTeachingAssignment(state, connectionID, activity, page, now),
        proposalID = randomUUID(),
        preview: AssignmentPreview = {
          ...change,
          proposalID,
          connectionID,
          activity: structuredClone(activity),
          revision,
          createdAt,
          expiresAt: createdAt + 15 * 60000,
        };
      for (const [id, p] of this.pending)
        if (p.preview.expiresAt < createdAt) this.pending.delete(id);
      if (this.pending.size >= 500) throw new Error('待确认项过多，请先处理或清除预览');
      this.pending.set(proposalID, {
        preview,
        repository: repo,
        page,
        pageHash: fingerprint(page),
        sourceURL,
        now,
      });
      return structuredClone(preview);
    });
  }
  async apply(proposalID: string, input: unknown, currentURL: string) {
    const pending = this.pending.get(proposalID),
      repo = this.getRepository();
    if (!pending || pending.repository !== repo || this.now() > pending.preview.expiresAt)
      throw new Error('作业更新预览已过期或资料库已切换，请重新读取');
    const page = validateTeachingObservation(pending.preview.activity, input, currentURL);
    if (fingerprint(page) !== pending.pageHash)
      throw new Error('网站账号、课程或作业内容已变化，请重新读取预览');
    if (!pending.preview.reviewable) throw new Error('此作业没有可应用的变更');
    const result = await repo.withMutationGuard(
      (state) => {
        if (
          repo !== this.getRepository() ||
          this.now() > pending.preview.expiresAt ||
          digest(JSON.stringify(state)) !== pending.preview.revision
        )
          throw new Error('预览已过期或本地资料已修改，请重新读取后确认');
      },
      () =>
        repo.syncTeachingAssignment(
          pending.preview.connectionID,
          pending.preview.activity,
          page,
          pending.now,
          pending.preview.proposed?.id,
        ),
    );
    this.pending.delete(proposalID);
    return result;
  }
  async resolveDeadline(
    connectionID: string,
    key: string,
    useWebsite: boolean,
    expectedRevision: string,
  ) {
    const repo = this.getRepository();
    if (!expectedRevision) throw new Error('请先读取最新截止冲突');
    return repo.withMutationGuard(
      () => {
        if (repo !== this.getRepository()) throw new Error('资料库已切换');
      },
      () => repo.resolveTeachingDeadline(connectionID, key, useWebsite, expectedRevision),
    );
  }
}
