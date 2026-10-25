/** Ports ScheduleWeekTimeline, ScheduleWeekLanes and PlanTimeRange from Swift. */
import type { TimetableSectionTime } from './timetable.ts';
export interface MinuteRange {
  start: number;
  end: number;
}
export interface TimelineSegment extends MinuteRange {
  lower: number;
  upper: number;
}
const defaults = [
  [480, 530],
  [540, 590],
  [610, 660],
  [670, 720],
  [840, 890],
  [900, 950],
  [970, 1020],
  [1030, 1080],
  [1110, 1160],
  [1170, 1220],
  [1230, 1280],
];
export function scheduleTimeline(
  height: number,
  sectionCount: number,
  supplied: TimetableSectionTime[],
) {
  height = Number.isFinite(height) ? Math.max(0, height) : 0;
  const times: TimetableSectionTime[] = [];
  for (let section = 1; section <= Math.max(1, sectionCount); section++) {
    const provided = supplied.find((t) => t.section === section);
    if (
      provided &&
      provided.startMinute >= 0 &&
      provided.endMinute <= 1440 &&
      provided.startMinute < provided.endMinute
    )
      times.push(provided);
    else if (defaults[section - 1])
      times.push({
        section,
        startMinute: defaults[section - 1][0],
        endMinute: defaults[section - 1][1],
      });
    else if (times.length && times.at(-1)!.endMinute + 10 < 1440) {
      const startMinute = times.at(-1)!.endMinute + 10;
      times.push({ section, startMinute, endMinute: Math.min(1440, startMinute + 50) });
    }
  }
  times.sort((a, b) => a.startMinute - b.startMinute);
  const boundaries = [
    ...new Set([0, 1440, ...times.flatMap((t) => [t.startMinute, t.endMinute])]),
  ].sort((a, b) => a - b);
  const first = Math.min(...times.map((t) => t.startMinute)),
    last = Math.max(...times.map((t) => t.endMinute));
  const ranges = boundaries.slice(0, -1).map((start, i) => ({ start, end: boundaries[i + 1] }));
  const teaching = (r: MinuteRange) =>
    times.some((t) => t.startMinute <= r.start && t.endMinute >= r.end);
  const breaks = ranges.filter((r) => r.start >= first && r.end <= last && !teaching(r));
  const lunch = breaks
    .filter((r) => r.start < 840 && r.end > 720)
    .sort((a, b) => b.end - b.start - (a.end - a.start))[0];
  const lunchWeight = breaks.reduce(
    (sum, r) => sum + Math.min(0.45, Math.max(0.14, (r.end - r.start) / 300)),
    0,
  );
  const weighted = ranges.map((r) => ({
    ...r,
    weight: teaching(r)
      ? (r.end - r.start) / 50
      : r.end <= first || r.start >= last
        ? 0.65
        : r === lunch
          ? lunchWeight
          : 0,
  }));
  const total = Math.max(
    1,
    weighted.reduce((sum, r) => sum + r.weight, 0),
  );
  let offset = 0;
  const segments: TimelineSegment[] = weighted.map((r) => {
    const lower = offset;
    offset += (height * r.weight) / total;
    return { start: r.start, end: r.end, lower, upper: offset };
  });
  function y(minute: number) {
    if (!Number.isFinite(minute)) return 0;
    minute = Math.max(0, Math.min(1440, minute));
    const s = segments.find((s) => minute <= s.end);
    return s
      ? s.lower + ((s.upper - s.lower) * (minute - s.start)) / Math.max(1, s.end - s.start)
      : height;
  }
  function minute(y: number, snapping = 1): number | undefined {
    if (!Number.isFinite(y) || height <= 0 || y < 0 || y >= height) return;
    const s = segments.find((s) => y >= s.lower && y < s.upper);
    if (!s) return;
    const raw = s.start + ((s.end - s.start) * (y - s.lower)) / (s.upper - s.lower),
      step = Math.max(1, snapping);
    return Math.max(0, Math.min(1439, Math.round(raw / step) * step));
  }
  function rect(range: MinuteRange, minimumHeight = 13) {
    const top = y(range.start),
      bottom = y(Math.max(range.start, range.end));
    const segment = segments.find(
      (s) =>
        range.start >= s.start && range.start < s.end && range.end <= s.end && s.upper > s.lower,
    );
    return {
      top,
      height: Math.min(
        Math.max(0, (segment?.upper ?? height) - top),
        Math.max(minimumHeight, bottom - top),
      ),
    };
  }
  return {
    height,
    times,
    segments,
    lunch,
    y,
    minute,
    rect,
    gridMinutes: [
      ...new Set([
        ...times.map((t) => t.startMinute),
        ...(lunch ? [lunch.start] : []),
        ...(times.length ? [times.at(-1)!.endMinute] : []),
      ]),
    ].sort((a, b) => a - b),
  };
}
export function validMinuteRange(range: MinuteRange): boolean {
  return (
    Number.isInteger(range.start) &&
    Number.isInteger(range.end) &&
    range.start >= 0 &&
    range.start < range.end &&
    range.end <= 1440
  );
}
export function movedRange(
  range: MinuteRange,
  minute: number,
  snapping = 10,
): MinuteRange | undefined {
  if (!validMinuteRange(range) || !Number.isFinite(minute)) return;
  const step = Math.min(1440, Math.max(1, snapping)),
    duration = range.end - range.start;
  const rounded = Math.round(Math.max(0, Math.min(1440, minute)) / step) * step;
  const start = Math.max(0, Math.min(Math.floor((1440 - duration) / step) * step, rounded));
  return { start, end: start + duration };
}
export function shiftedRange(range: MinuteRange, minutes: number): MinuteRange | undefined {
  if (!validMinuteRange(range) || !Number.isInteger(minutes) || minutes < -1440 || minutes > 1440)
    return;
  const next = { start: range.start + minutes, end: range.end + minutes };
  return validMinuteRange(next) ? next : undefined;
}
export function resizedRange(
  range: MinuteRange,
  edge: 'start' | 'end',
  minute: number,
  snapping = 10,
): MinuteRange | undefined {
  if (!validMinuteRange(range) || !Number.isFinite(minute) || !Number.isFinite(snapping)) return;
  const step = Math.min(1440, Math.max(1, Math.floor(snapping)));
  const rounded = Math.round(Math.max(0, Math.min(1440, minute)) / step) * step;
  return edge === 'start'
    ? {
        start: Math.max(0, Math.min(Math.floor((range.end - 1) / step) * step, rounded)),
        end: range.end,
      }
    : {
        start: range.start,
        end: Math.min(1440, Math.max((Math.floor(range.start / step) + 1) * step, rounded)),
      };
}
export function timelineLanes<T extends { id: string; top: number; height: number }>(
  spans: T[],
): (T & { lane: number; laneCount: number })[] {
  const sorted = [...spans].sort(
    (a, b) => a.top - b.top || a.top + a.height - (b.top + b.height) || a.id.localeCompare(b.id),
  );
  const groups: T[][] = [];
  let end = -Infinity;
  for (const span of sorted) {
    if (!groups.length || span.top >= end) {
      groups.push([span]);
      end = span.top + span.height;
    } else {
      groups.at(-1)!.push(span);
      end = Math.max(end, span.top + span.height);
    }
  }
  return groups.flatMap((group) => {
    const ends: number[] = [];
    const entries = group.map((span) => {
      let lane = ends.findIndex((end) => end <= span.top);
      if (lane < 0) lane = ends.length;
      ends[lane] = span.top + span.height;
      return { ...span, lane };
    });
    return entries.map((s) => ({ ...s, laneCount: ends.length }));
  });
}
export function timelineDrop(
  input: {
    x: number;
    y: number;
    width: number;
    height: number;
    grabOffset: number;
    days: (number | undefined)[];
    range: MinuteRange;
  },
  timeline: ReturnType<typeof scheduleTimeline>,
) {
  const { x, y, width, height, grabOffset, days, range } = input;
  if (
    ![x, y, width, height, grabOffset].every(Number.isFinite) ||
    width <= 0 ||
    height <= 0 ||
    days.length !== 7 ||
    x < 0 ||
    x >= width ||
    y < 0 ||
    y >= height
  )
    return;
  const dayIndex = Math.floor(x / (width / 7)),
    date = days[dayIndex];
  if (date === undefined) return;
  const minute = timeline.minute(Math.max(0, Math.min(timeline.height - 0.001, y - grabOffset)), 1);
  const moved = minute === undefined ? undefined : movedRange(range, minute);
  return moved ? { date, dayIndex, range: moved } : undefined;
}
