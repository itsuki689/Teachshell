/** Wire format deliberately matches Swift Codable. Preserve unknown fields on every edit. */
export type SwiftDate = number | string;
export interface Course {
  id: string;
  name: string;
  semester: string;
  teacher: string;
  colorHex: string;
  isArchived: boolean;
  homeworkFolder?: string;
  materialSort?: 'name' | 'time' | 'custom';
  storageDirectory?: string;
  materialRootName?: string;
  isMissing?: boolean;
  [key: string]: unknown;
}
export interface Material {
  id: string;
  courseID?: string;
  folderID?: string;
  title: string;
  originalName: string;
  sourcePath: string;
  storedPath: string;
  isManaged: boolean;
  category: string;
  tags: string;
  notes: string;
  isFavorite: boolean;
  size: number;
  addedAt: SwiftDate;
  lastOpenedAt?: SwiftDate;
  customOrder?: number;
  storageName?: string;
  storageDirectory?: string;
  isMissing?: boolean;
  [key: string]: unknown;
}
export interface MaterialFolder {
  id: string;
  courseID?: string;
  parentID?: string;
  name: string;
  colorHex?: string;
  createdAt: SwiftDate;
  storageDirectory?: string;
  isMissing?: boolean;
  [key: string]: unknown;
}
export interface StudyTask {
  id: string;
  title: string;
  content: string;
  kind: string;
  courseID?: string;
  materialIDs: string[];
  startsAt: SwiftDate;
  deadline?: SwiftDate;
  endsAt?: SwiftDate;
  isAllDay: boolean;
  showOnCalendar: boolean;
  completedAt?: SwiftDate;
  archivedAt?: SwiftDate;
  cancelledAt?: SwiftDate;
  origin?: string;
  hasExecutionTime?: boolean;
  location?: string;
  showInMonth?: boolean;
  repeatRule?: Record<string, unknown>;
  completionRequired?: boolean;
  deadlineIsAllDay?: boolean;
  exceptions?: Record<string, unknown>[];
  [key: string]: unknown;
}
export interface LibraryState {
  schemaVersion: number;
  courses: Course[];
  materials: Material[];
  materialFolders: MaterialFolder[];
  tasks: StudyTask[];
  timetableTerms: Record<string, unknown>[];
  teachingConnections: Record<string, unknown>[];
  customCategories: string[];
  accentColor: string;
  appearance: string;
  [key: string]: unknown;
}
export const SWIFT_EPOCH_MS = 978307200000;
export const swiftNow = () => (Date.now() - SWIFT_EPOCH_MS) / 1000;
export function dateMs(value: SwiftDate): number {
  const ms = typeof value === 'number' ? value * 1000 + SWIFT_EPOCH_MS : Date.parse(value);
  if (!Number.isFinite(ms)) throw new Error('无效日期');
  return ms;
}
export function emptyLibrary(): LibraryState {
  return {
    schemaVersion: 9,
    courses: [],
    materials: [],
    materialFolders: [],
    tasks: [],
    timetableTerms: [],
    teachingConnections: [],
    customCategories: [],
    accentColor: '#39786B',
    appearance: 'system',
    showCourseBorders: true,
    toolbarSettings: { actions: ['update', 'settings', 'import', 'create'] },
    appearanceTransition: {
      isEnabled: true,
      direction: 'top',
      speed: 1,
      colorMode: 'solid',
      colorHex: '#808080',
    },
  };
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function assertID(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !uuid.test(value)) throw new Error('无效的记录编号');
}
export function textValue(value: unknown, max = 10000): string {
  if (typeof value !== 'string' || value.length > max || value.includes('\0'))
    throw new Error('无效的文字参数');
  return value;
}
export function requiredText(value: unknown, max = 500): string {
  const s = textValue(value, max).trim();
  if (!s) throw new Error('名称不能为空');
  return s;
}
export function relativePath(value: unknown, allowRoot = false): string {
  const s = textValue(value);
  if (allowRoot && s === 'files') return s;
  if (
    !s.startsWith('files/') ||
    s.includes('\\') ||
    s.split('/').some((p) => !p || p === '.' || p === '..') ||
    /^[A-Za-z]:/.test(s) ||
    s.includes(':')
  )
    throw new Error('不安全的资料路径：' + s);
  return s;
}
export function decodeLibrary(raw: unknown): LibraryState {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new Error('资料库索引必须是对象');
  const data = structuredClone(raw) as LibraryState;
  if (!Number.isInteger(data.schemaVersion) || data.schemaVersion < 1 || data.schemaVersion > 9)
    throw new Error('不支持的资料库版本');
  for (const key of ['courses', 'materials', 'tasks', 'customCategories'] as const)
    if (!Array.isArray(data[key])) throw new Error('索引缺少 ' + key);
  for (const key of ['materialFolders', 'teachingConnections', 'timetableTerms'] as const) {
    if (data[key] === undefined) data[key] = [];
    if (!Array.isArray(data[key])) throw new Error('无效的 ' + key);
  }
  for (const list of [data.courses, data.materials, data.tasks, data.materialFolders]) {
    const ids = new Set<string>();
    for (const item of list) {
      if (!item || typeof item !== 'object') throw new Error('无效记录');
      assertID(item.id);
      const id = item.id.toUpperCase();
      if (ids.has(id)) throw new Error('重复记录编号');
      ids.add(id);
    }
  }
  // Swift UUID decoding is case-insensitive, and emits uppercase when saved.
  const canonicalID = (value: unknown) =>
    typeof value === 'string' && uuid.test(value) ? value.toUpperCase() : value;
  const normalizeRecord = (record: Record<string, unknown>) => {
    for (const key of ['id', 'courseID', 'folderID', 'parentID', 'meetingID', 'localID'])
      if (record[key] !== undefined) record[key] = canonicalID(record[key]);
    if (Array.isArray(record.materialIDs)) record.materialIDs = record.materialIDs.map(canonicalID);
  };
  for (const item of [...data.courses, ...data.materials, ...data.materialFolders, ...data.tasks])
    normalizeRecord(item);
  for (const task of data.tasks) {
    for (const entry of task.exceptions ?? []) {
      normalizeRecord(entry);
      if (entry.details && typeof entry.details === 'object')
        normalizeRecord(entry.details as Record<string, unknown>);
    }
  }
  for (const connection of data.teachingConnections) {
    normalizeRecord(connection);
    for (const list of ['items', 'folders'])
      if (Array.isArray(connection[list]))
        for (const item of connection[list] as Record<string, unknown>[]) normalizeRecord(item);
  }
  for (const term of data.timetableTerms) {
    normalizeRecord(term);
    for (const key of ['meetings', 'cancellations', 'reschedules'])
      if (Array.isArray(term[key]))
        for (const item of term[key] as Record<string, unknown>[]) {
          normalizeRecord(item);
          if (item.meeting && typeof item.meeting === 'object')
            normalizeRecord(item.meeting as Record<string, unknown>);
        }
  }
  const courses = new Set(data.courses.map((c) => c.id));
  const folders = new Map(data.materialFolders.map((f) => [f.id, f]));
  for (const c of data.courses) {
    requiredText(c.name);
    if (c.storageDirectory) relativePath(c.storageDirectory);
    if (
      c.materialRootName &&
      (c.materialRootName.includes('/') ||
        c.materialRootName.includes('\\') ||
        c.materialRootName === '..')
    )
      throw new Error('无效资料目录名称');
  }
  for (const f of data.materialFolders) {
    requiredText(f.name);
    if (f.name === '..' || /[\\/]/.test(f.name)) throw new Error('无效文件夹名');
    if (f.courseID && !courses.has(f.courseID)) throw new Error('文件夹课程不存在');
    if (f.storageDirectory) relativePath(f.storageDirectory);
    const seen = new Set([f.id]);
    let parent = f.parentID;
    while (parent) {
      if (seen.has(parent)) throw new Error('文件夹循环引用');
      seen.add(parent);
      const p = folders.get(parent);
      if (!p || p.courseID !== f.courseID) throw new Error('文件夹父级无效');
      parent = p.parentID;
    }
  }
  for (const m of data.materials) {
    requiredText(m.title);
    requiredText(m.originalName);
    if (typeof m.isManaged !== 'boolean' || !Number.isFinite(m.size) || m.size < 0)
      throw new Error('无效资料记录');
    if (m.isManaged) relativePath(m.storedPath);
    else textValue(m.storedPath);
    if (m.storageDirectory) relativePath(m.storageDirectory, true);
    if (m.storageName && (/[\\/]/.test(m.storageName) || m.storageName === '..'))
      throw new Error('无效文件名');
    if (m.courseID && !courses.has(m.courseID)) throw new Error('资料课程不存在');
    if (
      m.folderID &&
      (!folders.has(m.folderID) || folders.get(m.folderID)!.courseID !== m.courseID)
    )
      throw new Error('资料文件夹不存在');
    dateMs(m.addedAt);
    if (m.lastOpenedAt !== undefined) dateMs(m.lastOpenedAt);
  }
  for (const t of data.tasks) {
    t.origin ??= 'activity';
    t.hasExecutionTime ??= t.deadline === undefined || t.deadline === null;
    t.location ??= '';
    t.showInMonth ??= false;
    t.completionRequired ??= true;
    t.deadlineIsAllDay ??= t.isAllDay;
    t.exceptions ??= [];
    requiredText(t.title);
    dateMs(t.startsAt);
    for (const k of ['deadline', 'endsAt', 'completedAt', 'archivedAt', 'cancelledAt'] as const)
      if (t[k] !== undefined && t[k] !== null) dateMs(t[k]!);
    if (!Array.isArray(t.materialIDs)) throw new Error('无效计划资料关联');
  }
  if (!['system', 'light', 'dark'].includes(data.appearance)) throw new Error('未知外观');
  return data;
}
