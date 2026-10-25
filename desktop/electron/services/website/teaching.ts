import { randomUUID } from 'node:crypto';
import { assertID, dateMs, swiftNow, SWIFT_EPOCH_MS, textValue } from '../../../shared/model.ts';
import type { LibraryState, StudyTask, SwiftDate } from '../../../shared/model.ts';
import { validatePlan } from '../course/plans.ts';
import { teachingPage } from './download.ts';
import type { z } from 'zod';

export type TeachingPage = z.infer<typeof teachingPage>;
export interface TeachingActivity {
  id: string;
  kind: string;
  title: string;
  sectionID: string;
  section: string;
  url: string;
}
export interface TeachingDeadlineChange {
  date?: SwiftDate;
  allDay: boolean;
  text: string;
}
export interface TeachingItemLink {
  id: string;
  localID?: string;
  title: string;
  content: string;
  digest: string;
  folderID?: string;
  remoteDeadline?: SwiftDate;
  appliedDeadline?: SwiftDate;
  remoteDeadlineIsAllDay?: boolean;
  appliedDeadlineIsAllDay?: boolean;
  pendingDeadline?: TeachingDeadlineChange;
  ignored: boolean;
  submitted: boolean;
  [key: string]: unknown;
}
export interface TeachingSyncMessage {
  id: string;
  text: string;
  isIssue: boolean;
}
export interface TeachingConnection {
  id: string;
  courseID: string;
  remoteCourseID: string;
  remoteTitle: string;
  accountID: string;
  timeZone: string;
  includeMaterials: boolean;
  includeAssignments: boolean;
  includeExperiments: boolean;
  includeHistory: boolean;
  lastSyncAt?: SwiftDate;
  messages: TeachingSyncMessage[];
  items: TeachingItemLink[];
  folders: { key: string; localID?: string; [key: string]: unknown }[];
  [key: string]: unknown;
}
export type TeachingConnectionInput = Pick<
  TeachingConnection,
  'courseID' | 'remoteCourseID' | 'remoteTitle' | 'accountID'
> &
  Partial<
    Pick<
      TeachingConnection,
      | 'id'
      | 'timeZone'
      | 'includeMaterials'
      | 'includeAssignments'
      | 'includeExperiments'
      | 'includeHistory'
    >
  >;
export interface TeachingAssignmentChange {
  before?: StudyTask;
  proposed?: StudyTask;
  pendingDeadline?: TeachingDeadlineChange;
  message: string;
  reviewable: boolean;
}
const uuid = () => randomUUID().toUpperCase();
function optional(target: Record<string, unknown>, key: string, value: unknown) {
  if (value == null) delete target[key];
  else target[key] = value;
}
function equalDate(a: SwiftDate | undefined, b: SwiftDate | undefined) {
  return a == null || b == null ? a == null && b == null : dateMs(a) === dateMs(b);
}
function same(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b);
}
function validZone(value: string) {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}
export function teachingPageURL(raw: string): { url: URL; kind: string; id: string } {
  const url = new URL(raw),
    match = /^\/(?:course|mod\/(folder|assign|resource))\/view\.php$/.exec(url.pathname),
    id = url.searchParams.get('id') ?? '';
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'selearning.nju.edu.cn' ||
    url.username ||
    url.password ||
    (url.port && url.port !== '443') ||
    !match ||
    !/^\d{1,16}$/.test(id)
  )
    throw new Error('不是有效的学校课程或教学活动页面');
  return { url, kind: match[1] ?? 'course', id };
}
export function validateTeachingObservation(
  activity: TeachingActivity,
  pageInput: unknown,
  sourceURL = activity.url,
): TeachingPage {
  const page = teachingPage.parse(pageInput),
    source = teachingPageURL(sourceURL),
    declared = teachingPageURL(activity.url);
  if (
    !['folder', 'resource', 'assign'].includes(activity.kind) ||
    source.kind !== activity.kind ||
    declared.kind !== activity.kind ||
    source.id !== activity.id ||
    declared.id !== activity.id ||
    page.kind !== activity.kind
  )
    throw new Error('教学活动与当前网页不一致，请重新读取');
  for (const [key, max] of [
    ['title', 500],
    ['sectionID', 100],
    ['section', 100],
  ] as const)
    textValue(activity[key], max);
  if (!activity.title.trim()) throw new Error('教学活动标题为空');
  return page;
}
export function isExperiment(activity: TeachingActivity) {
  return activity.section.includes('实验') || activity.title.toLowerCase().includes('lab');
}
/** Mirrors TeachingWebsite.deadline; ambiguous text never invents a date. */
export function teachingDeadline(
  text: string,
  timeZone: string,
): { date?: number; allDay: boolean } {
  const value = text.trim();
  if (!value || !validZone(timeZone)) return { allDay: true };
  const explicit =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/.exec(
      value,
    );
  if (explicit) {
    const [, y, m, d, h, min, s] = explicit,
      parts = [y, m, d, h, min, s].map(Number),
      ms = Date.parse(value);
    if (
      parts[1] >= 1 &&
      parts[1] <= 12 &&
      parts[2] >= 1 &&
      parts[2] <= new Date(Date.UTC(parts[0], parts[1], 0)).getUTCDate() &&
      parts[3] < 24 &&
      parts[4] < 60 &&
      parts[5] < 60 &&
      Number.isFinite(ms)
    )
      return { date: (ms - SWIFT_EPOCH_MS) / 1000, allDay: false };
    return { allDay: true };
  }
  const match =
    /(\d{4})[年/\-](\d{1,2})[月/\-](\d{1,2})日?(?:[^\d]*(\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(
      value,
    );
  if (!match) return { allDay: true };
  const wanted = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4] ?? 0),
    minute: Number(match[5] ?? 0),
    second: Number(match[6] ?? 0),
  };
  if (
    wanted.year < 1900 ||
    wanted.year > 2200 ||
    wanted.month < 1 ||
    wanted.month > 12 ||
    wanted.day < 1 ||
    wanted.day > new Date(Date.UTC(wanted.year, wanted.month, 0)).getUTCDate() ||
    wanted.hour > 23 ||
    wanted.minute > 59 ||
    wanted.second > 59
  )
    return { allDay: true };
  const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }),
    parts = (ms: number) =>
      Object.fromEntries(
        formatter
          .formatToParts(new Date(ms))
          .filter((p) => p.type !== 'literal')
          .map((p) => [p.type, Number(p.value)]),
      );
  const wall = Date.UTC(
    wanted.year,
    wanted.month - 1,
    wanted.day,
    wanted.hour,
    wanted.minute,
    wanted.second,
  );
  let ms = wall;
  for (let i = 0; i < 4; i++) {
    const p = parts(ms),
      offset = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - ms,
      next = wall - offset;
    if (next === ms) break;
    ms = next;
  }
  const actual = parts(ms);
  if (Object.entries(wanted).some(([k, v]) => actual[k] !== v)) return { allDay: true };
  return { date: (ms - SWIFT_EPOCH_MS) / 1000, allDay: match[4] === undefined };
}
export function teachingConnections(state: LibraryState): TeachingConnection[] {
  return state.teachingConnections.map(
    (raw) =>
      ({
        timeZone: 'Asia/Shanghai',
        includeMaterials: true,
        includeAssignments: true,
        includeExperiments: true,
        includeHistory: false,
        messages: [],
        items: [],
        folders: [],
        ...structuredClone(raw),
      }) as unknown as TeachingConnection,
  );
}
export function getTeachingConnection(state: LibraryState, id: string): TeachingConnection {
  assertID(id);
  const value = teachingConnections(state).find((c) => c.id.toUpperCase() === id.toUpperCase());
  if (!value) throw new Error('教学网站连接不存在');
  return value;
}
function putConnection(state: LibraryState, value: TeachingConnection) {
  const index = state.teachingConnections.findIndex(
    (c) => String(c.id).toUpperCase() === value.id.toUpperCase(),
  );
  if (index < 0) state.teachingConnections.push(value);
  else state.teachingConnections[index] = value;
}
export function validateTeachingConnections(state: LibraryState) {
  const connections = teachingConnections(state),
    ids = new Set<string>(),
    identities = new Set<string>();
  if (connections.length > 500) throw new Error('教学网站连接数量异常');
  for (const c of connections) {
    assertID(c.id);
    assertID(c.courseID);
    if (
      ids.has(c.id.toUpperCase()) ||
      !state.courses.some((course) => course.id === c.courseID) ||
      !/^\d{1,16}$/.test(c.remoteCourseID) ||
      !/^\d{1,64}$/.test(c.accountID) ||
      !c.remoteTitle ||
      c.remoteTitle.length > 1000 ||
      !validZone(c.timeZone) ||
      c.items.length > 50000 ||
      c.folders.length > 10000 ||
      c.messages.length > 300 ||
      new Set(c.items.map((i) => i.id)).size !== c.items.length ||
      new Set(c.folders.map((f) => f.key)).size !== c.folders.length ||
      identities.has(c.accountID + ':' + c.remoteCourseID)
    )
      throw new Error('教学网站连接无效或来源重复');
    for (const flag of [
      'includeMaterials',
      'includeAssignments',
      'includeExperiments',
      'includeHistory',
    ] as const)
      if (typeof c[flag] !== 'boolean') throw new Error('网站同步开关无效');
    ids.add(c.id.toUpperCase());
    identities.add(c.accountID + ':' + c.remoteCourseID);
  }
}
export function connectTeachingCourse(
  state: LibraryState,
  input: TeachingConnectionInput,
): { connection: TeachingConnection; created: boolean } {
  assertID(input.courseID);
  const courseID = input.courseID.toUpperCase(),
    existing = teachingConnections(state).find(
      (c) => c.accountID === input.accountID && c.remoteCourseID === input.remoteCourseID,
    );
  if (existing) {
    if (existing.courseID !== courseID)
      throw new Error('该网站课程已绑定至其他本地课程，请打开已有连接');
    return { connection: existing, created: false };
  }
  const value: TeachingConnection = {
    id: input.id?.toUpperCase() ?? uuid(),
    courseID,
    remoteCourseID: input.remoteCourseID,
    remoteTitle: input.remoteTitle,
    accountID: input.accountID,
    timeZone: input.timeZone ?? 'Asia/Shanghai',
    includeMaterials: input.includeMaterials ?? true,
    includeAssignments: input.includeAssignments ?? true,
    includeExperiments: input.includeExperiments ?? true,
    includeHistory: input.includeHistory ?? false,
    messages: [],
    items: [],
    folders: [],
  };
  if (state.teachingConnections.some((c) => c.id === value.id)) throw new Error('连接编号重复');
  state.teachingConnections.push(value);
  validateTeachingConnections(state);
  return { connection: value, created: true };
}
export function saveTeachingConnection(
  state: LibraryState,
  input: TeachingConnectionInput & { id: string },
) {
  const old = getTeachingConnection(state, input.id);
  if (
    input.courseID.toUpperCase() !== old.courseID ||
    input.remoteCourseID !== old.remoteCourseID ||
    input.accountID !== old.accountID
  )
    throw new Error('请断开旧连接后重新绑定课程或账号');
  const value = { ...old };
  for (const key of [
    'remoteTitle',
    'timeZone',
    'includeMaterials',
    'includeAssignments',
    'includeExperiments',
    'includeHistory',
  ] as const)
    if (input[key] !== undefined) (value as Record<string, unknown>)[key] = input[key];
  putConnection(state, value);
  validateTeachingConnections(state);
}
export function restoreIgnoredTeachingItems(state: LibraryState, id: string) {
  const c = getTeachingConnection(state, id),
    materials = new Set(state.materials.map((m) => m.id)),
    tasks = new Set(state.tasks.map((t) => t.id));
  c.items = c.items.filter(
    (item) =>
      !item.ignored &&
      item.localID &&
      (item.id.startsWith('file:') ? materials : tasks).has(item.localID),
  );
  putConnection(state, c);
}
export function resolveTeachingDeadline(
  state: LibraryState,
  id: string,
  key: string,
  useWebsite: boolean,
) {
  const c = getTeachingConnection(state, id),
    link = c.items.find((item) => item.id === key),
    pending = link?.pendingDeadline,
    task = state.tasks.find((t) => t.id === link?.localID);
  if (!pending || !task || task.archivedAt != null || task.courseID !== c.courseID)
    throw new Error('该截止变更已失效、计划已转移或已归档');
  if (useWebsite) {
    optional(task, 'deadline', pending.date);
    task.deadlineIsAllDay = pending.allDay;
    optional(link!, 'appliedDeadline', pending.date);
    link!.appliedDeadlineIsAllDay = pending.allDay;
    validatePlan(task, state);
  }
  delete link!.pendingDeadline;
  putConnection(state, c);
}
export function mergeTeachingAssignment(
  state: LibraryState,
  connectionID: string,
  activity: TeachingActivity,
  pageInput: unknown,
  now = swiftNow(),
  newID = uuid(),
): TeachingAssignmentChange {
  const page = validateTeachingObservation(activity, pageInput);
  if (activity.kind !== 'assign') throw new Error('不是作业页面');
  const c = getTeachingConnection(state, connectionID),
    course = state.courses.find((course) => course.id === c.courseID);
  if (!course || course.isArchived) throw new Error('课程连接已移除或课程已归档');
  if (page.accountID !== c.accountID || page.courseID !== c.remoteCourseID)
    throw new Error('网站账号或课程已变化，请重新连接');
  const key = 'plan:' + activity.id,
    parsed = teachingDeadline(page.deadlineText, c.timeZone),
    unclear = !!page.deadlineText && parsed.date === undefined,
    previous = c.items.find((i) => i.id === key),
    index = state.tasks.findIndex((t) => t.id === previous?.localID);
  const skip = (message: string): TeachingAssignmentChange => ({ message, reviewable: false });
  if (previous && (previous.ignored || index < 0 || state.tasks[index].courseID !== course.id)) {
    previous.ignored = true;
    putConnection(state, c);
    return skip(`忽略 · ${activity.title}（已在本地移除或转移）`);
  }
  if (
    !previous &&
    !c.includeHistory &&
    (page.submitted || (parsed.date !== undefined && dateMs(parsed.date) < dateMs(now)))
  )
    return skip('跳过历史 · ' + activity.title);
  if (index >= 0 && state.tasks[index].archivedAt != null)
    return skip('保留归档 · ' + activity.title);
  const content = Array.from(page.intro).slice(0, 80000).join('') + '\n\n教学网站：' + activity.url,
    before = index >= 0 ? structuredClone(state.tasks[index]) : undefined;
  const task: StudyTask = before
    ? structuredClone(before)
    : {
        id: newID,
        title: activity.title,
        content: '',
        kind: isExperiment(activity) ? '实验' : '作业',
        courseID: course.id,
        materialIDs: [],
        startsAt: now,
        isAllDay: true,
        showOnCalendar: true,
        origin: 'fixed',
        hasExecutionTime: false,
        location: '',
        showInMonth: false,
        completionRequired: true,
        deadlineIsAllDay: true,
        exceptions: [],
      };
  if (!previous || task.title === previous.title) task.title = activity.title;
  if (!previous || task.content === previous.content) task.content = content;
  task.courseNameSnapshot = course.name;
  const attachments = c.items
    .filter((i) => i.id.startsWith('file:' + activity.kind + ':' + activity.id + ':') && !i.ignored)
    .map((i) => i.localID)
    .filter(
      (id): id is string =>
        !!id && state.materials.some((m) => m.id === id && m.courseID === course.id),
    );
  task.materialIDs = [...new Set([...task.materialIDs, ...attachments])].sort();
  const link: TeachingItemLink = previous ?? {
    id: key,
    localID: task.id,
    title: activity.title,
    content: '',
    digest: '',
    ignored: false,
    submitted: false,
  };
  if (
    !unclear &&
    (!previous ||
      !equalDate(link.remoteDeadline, parsed.date) ||
      link.remoteDeadlineIsAllDay !== parsed.allDay)
  ) {
    if (
      !previous ||
      (equalDate(task.deadline, link.appliedDeadline) &&
        task.deadlineIsAllDay === (link.appliedDeadlineIsAllDay ?? task.deadlineIsAllDay) &&
        task.repeatRule == null)
    ) {
      optional(task, 'deadline', parsed.date);
      task.deadlineIsAllDay = parsed.allDay;
      optional(link, 'appliedDeadline', parsed.date);
      link.appliedDeadlineIsAllDay = parsed.allDay;
      delete link.pendingDeadline;
    } else
      link.pendingDeadline = {
        ...(parsed.date === undefined ? {} : { date: parsed.date }),
        allDay: parsed.allDay,
        text: page.deadlineText,
      };
    optional(link, 'remoteDeadline', parsed.date);
    link.remoteDeadlineIsAllDay = parsed.allDay;
  }
  if (!previous && page.submitted) task.completedAt = now;
  link.title = activity.title;
  link.content = content;
  link.submitted = page.submitted;
  validatePlan(task, state);
  if (index < 0) state.tasks.push(task);
  else state.tasks[index] = task;
  c.items = c.items.filter((i) => i.id !== key);
  c.items.push(link);
  putConnection(state, c);
  validateTeachingConnections(state);
  let message = `${index < 0 ? '新增计划' : same(task, before) ? '未变' : '更新计划'} · ${activity.title}`;
  if (unclear) message += ' · 截止时间待核对：' + page.deadlineText;
  if (link.pendingDeadline) message += ' · 截止时间冲突待处理';
  return {
    before,
    proposed: task,
    pendingDeadline: link.pendingDeadline,
    message,
    reviewable: !same(task, before) || !!link.pendingDeadline,
  };
}
