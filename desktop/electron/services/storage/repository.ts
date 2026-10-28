import { validateAppearancePatch } from '../../../shared/appearance.ts';
import type { AppearancePatch } from '../../../shared/appearance.ts';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import lockfile from 'proper-lockfile';
import {
  decodeLibrary,
  emptyLibrary,
  swiftNow,
  assertID,
  requiredText,
  textValue,
  dateMs,
} from '../../../shared/model.ts';
import type {
  Course,
  Material,
  MaterialFolder,
  StudyTask,
  LibraryState,
  SwiftDate,
} from '../../../shared/model.ts';
import type { Snapshot, ImportResult } from '../../../shared/api.ts';
import {
  component,
  courseDirectory,
  materialRoot,
  folderDirectory,
  materialDirectory,
  materialPath,
  safePath,
  safeExternal,
  exists,
  fileName,
  identity,
} from '../filesystem/paths.ts';
import {
  atomicWrite,
  commitTransaction,
  recoverTransaction,
  digest,
  digestFile,
} from './atomic.ts';
import type { FileOp } from './atomic.ts';
import { prepareLegacyHomework } from './legacy-homework.ts';
import * as teachingMaterials from '../website/material-sync.ts';
import {
  importUndergraduateTimetable,
  updateTimetableSettings,
  cancelTimetableOccurrence,
  restoreTimetableOccurrence,
  rescheduleTimetableOccurrence,
  restoreTimetableReschedule,
  setTimetableMonthVisible,
  updateTimetableMeeting,
  setTimetableMeetingColor,
  deleteTimetableMeeting,
  validateTimetables,
} from '../course/timetable.ts';
import type {
  TimetableImportSummary,
  TimetableSettingsInput,
  TimetableRescheduleInput,
  TimetableMeetingInput,
} from '../../../shared/timetable.ts';
import {
  saveAdvancedPlan,
  changePlanStatus,
  removeAdvancedPlan,
  validatePlans,
  setPlanOccurrenceTime,
} from '../course/plans.ts';
import type { PlanEditScope, PlanStatus } from '../../../shared/plans.ts';
import { validateHomeworkMount } from '../resource/homework.ts';
import * as teaching from '../website/teaching.ts';
import { readToolbarActions } from '../../../shared/toolbar.ts';
const id = () => randomUUID().toUpperCase();
interface Observation {
  path: string;
  identity: string;
  size: number;
}
interface Entry extends Observation {
  directory: boolean;
}
const marker = '.teachshelf-electron.json';
let snapshotSequence = 0;
export class Repository {
  readonly root: string;
  readonly workspaceID = randomUUID();
  private stateValue: LibraryState = emptyLibrary();
  private timetableUndo?: { before: LibraryState['timetableTerms']; after: string };
  private canUndoTimetable() {
    return (
      !!this.timetableUndo &&
      this.timetableUndo.after === JSON.stringify(this.stateValue.timetableTerms)
    );
  }
  private release?: () => Promise<void>;
  private closing?: Promise<void>;
  private queue: Promise<unknown> = Promise.resolve();
  private observations: Record<string, Observation> = {};
  private removed = new Set<string>();
  warnings: string[] = [];
  private mutationGuard = new AsyncLocalStorage<(state: LibraryState) => void>();
  withMutationGuard<T>(guard: (state: LibraryState) => void, action: () => Promise<T>): Promise<T> {
    return this.mutationGuard.run(guard, action);
  }
  withWorkspace<T>(action: (state: LibraryState) => Promise<T>): Promise<T> {
    return this.serial(async () => {
      await this.synchronize();
      return action(this.state);
    });
  }
  restorePlanChanges(before: StudyTask[], after: StudyTask[]) {
    return this.mutate((state) => {
      const fingerprint = (value: unknown): string | undefined =>
        JSON.stringify(value, (key, v) =>
          key === 'overriddenFields' && Array.isArray(v)
            ? [...v].sort()
            : v && typeof v === 'object' && !Array.isArray(v)
              ? Object.fromEntries(
                  Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
                )
              : v,
        );
      for (const items of [before, after]) {
        const seen = new Set<string>();
        for (const plan of items) {
          assertID(plan.id);
          if (seen.has(plan.id.toUpperCase())) throw new Error('撤销记录包含重复计划');
          seen.add(plan.id.toUpperCase());
        }
      }
      const ids = new Set([...before, ...after].map((p) => p.id.toUpperCase()));
      for (const id of ids) {
        const current = state.tasks.find((p) => p.id.toUpperCase() === id),
          expected = after.find((p) => p.id.toUpperCase() === id);
        if (fingerprint(current) !== fingerprint(expected))
          throw new Error('这些计划后来已被修改，无法撤销');
      }
      state.tasks = state.tasks.filter((p) => !ids.has(p.id.toUpperCase()));
      state.tasks.push(...structuredClone(before));
      validatePlans(state);
    });
  }
  connectTeachingCourse(input: teaching.TeachingConnectionInput) {
    return this.serial(async () => {
      await this.synchronize();
      this.mutationGuard.getStore()?.(this.state);
      const next = this.state,
        result = teaching.connectTeachingCourse(next, input);
      const snapshot = result.created ? await this.write(next) : this.snapshot();
      return { snapshot, connection: result.connection, created: result.created };
    });
  }
  saveTeachingConnection(input: teaching.TeachingConnectionInput & { id: string }) {
    return this.mutate((state) => teaching.saveTeachingConnection(state, input));
  }
  updateTeachingOptions(
    id: string,
    flags: Partial<
      Pick<
        teaching.TeachingConnection,
        'includeMaterials' | 'includeAssignments' | 'includeExperiments' | 'includeHistory'
      >
    >,
  ) {
    return this.mutate((state) => {
      const current = teaching.getTeachingConnection(state, id);
      teaching.saveTeachingConnection(state, { ...current, ...flags });
    });
  }
  disconnectTeachingWebsite(id: string) {
    assertID(id);
    return this.mutate((state) => {
      state.teachingConnections = state.teachingConnections.filter(
        (c) => String(c.id).toUpperCase() !== id.toUpperCase(),
      );
    });
  }
  restoreIgnoredTeachingItems(id: string) {
    return this.mutate((state) => teaching.restoreIgnoredTeachingItems(state, id));
  }
  saveAppearance(input: AppearancePatch, expected?: string) {
    const patch = validateAppearancePatch(input);
    return this.mutate((state) => {
      if (expected !== undefined && digest(JSON.stringify(state)) !== expected)
        throw new Error('资料库已变化，请重新调整外观');
      const transition = patch.appearanceTransition;
      const previous = state.appearanceTransition as Record<string, unknown> | undefined;
      Object.assign(state, patch);
      if (transition) state.appearanceTransition = { ...previous, ...transition };
    });
  }
  saveToolbarSettings(actions: string[], expected?: string) {
    return this.mutate((state) => {
      if (expected !== undefined && digest(JSON.stringify(state)) !== expected)
        throw new Error('资料库已变化，请重新调整顶栏');
      state.toolbarSettings = {
        ...(state.toolbarSettings as Record<string, unknown> | undefined),
        actions: readToolbarActions({ actions }),
      };
    });
  }
  finishTeachingUpdate(id: string, messages: teaching.TeachingSyncMessage[], completed: boolean) {
    return this.mutate((state) => {
      const c = teaching.getTeachingConnection(state, id);
      c.messages = messages.slice(-300).map((m) => {
        assertID(m.id);
        return { id: m.id, text: textValue(m.text, 20000), isIssue: !!m.isIssue };
      });
      if (completed) c.lastSyncAt = swiftNow();
      state.teachingConnections[state.teachingConnections.findIndex((value) => value.id === c.id)] =
        c;
    });
  }
  previewTeachingAssignment(
    id: string,
    activity: teaching.TeachingActivity,
    page: teaching.TeachingPage,
    now = swiftNow(),
  ) {
    return this.withWorkspace((state) =>
      Promise.resolve(teaching.mergeTeachingAssignment(state, id, activity, page, now)),
    );
  }
  teachingFileState(
    connectionID: string,
    activity: teaching.TeachingActivity,
    file: teachingMaterials.TeachingFile,
  ) {
    return this.withWorkspace((state) =>
      Promise.resolve(teachingMaterials.teachingFileState(state, connectionID, activity, file)),
    );
  }
  async syncTeachingFile(
    connectionID: string,
    activity: teaching.TeachingActivity,
    file: teachingMaterials.TeachingFile,
    downloadedPath: string,
    options: teachingMaterials.TeachingFileOptions = {},
  ) {
    return this.serial(async () => {
      await this.synchronize();
      this.mutationGuard.getStore()?.(this.state);
      const state = this.state,
        ops: FileOp[] = [];
      const { changed, ...result } = await teachingMaterials.prepareTeachingFile(
        this.root,
        state,
        connectionID,
        activity,
        file,
        downloadedPath,
        options,
        ops,
      );
      this.mutationGuard.getStore()?.(this.state);
      return { snapshot: changed ? await this.write(state, ops) : this.snapshot(), ...result };
    });
  }
  listMaterialVersions(materialID: string) {
    return this.withWorkspace((state) =>
      Promise.resolve({
        ...teachingMaterials.materialVersions(state, materialID),
        revision: digest(JSON.stringify(state)),
      }),
    );
  }
  async restoreMaterialVersion(currentID: string, versionID: string, expectedRevision?: string) {
    let result!: { materialID: string; message: string };
    const snapshot = await this.mutate(async (state, ops) => {
      if (expectedRevision !== undefined && digest(JSON.stringify(state)) !== expectedRevision)
        throw new Error('资料库已变化，请重新读取版本列表');
      result = await teachingMaterials.prepareRestoreMaterialVersion(
        this.root,
        state,
        currentID,
        versionID,
        ops,
      );
    });
    return { snapshot, ...result };
  }
  async syncTeachingAssignment(
    id: string,
    activity: teaching.TeachingActivity,
    page: teaching.TeachingPage,
    now = swiftNow(),
    newID?: string,
    deadlineChoice?: boolean,
  ) {
    let change!: teaching.TeachingAssignmentChange;
    const snapshot = await this.mutate((state) => {
      change = teaching.mergeTeachingAssignment(state, id, activity, page, now, newID);
      if (change.pendingDeadline && deadlineChoice !== undefined) {
        teaching.resolveTeachingDeadline(state, id, 'plan:' + activity.id, deadlineChoice);
        change.proposed = state.tasks.find((t) => t.id === change.proposed?.id);
        delete change.pendingDeadline;
      }
    });
    return { snapshot, change, message: change.message };
  }
  resolveTeachingDeadline(id: string, key: string, useWebsite: boolean, expectedRevision?: string) {
    return this.mutate((state) => {
      if (expectedRevision !== undefined && digest(JSON.stringify(state)) !== expectedRevision)
        throw new Error('资料库已变化，请重新查看截止冲突');
      teaching.resolveTeachingDeadline(state, id, key, useWebsite);
    });
  }
  setHomeworkFolder(courseID: string, candidate?: string) {
    return this.mutate(async (state) => {
      assertID(courseID);
      const c = state.courses.find((c) => c.id.toUpperCase() === courseID.toUpperCase());
      if (!c) throw new Error('课程不存在');
      if (candidate === undefined) delete c.homeworkFolder;
      else c.homeworkFolder = await validateHomeworkMount(this.root, state, c.id, candidate);
    });
  }
  onChanged?: (s: Snapshot) => void;
  private constructor(root: string) {
    this.root = root;
  }
  static async open(input: string, { create = false } = {}): Promise<Repository> {
    await fs.mkdir(input, { recursive: true });
    const root = await fs.realpath(input);
    const repo = new Repository(root);
    const index = await safePath(root, 'library.json', true);
    const mark = await safePath(root, marker, true);
    if ((await exists(index)) && !(await exists(mark)))
      throw new Error('这是原生资料库。请使用“复制导入资料库”，原库将保持不变。');
    if (!(await exists(index)) && !create) throw new Error('找不到资料库索引');
    repo.release = await lockfile.lock(root, {
      realpath: false,
      lockfilePath: path.join(root, '.desktop-writer.lock'),
      stale: 15000,
      retries: 0,
      onCompromised: (error) => {
        repo.warnings.push(error.message);
        repo.release = undefined;
      },
    });
    try {
      if (!(await exists(index))) {
        if (await exists(await safePath(root, 'library.json.bak', true)))
          throw new Error('主索引丢失但存在备份，拒绝创建空资料库');
        await atomicWrite(root, 'library.json', JSON.stringify(emptyLibrary(), null, 2) + '\n');
        await atomicWrite(root, marker, JSON.stringify({ version: 1 }));
      }
      await recoverTransaction(root);
      repo.stateValue = decodeLibrary(JSON.parse(await fs.readFile(index, 'utf8')));
      await fs.mkdir(await safePath(root, 'files', true), { recursive: true });
      for (const name of [
        '.physical-storage.jsonl',
        '.physical-storage.json',
        '.material-relocation.json',
      ])
        if (await exists(await safePath(root, name, true)))
          throw new Error('资料库有未完成的原生事务，请先使用原版恢复再复制导入');
      const obs = await safePath(root, '.desktop-observations.json', true);
      if (await exists(obs)) repo.observations = JSON.parse(await fs.readFile(obs, 'utf8'));
      const removed = await safePath(root, '.desktop-removed.json', true);
      if (await exists(removed))
        repo.removed = new Set(JSON.parse(await fs.readFile(removed, 'utf8')));
      const next = repo.state;
      const ops: FileOp[] = [];
      const upgrading = next.schemaVersion < 9;
      if (upgrading) {
        const directories = next.courses.flatMap((c) => [
          materialRoot(next, c.id),
          courseDirectory(c) + '/作业',
        ]);
        directories.push(
          ...next.materialFolders.filter((f) => !f.isMissing).map((f) => folderDirectory(next, f)),
        );
        await repo.directories(directories, ops);
        for (const m of next.materials)
          if (m.isManaged && !m.isMissing) {
            const from = m.storedPath;
            const to = materialPath(next, m);
            if (from !== to) {
              await repo.directories([path.posix.dirname(to)], ops);
              ops.push({ kind: 'move', from, to });
              m.storedPath = to;
            }
          }
        next.schemaVersion = 9;
      }
      const homework = await prepareLegacyHomework(root, next, ops);
      if (homework.sourceRoots.length)
        next.desktopLegacyHomeworkMigration = { version: 1, sourceRoots: homework.sourceRoots };
      if (upgrading || homework.sourceRoots.length) {
        await commitTransaction(root, next, ops);
        repo.stateValue = next;
      }
      if (upgrading)
        repo.warnings.push('已在副本中升级旧版课件目录到 schema 9；原资料库保留不变。');
      if (homework.sourceRoots.length)
        repo.warnings.push(
          `已迁移旧作业 ${homework.copied} 个文件、合并 ${homework.deduplicated} 个相同文件；旧目录原件保留，冲突内容另存。`,
        );
      await repo.synchronize();
      return repo;
    } catch (e) {
      await repo.close();
      throw e;
    }
  }
  close(): Promise<void> {
    // Stop accepting work immediately, then drain everything already queued.
    // Concurrent callers share the same release rather than releasing twice.
    this.closing ??= (async () => {
      await this.queue;
      if (this.release) {
        await this.release();
        this.release = undefined;
      }
    })();
    return this.closing;
  }
  get state() {
    return structuredClone(this.stateValue);
  }
  snapshot(): Snapshot {
    return {
      root: this.root,
      workspaceID: this.workspaceID,
      sequence: ++snapshotSequence,
      state: this.state,
      revision: digest(JSON.stringify(this.stateValue)),
      warnings: [...this.warnings],
      canUndoTimetable: this.canUndoTimetable(),
    };
  }
  private serial<T>(action: () => Promise<T>): Promise<T> {
    if (this.closing) return Promise.reject(new Error('资料库正在关闭或已关闭'));
    const p = this.queue.then(() => {
      if (!this.release) throw new Error('资料库已关闭或写入锁失效');
      return action();
    });
    this.queue = p.catch(() => {});
    return p;
  }
  private async directories(paths: string[], ops: FileOp[]) {
    const planned = new Set(ops.map((o) => o.to));
    for (const rel of paths) {
      const parts = rel.split('/');
      for (let n = 2; n <= parts.length; n++) {
        const p = parts.slice(0, n).join('/');
        if (!planned.has(p) && !(await exists(await safePath(this.root, p)))) {
          ops.push({ kind: 'mkdir', to: p });
          planned.add(p);
        }
      }
    }
  }
  private async write(next: LibraryState, ops: FileOp[] = []) {
    decodeLibrary(next);
    const disk = decodeLibrary(
      JSON.parse(await fs.readFile(await safePath(this.root, 'library.json', true), 'utf8')),
    );
    if (digest(JSON.stringify(disk)) !== digest(JSON.stringify(this.stateValue)))
      throw new Error('索引被另一程序修改，请重新打开资料库，防止覆盖');
    const guard = this.mutationGuard.getStore();
    await commitTransaction(
      this.root,
      next,
      ops,
      undefined,
      guard ? () => guard(this.state) : undefined,
    );
    this.stateValue = next;
    await this.refreshObservations();
    this.onChanged?.(this.snapshot());
    return this.snapshot();
  }
  private course(state: LibraryState, courseID?: string) {
    if (courseID) {
      assertID(courseID);
      if (!state.courses.some((c) => c.id === courseID)) throw new Error('课程不存在');
    }
  }
  private folder(state: LibraryState, folderID?: string, courseID?: string) {
    if (folderID) {
      assertID(folderID);
      if (!state.materialFolders.some((f) => f.id === folderID && f.courseID === courseID))
        throw new Error('文件夹不属于该课程');
    }
  }
  private async mutate(change: (next: LibraryState, ops: FileOp[]) => Promise<void> | void) {
    return this.serial(async () => {
      await this.synchronize();
      this.mutationGuard.getStore()?.(this.state);
      const next = this.state;
      const ops: FileOp[] = [];
      await change(next, ops);
      return this.write(next, ops);
    });
  }
  async createCourse(input: Partial<Course>) {
    return this.mutate(async (s, ops) => {
      const c: Course = {
        id: input.id ?? id(),
        name: requiredText(input.name),
        semester: textValue(input.semester ?? ''),
        teacher: textValue(input.teacher ?? ''),
        colorHex: input.colorHex ?? '#39786B',
        isArchived: input.isArchived ?? false,
      };
      assertID(c.id);
      if (typeof c.isArchived !== 'boolean') throw new Error('无效归档状态');
      s.courses.push(c);
      await this.directories([materialRoot(s, c.id), courseDirectory(c) + '/作业'], ops);
    });
  }
  async updateCourse(courseID: string, patch: Partial<Course>) {
    assertID(courseID);
    return this.mutate(async (s, ops) => {
      const c = s.courses.find((c) => c.id === courseID);
      if (!c) throw new Error('课程不存在');
      const old = courseDirectory(c);
      if (patch.name !== undefined) c.name = requiredText(patch.name);
      for (const k of ['semester', 'teacher', 'colorHex'] as const)
        if (patch[k] !== undefined) c[k] = textValue(patch[k]);
      if (patch.isArchived !== undefined) {
        if (typeof patch.isArchived !== 'boolean') throw new Error('无效归档状态');
        c.isArchived = patch.isArchived;
      }
      if (patch.materialSort !== undefined) {
        if (!['name', 'time', 'custom'].includes(patch.materialSort))
          throw new Error('无效排序方式');
        c.materialSort = patch.materialSort;
      }
      if (patch.name !== undefined) {
        const target = path.posix.dirname(old) + '/' + component(c.name) + ` [${c.id}]`;
        if (target !== old) {
          if (c.isMissing) throw new Error('课程目录缺失，请先恢复文件');
          c.storageDirectory = target;
          if (await exists(await safePath(this.root, old)))
            ops.push({ kind: 'move', from: old, to: target });
          this.remap(s, old, target);
        }
      }
      for (const task of s.tasks)
        if (!task.archivedAt) {
          if (task.courseID === c.id) task.courseNameSnapshot = c.name;
          for (const e of task.exceptions ?? []) {
            const d = e.details as Record<string, unknown> | undefined;
            if (d?.courseID === c.id) d.courseNameSnapshot = c.name;
          }
        }
    });
  }
  private remap(s: LibraryState, from: string, to: string) {
    const replace = (p: string) =>
      p === from ? to : p.startsWith(from + '/') ? to + p.slice(from.length) : p;
    for (const c of s.courses)
      if (c.storageDirectory) c.storageDirectory = replace(c.storageDirectory);
    for (const f of s.materialFolders)
      if (f.storageDirectory) f.storageDirectory = replace(f.storageDirectory);
    for (const m of s.materials) {
      if (m.isManaged) m.storedPath = replace(m.storedPath);
      if (m.storageDirectory) m.storageDirectory = replace(m.storageDirectory);
    }
  }
  async deleteCourse(courseID: string) {
    return this.mutate(async (s, ops) => {
      const c = s.courses.find((c) => c.id === courseID);
      if (!c) throw new Error('课程不存在');
      await this.relocate(
        s,
        ops,
        s.materials.filter((m) => m.courseID === courseID).map((m) => m.id),
      );
      s.courses = s.courses.filter((c) => c.id !== courseID);
      s.materialFolders = s.materialFolders.filter((f) => f.courseID !== courseID);
      s.teachingConnections = s.teachingConnections.filter((c) => c.courseID !== courseID);
      for (const t of s.tasks) {
        if (t.courseID === courseID) {
          delete t.courseID;
          if (!t.archivedAt || t.courseNameSnapshot == null) t.courseNameSnapshot = c.name;
        }
        for (const e of t.exceptions ?? []) {
          const d = e.details as Record<string, unknown> | undefined;
          if (d?.courseID === courseID) {
            delete d.courseID;
            if (!t.archivedAt || d.courseNameSnapshot == null) d.courseNameSnapshot = c.name;
          }
        }
      }
      const unlink = (value: unknown) => {
        if (!value || typeof value !== 'object') return;
        for (const [key, v] of Object.entries(value)) {
          if (key === 'courseID' && v === courseID) delete (value as Record<string, unknown>)[key];
          else unlink(v);
        }
      };
      for (const term of s.timetableTerms) unlink(term);
    });
  }
  async importFiles(
    paths: string[],
    input: { courseID?: string; folderID?: string; category?: string; copy?: boolean } = {},
  ): Promise<ImportResult> {
    const result: ImportResult = { imported: 0, skipped: 0, errors: [] };
    await this.mutate(async (s, ops) => {
      this.course(s, input.courseID);
      this.folder(s, input.folderID, input.courseID);
      const candidates: string[] = [];
      const visit = async (p: string) => {
        try {
          const safe = await safeExternal(p);
          const st = await fs.lstat(safe);
          if (st.isDirectory()) {
            for (const item of await fs.readdir(safe))
              if (!item.startsWith('.')) await visit(path.join(safe, item));
          } else if (st.isFile()) candidates.push(safe);
          else throw new Error('只支持普通文件');
        } catch (e) {
          result.errors.push(`${path.basename(p)}：${String(e)}`);
        }
      };
      for (const p of paths) await visit(p);
      const seen = new Set(
        s.materials.filter((m) => m.courseID === input.courseID).map((m) => m.sourcePath),
      );
      for (const p of candidates) {
        if (seen.has(p)) {
          result.skipped++;
          continue;
        }
        const st = await fs.stat(p);
        const name = path.basename(p);
        const m: Material = {
          id: id(),
          courseID: input.courseID,
          folderID: input.folderID,
          title: path.basename(name, path.extname(name)),
          originalName: name,
          sourcePath: p,
          storedPath: p,
          isManaged: input.copy !== false,
          category: requiredText(input.category ?? '课件', 100),
          tags: '',
          notes: '',
          isFavorite: false,
          size: st.size,
          addedAt: swiftNow(),
        };
        if (m.isManaged) {
          m.storedPath = materialPath(s, m);
          await this.directories([path.posix.dirname(m.storedPath)], ops);
          ops.push({ kind: 'copy', from: p, to: m.storedPath });
        }
        s.materials.push(m);
        seen.add(p);
        result.imported++;
      }
    });
    return result;
  }
  async updateMaterial(materialID: string, patch: Partial<Material> & { filename?: string }) {
    return this.mutate(async (s, ops) => {
      const m = s.materials.find((m) => m.id === materialID);
      if (!m) throw new Error('资料不存在');
      for (const k of ['title', 'category', 'tags', 'notes'] as const)
        if (patch[k] !== undefined)
          m[k] =
            k === 'title' || k === 'category'
              ? requiredText(patch[k])
              : textValue(patch[k], 100000);
      if (patch.isFavorite !== undefined) {
        if (typeof patch.isFavorite !== 'boolean') throw new Error('无效收藏状态');
        m.isFavorite = patch.isFavorite;
      }
      if (patch.filename !== undefined) {
        if (!m.isManaged) throw new Error('外部引用不能重命名原文件');
        if (m.isMissing) throw new Error('文件缺失');
        const name = fileName(patch.filename);
        if (path.extname(name).toLowerCase() !== path.extname(m.originalName).toLowerCase())
          throw new Error('重命名必须保留扩展名');
        const from = m.storedPath;
        const to = path.posix.dirname(from) + '/' + name;
        if (to !== from) {
          ops.push({ kind: 'move', from, to });
          m.storedPath = to;
          m.storageName = name;
          m.originalName = name;
        }
      }
      if (patch.lastOpenedAt !== undefined) m.lastOpenedAt = patch.lastOpenedAt;
    });
  }
  private async relocate(
    s: LibraryState,
    ops: FileOp[],
    ids: string[],
    courseID?: string,
    folderID?: string,
  ) {
    this.course(s, courseID);
    this.folder(s, folderID, courseID);
    for (const mid of ids) {
      const m = s.materials.find((m) => m.id === mid);
      if (!m) throw new Error('资料不存在');
      if (m.courseID === courseID && m.folderID === folderID) continue;
      const from = m.storedPath;
      m.courseID = courseID;
      m.folderID = folderID;
      delete m.storageDirectory;
      delete m.customOrder;
      if (m.isManaged && !m.isMissing) {
        let to = materialPath(s, m);
        if (to !== from) {
          if ((await exists(await safePath(this.root, to))) || ops.some((o) => o.to === to)) {
            m.storageName = m.id + '-' + component(m.originalName, 218);
            to = materialPath(s, m);
          }
          await this.directories([path.posix.dirname(to)], ops);
          ops.push({ kind: 'move', from, to });
          m.storedPath = to;
        }
      }
    }
  }
  async moveMaterials(ids: string[], courseID?: string, folderID?: string) {
    return this.mutate((s, ops) => this.relocate(s, ops, ids, courseID, folderID));
  }
  async removeMaterials(ids: string[]) {
    return this.mutate(async (s) => {
      for (const m of s.materials.filter((m) => ids.includes(m.id))) {
        const ob = this.observations['file:' + m.id];
        if (ob) this.removed.add(ob.identity);
      }
      await atomicWrite(this.root, '.desktop-removed.json', JSON.stringify([...this.removed]));
      s.materials = s.materials.filter((m) => !ids.includes(m.id));
      for (const t of s.tasks) {
        t.materialIDs = t.materialIDs.filter((mid) => !ids.includes(mid));
        for (const e of t.exceptions ?? []) {
          const d = e.details as Record<string, unknown> | undefined;
          if (Array.isArray(d?.materialIDs))
            d.materialIDs = d.materialIDs.filter((mid) => !ids.includes(String(mid)));
        }
      }
    });
  }
  async createFolder(input: Partial<MaterialFolder>) {
    return this.mutate(async (s, ops) => {
      this.course(s, input.courseID);
      this.folder(s, input.parentID, input.courseID);
      const f: MaterialFolder = {
        id: input.id ?? id(),
        name: fileName(requiredText(input.name)),
        courseID: input.courseID,
        parentID: input.parentID,
        createdAt: swiftNow(),
      };
      if (input.colorHex !== undefined) f.colorHex = textValue(input.colorHex);
      if (
        s.materialFolders.some(
          (v) =>
            v.courseID === f.courseID &&
            v.parentID === f.parentID &&
            v.name.normalize('NFC').toLowerCase() === f.name.normalize('NFC').toLowerCase(),
        )
      )
        throw new Error('同层文件夹名称重复');
      s.materialFolders.push(f);
      await this.directories([folderDirectory(s, f)], ops);
    });
  }
  async updateFolder(folderID: string, patch: Partial<MaterialFolder>) {
    return this.mutate(async (s, ops) => {
      const f = s.materialFolders.find((f) => f.id === folderID);
      if (!f) throw new Error('文件夹不存在');
      if (f.isMissing) throw new Error('文件夹缺失');
      const from = folderDirectory(s, f),
        originalCourseID = f.courseID,
        originalParentID = f.parentID,
        originalName = f.name;
      const descendants = new Set([f.id]);
      let added = true;
      while (added) {
        added = false;
        for (const child of s.materialFolders)
          if (child.parentID && descendants.has(child.parentID) && !descendants.has(child.id)) {
            descendants.add(child.id);
            added = true;
          }
      }
      if (patch.name !== undefined) f.name = fileName(requiredText(patch.name));
      if ('colorHex' in patch) {
        if (patch.colorHex === undefined) delete f.colorHex;
        else f.colorHex = textValue(patch.colorHex);
      }
      if ('courseID' in patch) {
        f.courseID = patch.courseID;
        if (f.courseID !== originalCourseID && !('parentID' in patch)) delete f.parentID;
      }
      if ('parentID' in patch) f.parentID = patch.parentID;
      if (f.parentID && descendants.has(f.parentID)) throw new Error('不能移入自身子目录');
      this.course(s, f.courseID);
      this.folder(s, f.parentID, f.courseID);
      for (const child of s.materialFolders)
        if (descendants.has(child.id)) child.courseID = f.courseID;
      for (const m of s.materials)
        if (m.folderID && descendants.has(m.folderID)) {
          if (m.courseID !== f.courseID) delete m.customOrder;
          m.courseID = f.courseID;
        }
      const moving = f.courseID !== originalCourseID || f.parentID !== originalParentID;
      if (moving) delete f.storageDirectory;
      else if (f.name !== originalName && f.storageDirectory)
        f.storageDirectory = path.posix.dirname(f.storageDirectory) + '/' + f.name;
      decodeLibrary(s);
      const to = folderDirectory(s, f);
      if (to.startsWith(from + '/')) throw new Error('不能移入自身子目录');
      if (to !== from) {
        await this.directories([path.posix.dirname(to)], ops);
        ops.push({ kind: 'move', from, to });
        this.remap(s, from, to);
      }
    });
  }
  async dissolveFolder(folderID: string) {
    return this.mutate(async (s, ops) => {
      const f = s.materialFolders.find((f) => f.id === folderID);
      if (!f) throw new Error('文件夹不存在');
      const ids = new Set([folderID]);
      let n = 0;
      while (n !== ids.size) {
        n = ids.size;
        for (const child of s.materialFolders)
          if (child.parentID && ids.has(child.parentID)) ids.add(child.id);
      }
      await this.relocate(
        s,
        ops,
        s.materials.filter((m) => m.folderID && ids.has(m.folderID)).map((m) => m.id),
        f.courseID,
        f.parentID,
      );
      s.materialFolders = s.materialFolders.filter((f) => !ids.has(f.id));
    });
  }
  async importTimetable(
    schedule: unknown,
  ): Promise<{ snapshot: Snapshot; summary: TimetableImportSummary }> {
    let summary!: TimetableImportSummary;
    const snapshot = await this.mutate(async (s, ops) => {
      const previous = new Set(s.courses.map((c) => c.id));
      summary = importUndergraduateTimetable(s, schedule);
      await this.directories(
        s.courses
          .filter((c) => !previous.has(c.id))
          .flatMap((c) => [materialRoot(s, c.id), courseDirectory(c) + '/作业']),
        ops,
      );
    });
    return { snapshot, summary };
  }
  async saveTimetableSettings(termID: string, input: TimetableSettingsInput) {
    return this.changeTimetable((s) => updateTimetableSettings(s, termID, input));
  }
  private async changeTimetable(change: (state: LibraryState) => boolean | void) {
    return this.serial(async () => {
      await this.synchronize();
      this.mutationGuard.getStore()?.(this.state);
      const next = this.state,
        before = structuredClone(next.timetableTerms);
      if (change(next) === false || JSON.stringify(next.timetableTerms) === JSON.stringify(before))
        return this.snapshot();
      const previous = this.timetableUndo;
      this.timetableUndo = { before, after: JSON.stringify(next.timetableTerms) };
      try {
        return await this.write(next);
      } catch (error) {
        this.timetableUndo = previous;
        throw error;
      }
    });
  }
  async cancelTimetableClass(termID: string, meetingID: string, date: SwiftDate, reason = '') {
    return this.changeTimetable((s) =>
      cancelTimetableOccurrence(s, termID, meetingID, date, reason),
    );
  }
  async restoreTimetableClass(termID: string, cancellationID: string) {
    return this.changeTimetable((s) => restoreTimetableOccurrence(s, termID, cancellationID));
  }
  async rescheduleTimetableClass(
    termID: string,
    meetingID: string,
    date: SwiftDate,
    input: TimetableRescheduleInput,
  ) {
    return this.changeTimetable((s) =>
      rescheduleTimetableOccurrence(s, termID, meetingID, date, input),
    );
  }
  async restoreTimetableMove(termID: string, rescheduleID: string) {
    return this.changeTimetable((s) => restoreTimetableReschedule(s, termID, rescheduleID));
  }
  async setTimetableMeetingMonthVisible(termID: string, meetingID: string, visible: boolean) {
    return this.changeTimetable((s) => setTimetableMonthVisible(s, termID, meetingID, visible));
  }
  async updateTimetableMeeting(termID: string, meetingID: string, input: TimetableMeetingInput) {
    return this.changeTimetable((s) => updateTimetableMeeting(s, termID, meetingID, input));
  }
  async setTimetableMeetingColor(termID: string, meetingID: string, hex: string | null) {
    return this.changeTimetable((s) => setTimetableMeetingColor(s, termID, meetingID, hex));
  }
  async deleteTimetableMeeting(termID: string, meetingID: string) {
    return this.changeTimetable((s) => deleteTimetableMeeting(s, termID, meetingID));
  }
  async undoTimetableChange() {
    return this.serial(async () => {
      await this.synchronize();
      this.mutationGuard.getStore()?.(this.state);
      if (!this.canUndoTimetable()) throw new Error('课表后来已变化，无法撤销');
      const record = this.timetableUndo!,
        next = this.state;
      next.timetableTerms = structuredClone(record.before);
      validateTimetables(next);
      this.timetableUndo = undefined;
      try {
        return await this.write(next);
      } catch (error) {
        this.timetableUndo = record;
        throw error;
      }
    });
  }
  async savePlan(
    input: Partial<StudyTask>,
    scope: PlanEditScope = 'all',
    originalDate?: SwiftDate,
  ) {
    return this.mutate((s) => saveAdvancedPlan(s, input, scope, originalDate));
  }
  async setPlanOccurrenceTime(
    id: string,
    originalDate: SwiftDate,
    day: SwiftDate,
    range: { start: number; end: number },
  ) {
    return this.mutate((state) => setPlanOccurrenceTime(state, id, originalDate, day, range));
  }
  async setPlanStatus(
    planID: string,
    status: PlanStatus,
    scope: PlanEditScope = 'all',
    originalDate?: SwiftDate,
  ) {
    return this.mutate((s) => changePlanStatus(s, planID, status, scope, originalDate));
  }
  async deletePlan(planID: string, scope: PlanEditScope = 'all', originalDate?: SwiftDate) {
    return this.mutate((s) => removeAdvancedPlan(s, planID, scope, originalDate));
  }
  async saveTask(input: Partial<StudyTask> & { title: string }) {
    return this.mutate((s) => {
      const existing = s.tasks.find((t) => t.id === input.id);
      const now = swiftNow();
      const t: StudyTask = existing
        ? { ...existing, ...input }
        : {
            id: input.id ?? id(),
            content: '',
            kind: '任务',
            materialIDs: [],
            startsAt: now,
            isAllDay: true,
            showOnCalendar: true,
            origin: 'activity',
            hasExecutionTime: true,
            location: '',
            showInMonth: false,
            completionRequired: true,
            deadlineIsAllDay: true,
            exceptions: [],
            ...input,
          };
      t.id = input.id ?? existing?.id ?? id();
      t.title = requiredText(t.title);
      this.course(s, t.courseID);
      if (t.materialIDs.some((mid) => !s.materials.some((m) => m.id === mid)))
        throw new Error('计划关联资料不存在');
      if (t.endsAt !== undefined && dateMs(t.endsAt) < dateMs(t.startsAt))
        throw new Error('结束时间早于开始');
      if (existing?.origin === 'fixed' || existing?.repeatRule) {
        const changed = Object.keys(input).filter(
          (k) =>
            !['id', 'title', 'completedAt', 'archivedAt'].includes(k) &&
            JSON.stringify(input[k]) !== JSON.stringify(existing[k]),
        );
        if (changed.length) throw new Error('固定课表与重复规则暂仅支持保留和状态修改');
      }
      if (existing) s.tasks[s.tasks.findIndex((v) => v.id === t.id)] = t;
      else s.tasks.push(t);
    });
  }
  async deleteTasks(ids: string[]) {
    return this.mutate((s) => {
      s.tasks = s.tasks.filter((t) => !ids.includes(t.id));
    });
  }
  async resolveMaterial(materialID: string) {
    const m = this.stateValue.materials.find((m) => m.id === materialID);
    if (!m) throw new Error('资料不存在');
    if (m.isMissing) throw new Error('资料文件缺失');
    const p = m.isManaged
      ? await safePath(this.root, m.storedPath)
      : await safeExternal(m.storedPath);
    if (!(await fs.stat(p)).isFile()) throw new Error('不是普通文件');
    return p;
  }
  private tracked(s = this.stateValue) {
    const result: Record<string, string> = {};
    for (const c of s.courses) {
      result['course:' + c.id] = courseDirectory(c);
      result['root:' + c.id] = materialRoot(s, c.id);
    }
    for (const f of s.materialFolders) result['folder:' + f.id] = folderDirectory(s, f);
    for (const m of s.materials) if (m.isManaged) result['file:' + m.id] = m.storedPath;
    return result;
  }
  private async scan(): Promise<Map<string, Entry>> {
    const entries = new Map<string, Entry>();
    const walk = async (rel: string) => {
      const p = await safePath(this.root, rel, true);
      for (const e of await fs.readdir(p, { withFileTypes: true })) {
        if (e.name.startsWith('.') || e.isSymbolicLink()) continue;
        const relative = rel + '/' + e.name;
        const stat = await fs.lstat(path.join(p, e.name));
        if (!stat.isDirectory() && !stat.isFile()) continue;
        entries.set(relative, {
          path: relative,
          identity: identity(stat),
          size: stat.size,
          directory: stat.isDirectory(),
        });
        if (stat.isDirectory()) await walk(relative);
      }
    };
    await walk('files');
    return entries;
  }
  private async refreshObservations(entries?: ReadonlyMap<string, Entry>) {
    const next: Record<string, Observation> = {};
    const missing = new Set<string>();
    for (const c of this.stateValue.courses)
      if (c.isMissing) {
        missing.add('course:' + c.id);
        missing.add('root:' + c.id);
      }
    for (const f of this.stateValue.materialFolders) if (f.isMissing) missing.add('folder:' + f.id);
    for (const m of this.stateValue.materials) if (m.isMissing) missing.add('file:' + m.id);
    for (const [key, relative] of Object.entries(this.tracked())) {
      if (missing.has(key)) {
        if (this.observations[key]) next[key] = this.observations[key];
        continue;
      }
      if (entries) {
        // synchronize() has already safely walked this tree. Keep that scan's
        // path/identity pairing rather than restating every tracked file.
        const entry = entries.get(relative);
        if (entry) next[key] = { path: relative, identity: entry.identity, size: entry.size };
        else if (this.observations[key]) next[key] = this.observations[key];
      } else {
        // Writes may have moved or imported files since the preceding scan.
        // Recheck their paths and identities before publishing observations.
        const p = await safePath(this.root, relative);
        if (await exists(p)) {
          const st = await fs.lstat(p);
          next[key] = { path: relative, identity: identity(st), size: st.size };
        } else if (this.observations[key]) next[key] = this.observations[key];
      }
    }
    await atomicWrite(this.root, '.desktop-observations.json', JSON.stringify(next));
    this.observations = next;
  }
  async sync() {
    return this.serial(async () => {
      await this.synchronize();
      return this.snapshot();
    });
  }
  private async synchronize() {
    await recoverTransaction(this.root);
    const diskIndex = decodeLibrary(
      JSON.parse(await fs.readFile(await safePath(this.root, 'library.json', true), 'utf8')),
    );
    if (digest(JSON.stringify(diskIndex)) !== digest(JSON.stringify(this.stateValue)))
      throw new Error('索引被另一程序修改，请重新打开资料库，防止覆盖');
    const entries = await this.scan();
    const identities = new Map<string, Entry[]>();
    for (const entry of entries.values()) {
      const entryIdentity = entry.identity;
      const matches = identities.get(entryIdentity);
      if (matches) matches.push(entry);
      else identities.set(entryIdentity, [entry]);
    }
    const s = this.state;
    const tracked = this.tracked();
    const locate = (key: string, missing?: boolean) => {
      const ob = this.observations[key];
      const matches = ob ? (identities.get(ob.identity) ?? []) : [];
      const exact = entries.get(tracked[key]);
      return (
        (ob && exact?.identity === ob.identity ? exact : undefined) ??
        (matches.length === 1 ? matches[0] : undefined) ??
        (!missing ? exact : undefined)
      );
    };
    for (const c of s.courses) {
      const e = locate('course:' + c.id, c.isMissing);
      if (e?.directory) {
        delete c.isMissing;
        if (e.path !== tracked['course:' + c.id]) {
          c.storageDirectory = e.path;
          c.name = path.posix.basename(e.path).replace(new RegExp(' \\[' + c.id + '\\]$'), '');
        }
        const r = locate('root:' + c.id);
        if (r && path.posix.dirname(r.path) === e.path)
          c.materialRootName = path.posix.basename(r.path);
      } else c.isMissing = true;
    }
    const anchors = new Map<string, { courseID?: string; folderID?: string }>([
      ['files', {}],
      ['files/未分类', {}],
      ['files/未分类/资料', {}],
    ]);
    for (const c of s.courses)
      if (!c.isMissing) {
        anchors.set(courseDirectory(c), { courseID: c.id });
        anchors.set(materialRoot(s, c.id), { courseID: c.id });
      }
    const locatedFolders = new Map<string, MaterialFolder>();
    for (const f of s.materialFolders) {
      const e = locate('folder:' + f.id, f.isMissing);
      if (e?.directory && !anchors.has(e.path)) {
        locatedFolders.set(e.path, f);
        delete f.isMissing;
      } else f.isMissing = true;
    }
    const ensureFolder = (rel: string): { courseID?: string; folderID?: string } => {
      const anchor = anchors.get(rel);
      if (anchor) return anchor;
      const entry = entries.get(rel);
      if (!entry?.directory) throw new Error('文件夹不存在：' + rel);
      const parent = ensureFolder(path.posix.dirname(rel));
      let f = locatedFolders.get(rel);
      if (!f) {
        f = {
          id: id(),
          name: path.posix.basename(rel),
          ...parent,
          parentID: parent.folderID,
          createdAt: swiftNow(),
        };
        delete (f as any).folderID;
        s.materialFolders.push(f);
        locatedFolders.set(rel, f);
      }
      f.courseID = parent.courseID;
      f.parentID = parent.folderID;
      f.name = path.posix.basename(rel);
      f.storageDirectory = rel;
      delete f.isMissing;
      const result = { courseID: f.courseID, folderID: f.id };
      anchors.set(rel, result);
      return result;
    };
    for (const p of [...locatedFolders.keys()].sort()) ensureFolder(p);
    for (let pass = 0; pass < s.materialFolders.length; pass++) {
      let changed = false;
      for (const f of s.materialFolders)
        if (f.isMissing && f.parentID) {
          const parent = s.materialFolders.find((p) => p.id === f.parentID);
          if (parent && f.courseID !== parent.courseID) {
            f.courseID = parent.courseID;
            changed = true;
          }
        }
      if (!changed) break;
    }
    for (const m of s.materials) {
      if (m.folderID) {
        const folder = s.materialFolders.find((f) => f.id === m.folderID);
        if (folder) m.courseID = folder.courseID;
      }
      if (!m.isManaged) continue;
      const e = locate('file:' + m.id, m.isMissing);
      if (!e || e.directory) {
        m.isMissing = true;
        continue;
      }
      const place = ensureFolder(path.posix.dirname(e.path));
      m.courseID = place.courseID;
      m.folderID = place.folderID;
      if (e.path !== m.storedPath) {
        const newName = path.posix.basename(e.path);
        if (newName !== path.posix.basename(m.storedPath)) {
          const original = newName.startsWith(m.id + '-')
            ? newName.slice(m.id.length + 1)
            : newName;
          if (m.title === path.parse(m.originalName).name) m.title = path.parse(original).name;
          m.originalName = original;
          m.storageName = newName;
        }
        m.storedPath = e.path;
        m.storageDirectory = path.posix.dirname(e.path);
        delete m.customOrder;
      }
      m.size = e.size;
      delete m.isMissing;
    }
    // Like Swift, synchronize only indexed materials; arbitrary unindexed files are retained.
    for (const t of s.tasks)
      if (!t.archivedAt) {
        const c = s.courses.find((c) => c.id === t.courseID);
        if (c) t.courseNameSnapshot = c.name;
        for (const e of t.exceptions ?? []) {
          const d = e.details as Record<string, unknown> | undefined;
          const course = s.courses.find((c) => c.id === d?.courseID);
          if (course && d) d.courseNameSnapshot = course.name;
        }
      }
    if (JSON.stringify(s) !== JSON.stringify(this.stateValue)) {
      decodeLibrary(s);
      await atomicWrite(this.root, 'library.json', JSON.stringify(s, null, 2) + '\n', true);
      this.stateValue = s;
      this.onChanged?.(this.snapshot());
    }
    await this.refreshObservations(entries);
  }
  async backup(destination: string) {
    return this.serial(async () => {
      await this.synchronize();
      await copyLibrary(this.root, destination, true);
      return destination;
    });
  }
}
/** Copies all managed/orphan files and history. The source is never opened for writing. */
export async function copyLibrary(
  source: string,
  destination: string,
  owned = false,
): Promise<void> {
  const from = await fs.realpath(source);
  let to = await safeExternal(path.resolve(destination), true);
  // Resolve existing ancestors before checking containment: filesystem casing
  // must not turn an apparently external destination into part of the source.
  let ancestor = to;
  while (!(await exists(ancestor))) ancestor = path.dirname(ancestor);
  to = path.join(await fs.realpath(ancestor), path.relative(ancestor, to));
  if (to === from || to.startsWith(from + path.sep) || from.startsWith(to + path.sep))
    throw new Error('目标必须在原资料库之外');
  if (await exists(to)) {
    if ((await fs.readdir(to)).length) throw new Error('目标目录必须为空');
  } else await fs.mkdir(to, { recursive: true });
  const before = await fs.readFile(await safePath(from, 'library.json', true), 'utf8');
  const state = decodeLibrary(JSON.parse(before));
  for (const name of [
    '.physical-storage.jsonl',
    '.physical-storage.json',
    '.material-relocation.json',
    '.desktop-transaction.json',
  ])
    if (await exists(await safePath(from, name, true)))
      throw new Error('原库有未完成事务，请先用原版打开恢复');
  const stage = path.join(path.dirname(to), '.teachshelf-import-' + randomUUID());
  await fs.mkdir(stage, { mode: 0o700 });
  try {
    const copy = async (src: string, dst: string) => {
      const st = await fs.lstat(src);
      if (st.isSymbolicLink()) throw new Error('资料库包含符号链接：' + src);
      if (st.isDirectory()) {
        await fs.mkdir(dst);
        for (const child of await fs.readdir(src))
          await copy(path.join(src, child), path.join(dst, child));
      } else if (st.isFile()) {
        await fs.copyFile(src, dst, fs.constants.COPYFILE_EXCL);
        const after = await fs.stat(src);
        if (
          st.size !== after.size ||
          st.mtimeMs !== after.mtimeMs ||
          (await digestFile(src)) !== (await digestFile(dst))
        )
          throw new Error('复制时原文件发生变化，请关闭原版再试');
      } else throw new Error('不支持特殊文件：' + src);
    };
    for (const name of await fs.readdir(from)) {
      if (
        name === '.teachshelf.lock' ||
        name === '.desktop-writer.lock' ||
        [
          '.desktop-observations.json',
          '.desktop-removed.json',
          '.desktop-transaction.json',
        ].includes(name) ||
        name.startsWith('.index-') ||
        name.startsWith('.backup-') ||
        /^\.desktop-copy-[0-9a-f-]+$/.test(name) ||
        /^\.desktop-[0-9a-f-]+\.tmp$/.test(name)
      )
        continue;
      await copy(path.join(from, name), path.join(stage, name));
    }
    if ((await fs.readFile(path.join(from, 'library.json'), 'utf8')) !== before)
      throw new Error('复制期间原索引已变化，请关闭原版再试');
    for (const m of state.materials)
      if (m.isManaged && !m.isMissing && !(await exists(await safePath(stage, m.storedPath))))
        throw new Error('原索引引用文件缺失：' + m.originalName);
    await atomicWrite(
      stage,
      marker,
      JSON.stringify({ version: 1, importedAt: new Date().toISOString(), source: from }),
    );
    await fs.rmdir(to);
    await fs.rename(stage, to);
  } catch (e) {
    await fs.rm(stage, { recursive: true, force: true });
    throw e;
  }
}
