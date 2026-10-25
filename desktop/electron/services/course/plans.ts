import { randomUUID } from 'node:crypto';
import { assertID, requiredText, textValue, swiftNow } from '../../../shared/model.ts';
import type { LibraryState, StudyTask, SwiftDate } from '../../../shared/model.ts';
import {
  addPlanDays,
  applyPlanDetails,
  isPlanOccurrenceAnchor,
  planAnchor,
  planDetailFields,
  planIndexNear,
  planOccurrenceDate,
  planSnapshot,
  readPlan,
  swiftSeconds,
} from '../../../shared/plans.ts';
import type {
  Plan,
  PlanDetails,
  PlanException,
  PlanEditScope,
  PlanStatus,
} from '../../../shared/plans.ts';
import { shanghaiDay } from '../../../shared/timetable.ts';

const newID = () => randomUUID().toUpperCase();
const optionalDates = ['deadline', 'endsAt', 'completedAt', 'archivedAt', 'cancelledAt'] as const;
const optionalFields = [
  'courseID',
  'courseNameSnapshot',
  'colorHex',
  'repeatRule',
  ...optionalDates,
] as const;
function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(label);
  return value as Record<string, unknown>;
}
function date(value: unknown): number {
  if (typeof value !== 'number' && typeof value !== 'string') throw new Error('计划日期无效');
  const n = swiftSeconds(value);
  shanghaiDay(n);
  return n;
}
function bool(value: unknown): asserts value is boolean {
  if (typeof value !== 'boolean') throw new Error('计划开关设置无效');
}
function identifier(value: unknown): string {
  assertID(value);
  return value.toUpperCase();
}
function scopeValue(scope: unknown): asserts scope is PlanEditScope {
  if (!['all', 'thisOccurrence', 'thisAndFuture'].includes(String(scope)))
    throw new Error('计划修改范围无效');
}
function equality(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}
function dateEquality(a: unknown, b: unknown): boolean {
  return a == null || b == null ? a == null && b == null : date(a) === date(b);
}
function put(target: Record<string, unknown>, key: string, value: unknown) {
  if (value == null) delete target[key];
  else target[key] = structuredClone(value);
}
function normalizeColor(value: unknown): string {
  const color = textValue(value, 30).trim().replace(/^#/, '');
  if (!/^[a-f0-9]{6}$/i.test(color)) throw new Error('计划颜色须为六位HEX颜色');
  return '#' + color.toUpperCase();
}
function normalizeDates(value: Record<string, unknown>, keys: readonly string[]) {
  for (const key of keys)
    if (value[key] == null) delete value[key];
    else value[key] = date(value[key]);
}
function normalizeDetails(value: PlanDetails): PlanDetails {
  const details = structuredClone(object(value, '计划例外详情无效')) as unknown as PlanDetails;
  if (details.courseID != null) details.courseID = identifier(details.courseID);
  else delete details.courseID;
  if (details.colorHex != null) details.colorHex = normalizeColor(details.colorHex);
  else delete details.colorHex;
  normalizeDates(details, ['startsAt', 'endsAt', 'deadline']);
  return details;
}
function normalizePlan(value: StudyTask, state: LibraryState): Plan {
  const plan = readPlan(value);
  plan.id = identifier(plan.id);
  for (const field of optionalFields) if (plan[field] == null) delete plan[field];
  plan.startsAt = date(plan.startsAt);
  normalizeDates(plan, optionalDates);
  if (plan.courseID != null) {
    plan.courseID = identifier(plan.courseID);
    plan.courseNameSnapshot = state.courses.find((c) => c.id === plan.courseID)?.name;
  }
  if (!Array.isArray(plan.materialIDs) || plan.materialIDs.length > 100000)
    throw new Error('计划关联资料无效');
  plan.materialIDs = [...new Set(plan.materialIDs.map(identifier))].sort();
  if (plan.colorHex != null) plan.colorHex = normalizeColor(plan.colorHex);
  if (plan.repeatRule != null) {
    object(plan.repeatRule, '重复规则无效');
    normalizeDates(plan.repeatRule, ['until']);
  }
  if (!Array.isArray(plan.exceptions) || plan.exceptions.length > 10000)
    throw new Error('计划例外无效或过多');
  plan.exceptions = plan.exceptions.map((value) => {
    const exception = structuredClone(object(value, '计划例外无效')) as unknown as PlanException;
    exception.originalDate = date(exception.originalDate);
    normalizeDates(exception, ['startsAt', 'endsAt', 'deadline', 'completedAt', 'cancelledAt']);
    if (exception.details != null) exception.details = normalizeDetails(exception.details);
    else delete exception.details;
    return exception;
  });
  return plan;
}
function validateDetails(details: PlanDetails) {
  for (const key of ['title', 'content', 'kind', 'location'] as const)
    textValue(details[key], 100000);
  for (const key of [
    'hasExecutionTime',
    'isAllDay',
    'deadlineIsAllDay',
    'showInMonth',
    'completionRequired',
  ] as const)
    bool(details[key]);
  date(details.startsAt);
  for (const key of ['endsAt', 'deadline'] as const) if (details[key] != null) date(details[key]);
  if (details.courseID != null) identifier(details.courseID);
  if (details.courseNameSnapshot != null) textValue(details.courseNameSnapshot, 100000);
  if (!Array.isArray(details.materialIDs)) throw new Error('例外关联资料无效');
  for (const id of details.materialIDs) identifier(id);
  if (details.overriddenFields != null) {
    if (
      !Array.isArray(details.overriddenFields) ||
      details.overriddenFields.some((key) => !planDetailFields.includes(key)) ||
      new Set(details.overriddenFields).size !== details.overriddenFields.length
    )
      throw new Error('计划例外覆盖字段无效');
  }
  if (details.colorHex != null) normalizeColor(details.colorHex);
}
export function validatePlan(input: StudyTask, state: LibraryState): void {
  const plan = readPlan(input);
  identifier(plan.id);
  requiredText(plan.title, 10000);
  for (const key of ['content', 'kind', 'location'] as const) textValue(plan[key], 100000);
  if (!['activity', 'fixed'].includes(plan.origin)) throw new Error('计划类型无效');
  for (const key of [
    'isAllDay',
    'showOnCalendar',
    'hasExecutionTime',
    'showInMonth',
    'completionRequired',
    'deadlineIsAllDay',
  ] as const)
    bool(plan[key]);
  const start = date(plan.startsAt);
  for (const key of optionalDates) if (plan[key] != null) date(plan[key]);
  if (plan.hasExecutionTime && plan.endsAt != null) {
    const end = date(plan.endsAt);
    if (end < start || end - start > 3660 * 86400)
      throw new Error('执行结束时间须在开始之后，且跨度不能超过十年');
  }
  if (
    plan.archivedAt != null &&
    (plan.completedAt == null || date(plan.completedAt) > date(plan.archivedAt))
  )
    throw new Error('归档计划必须已完成且完成时间不晚于归档时间');
  if (plan.courseID != null && !state.courses.some((c) => c.id === identifier(plan.courseID)))
    throw new Error('计划关联的课程不存在');
  if (
    !Array.isArray(plan.materialIDs) ||
    plan.materialIDs.some((id) => !state.materials.some((m) => m.id === identifier(id)))
  )
    throw new Error('计划关联的资料不存在');
  if (plan.colorHex != null) normalizeColor(plan.colorHex);
  if (plan.repeatRule) {
    const rule = object(plan.repeatRule, '重复规则无效');
    if (
      !['daily', 'weekly', 'monthly'].includes(String(rule.frequency)) ||
      !Number.isInteger(rule.interval) ||
      (rule.interval as number) < 1 ||
      (rule.interval as number) > 366 ||
      (!plan.hasExecutionTime && plan.deadline == null)
    )
      throw new Error('重复规则无效：间隔为1–366且需要执行或截止时间');
    if (rule.until != null && shanghaiDay(date(rule.until)) < shanghaiDay(planAnchor(plan)))
      throw new Error('重复结束日期不能早于首次安排');
  }
  if (
    !Array.isArray(plan.exceptions) ||
    plan.exceptions.length > 10000 ||
    (!plan.repeatRule && plan.exceptions.length > 0)
  )
    throw new Error('非重复计划不能有例外，或例外数量过多');
  const seen = new Set<number>();
  for (const exception of plan.exceptions) {
    object(exception, '计划例外无效');
    const original = date(exception.originalDate);
    if (seen.has(original) || !isPlanOccurrenceAnchor(original, plan))
      throw new Error('计划例外重复或不属于当前重复规则');
    seen.add(original);
    for (const key of ['startsAt', 'endsAt', 'deadline', 'completedAt', 'cancelledAt'] as const)
      if (exception[key] != null) date(exception[key]);
    if (exception.completedOverride != null) bool(exception.completedOverride);
    if (exception.location != null) textValue(exception.location, 100000);
    if (exception.details) validateDetails(exception.details);
    const effective = planSnapshot(plan, original);
    delete effective.repeatRule;
    effective.exceptions = [];
    delete effective.archivedAt;
    validatePlan(effective, state);
  }
}
export function validatePlans(state: LibraryState): void {
  const ids = new Set<string>();
  for (const plan of state.tasks) {
    const id = identifier(plan.id);
    if (ids.has(id)) throw new Error('计划编号重复');
    ids.add(id);
    validatePlan(plan, state);
  }
}
function planIndex(state: LibraryState, id: string, editable = true): number {
  const index = state.tasks.findIndex((p) => p.id === identifier(id));
  if (index < 0) throw new Error('计划不存在');
  if (editable && state.tasks[index].archivedAt != null)
    throw new Error('归档计划为只读，请先恢复');
  return index;
}
function requireOccurrence(plan: Plan, value: SwiftDate | undefined): number {
  if (value === undefined) throw new Error('请选择原计划的这次发生日期');
  const original = date(value);
  if (!isPlanOccurrenceAnchor(original, plan))
    throw new Error('找不到该次计划，重复规则可能已改变');
  return original;
}
function editException(
  plan: Plan,
  originalDate: number,
  change: (exception: PlanException) => void,
) {
  const index = plan.exceptions.findIndex((e) => date(e.originalDate) === originalDate);
  const exception: PlanException =
    index < 0 ? { originalDate } : structuredClone(plan.exceptions[index]);
  change(exception);
  if (index < 0) plan.exceptions.push(exception);
  else plan.exceptions[index] = exception;
  plan.exceptions.sort((a, b) => date(a.originalDate) - date(b.originalDate));
}
function detailsFor(plan: Plan, base: Plan): PlanDetails {
  const details: Record<string, unknown> = {};
  const changed: string[] = [];
  for (const key of planDetailFields) {
    put(details, key, plan[key]);
    let same: boolean;
    if (key === 'materialIDs')
      same = equality([...new Set(plan.materialIDs)].sort(), [...new Set(base.materialIDs)].sort());
    else if (['startsAt', 'endsAt', 'deadline'].includes(key))
      same = dateEquality(plan[key], base[key]);
    else same = equality(plan[key], base[key]);
    if (!same) changed.push(key);
  }
  put(details, 'courseNameSnapshot', plan.courseNameSnapshot);
  details.overriddenFields = changed;
  return details as unknown as PlanDetails;
}
function remapExceptions(exceptions: PlanException[], old: Plan, next: Plan): PlanException[] {
  if (!old.repeatRule || !next.repeatRule) return [];
  const result: PlanException[] = [];
  for (const exception of exceptions) {
    const index = planIndexNear(exception.originalDate, planAnchor(old), old.repeatRule),
      originalDate = planOccurrenceDate(index, planAnchor(next), next.repeatRule);
    if (originalDate !== undefined && isPlanOccurrenceAnchor(originalDate, next))
      result.push({ ...structuredClone(exception), originalDate });
  }
  return result;
}
function truncate(plan: Plan, before: number) {
  if (plan.repeatRule) plan.repeatRule.until = addPlanDays(shanghaiDay(before), -1);
  plan.exceptions = plan.exceptions.filter((e) => date(e.originalDate) < before);
}
function defaultPlan(now: number): Plan {
  return {
    id: newID(),
    title: '',
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
  };
}

/** Input is a patch over the current series or selected effective occurrence. */
export function saveAdvancedPlan(
  state: LibraryState,
  input: Partial<StudyTask>,
  scope: PlanEditScope = 'all',
  originalDate?: SwiftDate,
  now = swiftNow(),
): void {
  object(input, '计划数据无效');
  scopeValue(scope);
  const id = input.id == null ? undefined : identifier(input.id);
  const existing = id ? state.tasks.find((p) => p.id === id) : undefined;
  if (scope !== 'all' && !existing) throw new Error('请选择已有计划的发生项');
  if (existing?.archivedAt != null) throw new Error('归档计划为只读，请先恢复');
  const parent = existing ? readPlan(existing) : undefined;
  const original = scope === 'all' ? undefined : requireOccurrence(parent!, originalDate);
  const base = parent
    ? scope === 'all'
      ? parent
      : planSnapshot(parent, original!)
    : defaultPlan(now);
  const patch = structuredClone(input);
  // Optional IPC properties can be present with undefined. Only nullable model
  // fields use that value to clear data; undefined must never erase exceptions.
  for (const key of Object.keys(patch))
    if (
      patch[key] === undefined &&
      !optionalFields.includes(key as (typeof optionalFields)[number])
    )
      delete patch[key];
  const replacement = normalizePlan({ ...base, ...patch, id: id ?? base.id }, state);
  if (scope === 'all') {
    if (parent) {
      replacement.exceptions = remapExceptions(replacement.exceptions, parent, replacement);
      if (parent.deadline != null && replacement.deadline == null)
        for (const e of replacement.exceptions) {
          delete e.deadline;
          if (e.details) delete e.details.deadline;
        }
      if (parent.hasExecutionTime && !replacement.hasExecutionTime)
        for (const e of replacement.exceptions) {
          delete e.startsAt;
          delete e.endsAt;
          if (e.details) e.details.hasExecutionTime = false;
        }
    }
    validatePlan(replacement, state);
    if (existing) state.tasks[state.tasks.findIndex((p) => p.id === id)] = replacement;
    else state.tasks.push(replacement);
    return;
  }
  const index = planIndex(state, parent!.id);
  const next = structuredClone(parent!);
  if (!next.repeatRule) {
    replacement.id = next.id;
    replacement.exceptions = [];
    validatePlan(replacement, state);
    state.tasks[index] = replacement;
    return;
  }
  if (scope === 'thisOccurrence') {
    if (
      !equality(replacement.repeatRule, next.repeatRule) ||
      replacement.origin !== next.origin ||
      replacement.showOnCalendar !== next.showOnCalendar
    )
      throw new Error('单次修改不能改变重复规则、类型或整组日历显示');
    const nominal = structuredClone(next);
    nominal.exceptions = [];
    const occurrenceBase = planSnapshot(nominal, original!);
    const details = detailsFor(replacement, occurrenceBase);
    editException(next, original!, (exception) => {
      exception.details = details;
      for (const key of ['startsAt', 'endsAt', 'deadline', 'location'] as const)
        delete exception[key];
      put(exception, 'completedAt', replacement.completedAt);
      put(exception, 'cancelledAt', replacement.cancelledAt);
      if (!dateEquality(replacement.completedAt, occurrenceBase.completedAt))
        exception.completedOverride = replacement.completedAt != null;
      else delete exception.completedOverride;
    });
    validatePlan(next, state);
    state.tasks[index] = next;
    return;
  }
  if (original === planAnchor(next)) {
    replacement.id = next.id;
    replacement.exceptions = remapExceptions(
      next.exceptions.filter((e) => date(e.originalDate) !== original),
      next,
      replacement,
    );
    validatePlan(replacement, state);
    state.tasks[index] = replacement;
    return;
  }
  const future = structuredClone(replacement);
  future.id = newID();
  future.exceptions = [];
  if (next.repeatRule && future.repeatRule) {
    const sourceIndex = planIndexNear(original!, planAnchor(next), next.repeatRule);
    for (const old of next.exceptions)
      if (date(old.originalDate) > original!) {
        const offset =
          planIndexNear(old.originalDate, planAnchor(next), next.repeatRule) - sourceIndex;
        const mapped = planOccurrenceDate(offset, planAnchor(future), future.repeatRule);
        if (mapped !== undefined && isPlanOccurrenceAnchor(mapped, future))
          future.exceptions.push({ ...structuredClone(old), originalDate: mapped });
      }
  }
  truncate(next, original!);
  validatePlan(next, state);
  validatePlan(future, state);
  state.tasks[index] = next;
  state.tasks.push(future);
}
export function changePlanStatus(
  state: LibraryState,
  id: string,
  status: PlanStatus,
  scope: PlanEditScope = 'all',
  originalDate?: SwiftDate,
  now = swiftNow(),
): void {
  scopeValue(scope);
  if (
    ![
      'complete',
      'reopen',
      'cancel',
      'restore',
      'archive',
      'unarchive',
      'resetOccurrence',
    ].includes(status)
  )
    throw new Error('计划状态操作无效');
  date(now);
  if (scope === 'thisAndFuture' && status !== 'cancel')
    throw new Error('此状态操作不支持本次及以后');
  if ((status === 'archive' || status === 'unarchive') && scope !== 'all')
    throw new Error('归档操作只支持整组');
  const index = planIndex(state, id, status !== 'archive' && status !== 'unarchive');
  const next = readPlan(state.tasks[index]);
  if (status === 'unarchive') {
    delete next.archivedAt;
    state.tasks[index] = next;
    return;
  }
  if (status === 'archive') {
    if (next.archivedAt != null) return;
    if (date(next.startsAt) > now || (next.completedAt != null && date(next.completedAt) > now))
      throw new Error('开始时间或完成时间晚于当前归档时间');
    next.completedAt = next.completedAt ?? now;
    next.archivedAt = now;
    validatePlan(next, state);
    state.tasks[index] = next;
    return;
  }
  const original = scope === 'all' ? undefined : requireOccurrence(next, originalDate);
  if (status === 'resetOccurrence') {
    if (scope !== 'thisOccurrence') throw new Error('恢复原安排需要选择单次发生项');
    if (next.repeatRule)
      next.exceptions = next.exceptions.filter((e) => date(e.originalDate) !== original);
    else {
      delete next.cancelledAt;
      delete next.completedAt;
    }
    state.tasks[index] = next;
    return;
  }
  if (scope === 'thisOccurrence' && next.repeatRule) {
    if ((status === 'cancel' || status === 'restore') && next.cancelledAt != null)
      throw new Error('整组计划已取消，请先恢复整组');
    editException(next, original!, (e) => {
      if (status === 'complete' || status === 'reopen') {
        if (status === 'complete') e.completedAt = e.completedAt ?? now;
        else delete e.completedAt;
        e.completedOverride = status === 'complete';
      } else if (status === 'cancel') e.cancelledAt = e.cancelledAt ?? now;
      else delete e.cancelledAt;
    });
    validatePlan(next, state);
    state.tasks[index] = next;
    return;
  }
  if (scope === 'thisAndFuture' && next.repeatRule && original !== planAnchor(next)) {
    const nominal = structuredClone(next);
    nominal.exceptions = [];
    const future = planSnapshot(nominal, original!);
    future.id = newID();
    future.cancelledAt = now;
    future.exceptions = [];
    const sourceIndex = planIndexNear(original!, planAnchor(next), next.repeatRule);
    for (const old of next.exceptions)
      if (date(old.originalDate) >= original!) {
        const offset =
          planIndexNear(old.originalDate, planAnchor(next), next.repeatRule) - sourceIndex;
        const mapped = planOccurrenceDate(offset, planAnchor(future), next.repeatRule);
        if (mapped !== undefined)
          future.exceptions.push({ ...structuredClone(old), originalDate: mapped });
      }
    truncate(next, original!);
    validatePlan(next, state);
    validatePlan(future, state);
    state.tasks[index] = next;
    state.tasks.push(future);
    return;
  }
  if (status === 'complete') next.completedAt = next.completedAt ?? now;
  else if (status === 'reopen') delete next.completedAt;
  else if (status === 'cancel') next.cancelledAt = now;
  else if (status === 'restore') delete next.cancelledAt;
  validatePlan(next, state);
  state.tasks[index] = next;
}
export function removeAdvancedPlan(
  state: LibraryState,
  id: string,
  scope: PlanEditScope = 'all',
  originalDate?: SwiftDate,
  now = swiftNow(),
): void {
  scopeValue(scope);
  const canonical = identifier(id);
  if (scope === 'all') {
    state.tasks = state.tasks.filter((p) => p.id !== canonical);
    return;
  }
  if (scope === 'thisOccurrence') {
    changePlanStatus(state, id, 'cancel', scope, originalDate, now);
    return;
  }
  const index = planIndex(state, id),
    next = readPlan(state.tasks[index]),
    original = requireOccurrence(next, originalDate);
  if (!next.repeatRule || original === planAnchor(next)) state.tasks.splice(index, 1);
  else {
    truncate(next, original);
    validatePlan(next, state);
    state.tasks[index] = next;
  }
}
