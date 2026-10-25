import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type { LibraryState, Material, SwiftDate } from '../../../shared/model.ts';
import { assertID, dateMs, requiredText, swiftNow, textValue } from '../../../shared/model.ts';
import {
  component,
  exists,
  folderDirectory,
  materialPath,
  safeExternal,
  safePath,
} from '../filesystem/paths.ts';
import { digestFile } from '../storage/atomic.ts';
import type { FileOp } from '../storage/atomic.ts';
import { downloadURL, teachingFile, validateDownload } from './download.ts';
import {
  getTeachingConnection,
  isExperiment,
  teachingConnections,
  teachingPageURL,
  validateTeachingConnections,
} from './teaching.ts';
import type { TeachingActivity, TeachingConnection, TeachingItemLink } from './teaching.ts';

export type TeachingFile = z.infer<typeof teachingFile>;
export type TeachingFileState = 'new' | 'existing' | 'missing' | 'ignored';
export type TeachingFileStatus =
  'added' | 'updated' | 'unchanged' | 'ignored' | 'missing' | 'local-modified';
export interface TeachingFileOptions {
  restoreMissing?: boolean;
  allowLocalChanges?: boolean;
}
export interface TeachingFileChange {
  changed: boolean;
  status: TeachingFileStatus;
  message: string;
  materialID?: string;
}
export interface MaterialVersion {
  id: string;
  title: string;
  originalName: string;
  addedAt: SwiftDate;
  size: number;
  isCurrent: boolean;
  isMissing: boolean;
  digest?: string;
}
export interface MaterialVersions {
  sourcePath: string;
  currentID?: string;
  versions: MaterialVersion[];
}
interface VersionMetadata {
  role: 'current' | 'history';
  digest?: string;
  restoredFrom?: string;
  previousID?: string;
  archivedAt?: number;
}
const uuid = () => randomUUID().toUpperCase();
const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const activityKey = (activity: TeachingActivity) => `${activity.kind}:${activity.id}`;
const itemKey = (activity: TeachingActivity, file: TeachingFile) =>
  `file:${activityKey(activity)}:${file.key}`;
function validateSource(activity: TeachingActivity, input: TeachingFile): TeachingFile {
  const file = teachingFile.parse(input),
    url = teachingPageURL(activity.url);
  if (
    !['resource', 'folder', 'assign'].includes(activity.kind) ||
    url.kind !== activity.kind ||
    url.id !== activity.id
  )
    throw new Error('网站活动来源无效');
  requiredText(activity.title, 500);
  textValue(activity.section, 1000);
  textValue(activity.sectionID, 1000);
  downloadURL(file.url);
  if (file.name === '.' || file.name === '..' || /[\\/\0]/.test(file.name) || !file.name.trim())
    throw new Error('网站文件名无效');
  for (const name of file.subfolders) textValue(name, 1000);
  return file;
}
function context(
  state: LibraryState,
  connectionID: string,
  activity: TeachingActivity,
  file: TeachingFile,
) {
  validateSource(activity, file);
  const connection = getTeachingConnection(state, connectionID),
    course = state.courses.find((c) => c.id === connection.courseID);
  if (!course || course.isArchived) throw new Error('课程连接已移除或课程已归档');
  const key = itemKey(activity, file),
    previous = connection.items.find((i) => i.id === key),
    old = state.materials.find((m) => m.id === previous?.localID);
  return { connection, course, key, previous, old };
}
/** Use a synchronized repository snapshot for a whole batch; no disk scan per item. */
export function teachingFileState(
  state: LibraryState,
  connectionID: string,
  activity: TeachingActivity,
  file: TeachingFile,
): TeachingFileState {
  const { previous, old, course } = context(state, connectionID, activity, file);
  if (!previous) return 'new';
  if (previous.ignored || !old || old.courseID !== course.id || !old.isManaged) return 'ignored';
  return old.isMissing ? 'missing' : 'existing';
}
function saveConnection(state: LibraryState, connection: TeachingConnection) {
  state.teachingConnections[state.teachingConnections.findIndex((c) => c.id === connection.id)] =
    connection;
  validateTeachingConnections(state);
}
function teachingFolder(
  parts: [string, string][],
  connection: TeachingConnection,
  state: LibraryState,
): string | undefined {
  let parent: string | undefined;
  for (const [key, raw] of parts) {
    const mapped = connection.folders.find((f) => f.key === key);
    if (mapped) {
      const folder = state.materialFolders.find(
        (f) => f.id === mapped.localID && f.courseID === connection.courseID,
      );
      if (folder && !folder.isMissing) parent = folder.id;
      continue; // User-dissolved or missing folders are not silently recreated.
    }
    const name = component(raw, 100),
      siblings = state.materialFolders.filter(
        (f) => f.courseID === connection.courseID && f.parentID === parent && !f.isMissing,
      );
    const claimed = new Set(
      [...teachingConnections(state).flatMap((c) => c.folders), ...connection.folders]
        .filter((f) => f.key !== 'root' && f.key !== 'history' && !f.key.startsWith('section:'))
        .map((f) => f.localID),
    );
    const shared = key === 'root' || key === 'history' || key.startsWith('section:');
    const existing = siblings.find(
      (f) => fold(f.name) === fold(name) && (shared || !claimed.has(f.id)),
    );
    let unique = name;
    for (let n = 2; !existing && siblings.some((f) => fold(f.name) === fold(unique)); n++)
      unique = `${name} (${n})`;
    const folder = existing ?? {
      id: uuid(),
      courseID: connection.courseID,
      parentID: parent,
      name: unique,
      createdAt: swiftNow(),
    };
    if (!existing) state.materialFolders.push(folder);
    parent = folder.id;
    connection.folders.push({ key, localID: parent });
  }
  return parent;
}
async function ensureDirectories(root: string, relative: string, ops: FileOp[]) {
  const parts = relative.split('/');
  for (let n = 2; n <= parts.length; n++) {
    const to = parts.slice(0, n).join('/');
    if (ops.some((op) => op.to === to)) continue;
    const file = await safePath(root, to);
    if (await exists(file)) {
      if (!(await fs.lstat(file)).isDirectory()) throw new Error('资料目标目录被文件占用：' + to);
    } else ops.push({ kind: 'mkdir', to });
  }
}
async function immutableTarget(
  root: string,
  state: LibraryState,
  material: Material,
  ops: FileOp[],
): Promise<string> {
  delete material.storageDirectory;
  delete material.storageName;
  let target = materialPath(state, material);
  // Existing unindexed files are retained even if they occupy an old UUID path.
  if ((await exists(await safePath(root, target))) || ops.some((op) => op.to === target)) {
    material.storageName = `${uuid()}-${component(material.originalName, 180)}`;
    target = materialPath(state, material);
  }
  await ensureDirectories(root, path.posix.dirname(target), ops);
  return target;
}
function replaceActiveReferences(state: LibraryState, before: string, after: string) {
  for (const task of state.tasks)
    if (task.archivedAt == null) {
      task.materialIDs = [...new Set(task.materialIDs.map((id) => (id === before ? after : id)))];
      for (const exception of task.exceptions ?? []) {
        const details = exception.details as { materialIDs?: string[] } | undefined;
        if (Array.isArray(details?.materialIDs))
          details.materialIDs = [
            ...new Set(details.materialIDs.map((id) => (id === before ? after : id))),
          ];
      }
    }
}
async function materialFile(root: string, material: Material): Promise<string | undefined> {
  if (material.isMissing) return;
  const file = material.isManaged
    ? await safePath(root, material.storedPath)
    : await safeExternal(material.storedPath);
  if (!(await exists(file))) return;
  if (!(await fs.lstat(file)).isFile()) throw new Error('资料不是普通文件');
  return file;
}
async function archiveCurrent(
  root: string,
  state: LibraryState,
  old: Material,
  connection: TeachingConnection | undefined,
  ops: FileOp[],
  currentFile: string | undefined,
  currentHash: string | undefined,
) {
  let history = connection
    ? teachingFolder(
        [
          ['root', '教学网站'],
          ['history', '历史版本'],
        ],
        connection,
        state,
      )
    : undefined;
  if (!connection) {
    let parent: string | undefined;
    for (const name of ['教学网站', '历史版本']) {
      let folder = state.materialFolders.find(
        (f) =>
          f.courseID === old.courseID && f.parentID === parent && f.name === name && !f.isMissing,
      );
      if (!folder) {
        folder = {
          id: uuid(),
          courseID: old.courseID,
          parentID: parent,
          name,
          createdAt: swiftNow(),
        };
        state.materialFolders.push(folder);
      }
      parent = folder.id;
    }
    history = parent;
  }
  if (currentFile) {
    // The old path is retained as an unindexed recovery copy. Only the version
    // record is repointed to a new immutable file, never moving user bytes.
    const archived = { ...old, folderID: history, isManaged: true, isMissing: false };
    archived.storedPath = await immutableTarget(root, state, archived, ops);
    ops.push({ kind: 'copy', from: currentFile, to: archived.storedPath, sourceHash: currentHash });
    Object.assign(old, archived);
    if (!('storageDirectory' in archived)) delete old.storageDirectory;
    if (!('storageName' in archived)) delete old.storageName;
    delete old.isMissing;
    old.size = (await fs.stat(currentFile)).size;
  }
  old.teachingVersion = {
    role: 'history',
    digest: currentHash,
    archivedAt: swiftNow(),
  } satisfies VersionMetadata;
}
async function downloadedFile(downloadedPath: string, name: string) {
  const file = await safeExternal(downloadedPath),
    stat = await fs.lstat(file);
  if (!stat.isFile()) throw new Error('下载结果不是普通文件');
  const handle = await fs.open(file, 'r');
  try {
    const prefix = Buffer.alloc(4096),
      read = await handle.read(prefix, 0, prefix.length, 0);
    validateDownload(prefix.subarray(0, read.bytesRead), stat.size, name);
  } finally {
    await handle.close();
  }
  return { file, size: stat.size, hash: await digestFile(file) };
}

export async function prepareTeachingFile(
  root: string,
  state: LibraryState,
  connectionID: string,
  activity: TeachingActivity,
  input: TeachingFile,
  downloadedPath: string,
  options: TeachingFileOptions,
  ops: FileOp[],
): Promise<TeachingFileChange> {
  const file = validateSource(activity, input),
    { connection, course, key, previous, old } = context(state, connectionID, activity, file);
  const mode = teachingFileState(state, connectionID, activity, file);
  if (mode === 'ignored') {
    const changed = previous!.ignored !== true;
    previous!.ignored = true;
    saveConnection(state, connection);
    return { changed, status: 'ignored', message: `忽略 · ${file.name}（已在本地移除或转移）` };
  }
  if (course.isMissing) throw new Error('课程目录缺失，请先恢复课程目录');
  const currentFile = old ? await materialFile(root, old) : undefined;
  if (old && !currentFile && !options.restoreMissing)
    return {
      changed: false,
      status: 'missing',
      message: `缺失 · ${file.name}（需要明确恢复）`,
      materialID: old.id,
    };
  const downloaded = await downloadedFile(downloadedPath, file.name),
    currentHash = currentFile ? await digestFile(currentFile) : undefined;
  if (old && currentHash === downloaded.hash && previous?.digest === downloaded.hash)
    return {
      changed: false,
      status: 'unchanged',
      message: `未变 · ${file.name}`,
      materialID: old.id,
    };
  if (
    old &&
    currentHash !== undefined &&
    currentHash !== previous?.digest &&
    !options.allowLocalChanges
  )
    return {
      changed: false,
      status: 'local-modified',
      message: `本地文件已修改 · ${file.name}（需要确认保留本地版本并采用网站）`,
      materialID: old.id,
    };
  const parts: [string, string][] = [
    ['root', '教学网站'],
    [`section:${activity.sectionID}`, activity.section],
  ];
  if (activity.kind === 'folder' || activity.kind === 'assign')
    parts.push([activityKey(activity), activity.title]);
  file.subfolders.forEach((name, index) =>
    parts.push([activityKey(activity) + '/' + file.subfolders.slice(0, index + 1).join('/'), name]),
  );
  const sourceFolder = teachingFolder(parts, connection, state),
    folder = old && old.folderID !== previous?.folderID ? old.folderID : sourceFolder;
  const category =
    activity.kind === 'assign' ? (isExperiment(activity) ? '实验资料' : '作业附件') : '课件';
  if (category !== '课件' && !state.customCategories.includes(category))
    state.customCategories.push(category);
  const title = path.posix.basename(file.name, path.posix.extname(file.name));
  const material: Material = {
    ...(old ?? {}),
    id: uuid(),
    courseID: course.id,
    folderID: folder,
    title: old && old.title !== previous?.title ? old.title : title,
    originalName: file.name,
    sourcePath: `teaching://${connection.id}/${key}`,
    storedPath: '',
    isManaged: true,
    category: old && old.category !== category ? old.category : category,
    tags: old?.tags ?? '',
    notes: old?.notes ?? '',
    isFavorite: old?.isFavorite ?? false,
    size: downloaded.size,
    addedAt: swiftNow(),
    customOrder:
      old && old.folderID === folder
        ? old.customOrder
        : Math.max(
            -1,
            ...state.materials
              .filter((m) => m.courseID === course.id && m.folderID === folder)
              .map((m) => m.customOrder ?? -1),
          ) + 1,
  };
  delete material.isMissing;
  delete material.lastOpenedAt;
  material.storedPath = await immutableTarget(root, state, material, ops);
  material.teachingVersion = {
    role: 'current',
    digest: downloaded.hash,
    previousID: old?.id,
  } satisfies VersionMetadata;
  if (old) {
    await archiveCurrent(root, state, old, connection, ops, currentFile, currentHash);
    replaceActiveReferences(state, old.id, material.id);
  }
  ops.push({
    kind: 'copy',
    from: downloaded.file,
    to: material.storedPath,
    sourceHash: downloaded.hash,
  });
  const link: TeachingItemLink = {
    ...(previous ?? {}),
    id: key,
    localID: material.id,
    title,
    content: previous?.content ?? '',
    digest: downloaded.hash,
    folderID: sourceFolder,
    ignored: false,
    submitted: previous?.submitted ?? false,
  };
  connection.items = connection.items.filter((i) => i.id !== key);
  connection.items.push(link);
  state.materials.push(material);
  saveConnection(state, connection);
  for (const folder of state.materialFolders)
    if (!folder.isMissing) {
      folder.storageDirectory ??= folderDirectory(state, folder);
      await ensureDirectories(root, folder.storageDirectory, ops);
    }
  return {
    changed: true,
    status: old ? 'updated' : 'added',
    message: `${old ? '更新' : '新增'} · ${file.name}${old ? '（旧版已保留）' : ''}`,
    materialID: material.id,
  };
}

export function materialVersions(state: LibraryState, materialID: string): MaterialVersions {
  assertID(materialID);
  const selected = state.materials.find((m) => m.id === materialID.toUpperCase());
  if (!selected || !selected.sourcePath.startsWith('teaching://'))
    throw new Error('此资料没有教学网站版本记录');
  const records = state.materials.filter((m) => m.sourcePath === selected.sourcePath),
    ids = new Set(records.map((m) => m.id));
  const linked = teachingConnections(state)
    .flatMap((c) => c.items)
    .find((i) => !i.ignored && i.localID && ids.has(i.localID));
  const current =
    linked?.localID ??
    records
      .filter((m) => (m.teachingVersion as VersionMetadata | undefined)?.role === 'current')
      .sort((a, b) => dateMs(b.addedAt) - dateMs(a.addedAt))[0]?.id ??
    [...records].sort((a, b) => dateMs(b.addedAt) - dateMs(a.addedAt))[0]?.id;
  return {
    sourcePath: selected.sourcePath,
    currentID: current,
    versions: records
      .map((m) => ({
        id: m.id,
        title: m.title,
        originalName: m.originalName,
        addedAt: m.addedAt,
        size: m.size,
        isCurrent: m.id === current,
        isMissing: !!m.isMissing,
        digest: (m.teachingVersion as VersionMetadata | undefined)?.digest,
      }))
      .sort(
        (a, b) =>
          Number(b.isCurrent) - Number(a.isCurrent) || dateMs(b.addedAt) - dateMs(a.addedAt),
      ),
  };
}
export async function prepareRestoreMaterialVersion(
  root: string,
  state: LibraryState,
  currentID: string,
  versionID: string,
  ops: FileOp[],
): Promise<{ materialID: string; message: string }> {
  assertID(versionID);
  const versions = materialVersions(state, currentID);
  if (
    versions.currentID !== currentID.toUpperCase() ||
    versionID.toUpperCase() === currentID.toUpperCase()
  )
    throw new Error('请选择当前资料和一个不同的历史版本');
  const current = state.materials.find((m) => m.id === currentID.toUpperCase())!,
    selected = state.materials.find(
      (m) => m.id === versionID.toUpperCase() && m.sourcePath === current.sourcePath,
    );
  if (!selected || !selected.isManaged) throw new Error('历史版本不存在或不是本地托管文件');
  const source = await materialFile(root, selected);
  if (!source) throw new Error('历史版本文件缺失，不能恢复');
  const course = state.courses.find((c) => c.id === current.courseID);
  if (current.courseID && (!course || course.isArchived || course.isMissing))
    throw new Error('课程已归档、移除或目录缺失');
  const connection = teachingConnections(state).find((c) =>
      c.items.some((i) => i.localID === current.id && i.id.startsWith('file:')),
    ),
    hash = await digestFile(source),
    currentFile = await materialFile(root, current),
    currentHash = currentFile ? await digestFile(currentFile) : undefined;
  const restored: Material = {
    ...current,
    id: uuid(),
    originalName: selected.originalName,
    size: (await fs.stat(source)).size,
    addedAt: swiftNow(),
    isManaged: true,
  };
  delete restored.isMissing;
  delete restored.lastOpenedAt;
  restored.storedPath = await immutableTarget(root, state, restored, ops);
  restored.teachingVersion = {
    role: 'current',
    digest: hash,
    restoredFrom: selected.id,
    previousID: current.id,
  } satisfies VersionMetadata;
  await archiveCurrent(root, state, current, connection, ops, currentFile, currentHash);
  ops.push({ kind: 'copy', from: source, to: restored.storedPath, sourceHash: hash });
  state.materials.push(restored);
  replaceActiveReferences(state, current.id, restored.id);
  if (connection) {
    const link = connection.items.find((i) => i.localID === current.id)!;
    link.localID = restored.id;
    saveConnection(state, connection);
  }
  for (const folder of state.materialFolders)
    if (!folder.isMissing) {
      folder.storageDirectory ??= folderDirectory(state, folder);
      await ensureDirectories(root, folder.storageDirectory, ops);
    }
  return { materialID: restored.id, message: '已恢复为新版本；此前当前版本和所选历史版本均已保留' };
}
