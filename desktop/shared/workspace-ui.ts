export interface DisplayPreferences {
  libraryLayout: 'list' | 'grid';
  planMode: 'list' | 'agenda' | 'month';
  timetableMode: 'list' | 'timeline';
}
export function readDisplayPreferences(value: unknown): DisplayPreferences {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  return {
    libraryLayout: v.libraryLayout === 'grid' ? 'grid' : 'list',
    planMode: v.planMode === 'month' || v.planMode === 'agenda' ? v.planMode : 'list',
    timetableMode: v.timetableMode === 'timeline' ? 'timeline' : 'list',
  };
}
/** Match Swift's whitespace-separated, case-insensitive AND search across fields. */
export function materialSearchMatches(query: string, fields: unknown[]): boolean {
  const text = fields
    .filter((field) => field != null)
    .join(' ')
    .toLocaleLowerCase();
  return query
    .split(/\s+/u)
    .filter(Boolean)
    .every((word) => text.includes(word.toLocaleLowerCase()));
}
export function selectionRange(ids: string[], anchor: string, target: string): string[] {
  const a = ids.indexOf(anchor),
    b = ids.indexOf(target);
  return b < 0 ? [] : a < 0 ? [target] : ids.slice(Math.min(a, b), Math.max(a, b) + 1);
}
