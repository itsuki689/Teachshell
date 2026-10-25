import { dateMs } from './model.ts';
import type { Material } from './model.ts';
const digits: Record<string, number> = {
    零: 0,
    〇: 0,
    一: 1,
    二: 2,
    两: 2,
    兩: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  },
  units: Record<string, number> = { 十: 10, 百: 100, 千: 1000 };
function chineseNumber(text: string): number | undefined {
  if ([...text].every((c) => digits[c] !== undefined)) {
    const n = Number([...text].map((c) => digits[c]).join(''));
    return Number.isSafeInteger(n) ? n : undefined;
  }
  let total = 0,
    previous = 10000,
    pending: number | undefined,
    zero = false;
  for (const c of text) {
    if (digits[c] !== undefined) {
      if (pending !== undefined) return;
      if (digits[c] === 0) {
        if (total === 0 || zero) return;
        zero = true;
      } else pending = digits[c];
    } else if (units[c]) {
      const unit = units[c],
        coefficient = pending ?? (total === 0 && unit === 10 ? 1 : undefined);
      if (unit >= previous || coefficient === undefined) return;
      total += coefficient * unit;
      previous = unit;
      pending = undefined;
      zero = false;
    } else return;
  }
  if (zero && pending === undefined) return;
  return total + (pending ?? 0);
}
export function chapterSortKey(value: string): string {
  return value.replace(
    /第\s*([零〇一二两兩三四五六七八九十百千]+)\s*(?=章|节|節|回|卷|篇|课|課|讲|講|单元|單元)/g,
    (all, numeral: string) => {
      const n = chineseNumber(numeral);
      return n === undefined ? all : all.replace(numeral, String(n));
    },
  );
}
const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });
export function compareNames(a: string, b: string): number {
  return collator.compare(chapterSortKey(a), chapterSortKey(b));
}
export function compareMaterials(a: Material, b: Material, mode: string): number {
  let result =
    mode === 'name'
      ? compareNames(a.title, b.title)
      : mode === 'size'
        ? b.size - a.size
        : mode === 'custom'
          ? (a.customOrder ?? Number.MAX_SAFE_INTEGER) - (b.customOrder ?? Number.MAX_SAFE_INTEGER)
          : 0;
  if (result) return result;
  result =
    dateMs((mode === 'recent' ? b.lastOpenedAt : undefined) ?? b.addedAt) -
    dateMs((mode === 'recent' ? a.lastOpenedAt : undefined) ?? a.addedAt);
  return result || a.id.localeCompare(b.id);
}
