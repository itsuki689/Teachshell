import type { LibraryState } from '../../shared/model';
export interface WorkspaceSearchResult {
  kind: 'course' | 'material' | 'plan';
  id: string;
  title: string;
  detail: string;
  color: string;
}
const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });
export function workspaceSearch(
  query: string,
  state: LibraryState,
  limitPerKind = 6,
): WorkspaceSearchResult[] {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length || limitPerKind < 1) return [];
  const courses = new Map(state.courses.map((c) => [c.id, c]));
  const matches = (parts: unknown[]) => {
    const text = parts
      .filter((v) => typeof v === 'string')
      .join(' ')
      .toLocaleLowerCase();
    return words.every((word) => text.includes(word));
  };
  const limited = (items: WorkspaceSearchResult[]) =>
    items
      .sort(
        (a, b) =>
          Number(b.title.toLocaleLowerCase() === query.trim().toLocaleLowerCase()) -
            Number(a.title.toLocaleLowerCase() === query.trim().toLocaleLowerCase()) ||
          collator.compare(a.title, b.title) ||
          a.id.localeCompare(b.id),
      )
      .slice(0, limitPerKind);
  const courseItems = state.courses
    .filter((c) => matches([c.name, c.teacher, c.semester]))
    .map((c) => ({
      kind: 'course' as const,
      id: c.id,
      title: c.name,
      detail: [c.semester, c.teacher, c.isArchived ? '已归档' : ''].filter(Boolean).join(' · '),
      color: c.colorHex,
    }));
  const materials = state.materials
    .filter((m) =>
      matches([
        m.title,
        m.originalName,
        m.tags,
        m.notes,
        m.category,
        courses.get(m.courseID ?? '')?.name ?? '未分类',
      ]),
    )
    .map((m) => ({
      kind: 'material' as const,
      id: m.id,
      title: m.title,
      detail: [
        courses.get(m.courseID ?? '')?.name ?? '未分类',
        m.category,
        m.originalName.split('.').at(-1)?.toUpperCase(),
      ].join(' · '),
      color: courses.get(m.courseID ?? '')?.colorHex ?? state.accentColor,
    }));
  const plans = state.tasks
    .filter((t) =>
      matches([t.title, t.content, t.kind, t.location, courses.get(t.courseID ?? '')?.name]),
    )
    .map((t) => ({
      kind: 'plan' as const,
      id: t.id,
      title: t.title,
      detail: [
        t.kind,
        courses.get(t.courseID ?? '')?.name,
        t.archivedAt != null
          ? '已归档'
          : t.cancelledAt != null
            ? '已取消'
            : t.completedAt != null
              ? '已完成'
              : '',
      ]
        .filter(Boolean)
        .join(' · '),
      color:
        typeof t.colorHex === 'string'
          ? t.colorHex
          : (courses.get(t.courseID ?? '')?.colorHex ?? state.accentColor),
    }));
  return [...limited(courseItems), ...limited(materials), ...limited(plans)];
}
