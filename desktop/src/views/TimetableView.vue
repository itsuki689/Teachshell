<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, toRaw, watch } from 'vue';
import {
  ArrowLeft,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Download,
  Globe,
  Settings2,
} from 'lucide-vue-next';
import { dateMs, swiftNow, SWIFT_EPOCH_MS } from '../../shared/model';
import {
  timetableDate,
  timetableWeek,
  shanghaiDayKey,
  meetingTimeRange,
  isScheduled,
  shanghaiDay,
} from '../../shared/timetable';
import type { TimetableTerm, TimetableOccurrence } from '../../shared/timetable';
import { useLibrary } from '../stores/library';
import { useWorkspaceUI } from '../stores/workspace-ui';
import { storeToRefs } from 'pinia';
import TaskEditor from '../components/TaskEditor.vue';
import PlanMonthCalendar from '../components/PlanMonthCalendar.vue';
import ScheduleEventRows from '../components/ScheduleEventRows.vue';
import {
  scheduleEvents,
  scheduleCourses,
  scheduleLoosePlans,
  scheduleWeekDays,
  scheduleMonthDays,
  shiftScheduleDay,
} from '../../shared/schedule';
import type { ScheduleEvent } from '../../shared/schedule';
const creatingPlan = ref(false),
  editingOccurrence = ref<PlanOccurrence>();
import Modal from '../components/Modal.vue';
import { addPlanDays } from '../../shared/plans';
import type { PlanOccurrence } from '../../shared/plans';
import {
  scheduleTimeline,
  timelineDrop,
  timelineLanes,
  validMinuteRange,
  shiftedRange,
  resizedRange,
} from '../../shared/schedule-drag';
import type { MinuteRange } from '../../shared/schedule-drag';
const api = window.teachshelf,
  store = useLibrary(),
  emit = defineEmits<{ website: [] }>();
const moving = ref<TimetableOccurrence | null>(null),
  moveForm = reactive({
    date: '',
    startSection: 1,
    sectionCount: 1,
    classroom: '',
    customTime: false,
    start: '',
    end: '',
  });
const ui = useWorkspaceUI();
const {
  timetableTermID: selected,
  timetableMode: mode,
  scheduleMode,
  scheduleFilters: filters,
} = storeToRefs(ui);
const editing = ref(false),
  monday = ref(''),
  weekCount = ref(20),
  endDate = ref(''),
  times = ref<{ section: number; start: string; end: string }[]>([]);
const fixedEditing = ref(false),
  showPlans = computed({
    get: () => filters.value.showsActivities,
    set: (value: boolean) => {
      filters.value.showsActivities = value;
    },
  }),
  grid = ref<HTMLElement>(),
  agendaScroll = ref<HTMLElement>(),
  scroll = ref<HTMLElement>();
watch([() => ui.day, scheduleMode], async () => {
  await nextTick();
  agendaScroll.value?.scrollTo({ top: 0 });
});
const selectedEventID = ref(''),
  viewportHeight = ref(600);
let viewportObserver: ResizeObserver | undefined;
watch(
  scroll,
  (element) => {
    viewportObserver?.disconnect();
    if (element) {
      viewportObserver = new ResizeObserver(() => {
        viewportHeight.value = element.clientHeight;
      });
      viewportObserver.observe(element);
    }
  },
  { flush: 'post' },
);
const moveGuard = ref<{ revision: string; root: string }>();
interface TimelineEvent {
  id: string;
  title: string;
  location: string;
  color: string;
  date: number;
  range: MinuteRange;
  fixed: boolean;
  clipped?: boolean;
  course?: TimetableOccurrence;
  plan?: PlanOccurrence;
}
interface DragState {
  event: TimelineEvent;
  termID: string | undefined;
  pointerID: number;
  originX: number;
  originY: number;
  grabOffset: number;
  edge: 'move' | 'start' | 'end';
  active: boolean;
  guard: { revision: string; root: string };
  target?: ReturnType<typeof timelineDrop>;
}
const drag = ref<DragState>();
let capture: HTMLElement | undefined,
  suppressClickUntil = 0;
const terms = computed(() => store.state.timetableTerms as unknown as TimetableTerm[]),
  term = computed(() => terms.value.find((t) => t.id === selected.value));
const academicWeek = computed(() =>
  term.value ? timetableWeek(term.value, ui.day + 'T00:00:00+08:00') : undefined,
);
const undatedWeek = computed(
  () => scheduleMode.value === 'week' && !!term.value && term.value.weekOneMonday == null,
);
const courses = computed(() => scheduleCourses(store.state, selected.value));
const selection = computed(() => ({ ...filters.value, termID: selected.value }));
const floatingMeetings = computed(() =>
  filters.value.showsFixed && filters.value.filter === 'active'
    ? (term.value?.meetings ?? []).filter(
        (m) =>
          (!filters.value.courseID || m.courseID === filters.value.courseID) &&
          (m.weeks.length === 0 || m.weeks.includes(week.value)) &&
          filters.value.query
            .toLocaleLowerCase()
            .split(/\s+/)
            .filter(Boolean)
            .every((word) =>
              [m.title, m.teacher, m.classroom].join(' ').toLocaleLowerCase().includes(word),
            ),
      )
    : [],
);
const rawState = computed(() => toRaw(store.state));
const eventsOn = (day: string, month = false) =>
  scheduleEvents(day, rawState.value, selection.value, month);
const selectedEvents = computed(() => eventsOn(ui.day, scheduleMode.value === 'month'));
const monthEvents = computed(() =>
  Object.fromEntries(scheduleMonthDays(ui.day).map((day) => [day, eventsOn(day, true)])),
);
const loosePlans = computed(() => scheduleLoosePlans(rawState.value, selection.value));
const editingTask = ref<import('../../shared/model').StudyTask>();
const meetingDetails = ref<ScheduleEvent>();
const daySections = [
  { id: 'allDay', title: '全天计划' },
  { id: 'deadlines', title: '当天截止' },
  { id: 'timed', title: '时间安排' },
] as const;
const selectedLabel = computed(() =>
  new Date(ui.day + 'T00:00:00+08:00').toLocaleDateString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }),
);
const dateTitle = computed(() =>
  scheduleMode.value === 'month'
    ? `${ui.day.slice(0, 4)} 年 ${Number(ui.day.slice(5, 7))} 月`
    : scheduleMode.value === 'agenda'
      ? selectedLabel.value
      : `${scheduleWeekDays(ui.day)[0]} — ${scheduleWeekDays(ui.day)[6]}`,
);
function shiftDate(offset: number) {
  if (undatedWeek.value) week.value += offset;
  else ui.day = shiftScheduleDay(ui.day, scheduleMode.value, offset);
}
function chooseMonth(event: Event) {
  const value = (event.target as HTMLInputElement).value;
  if (/^\d{4}-\d{2}$/.test(value)) ui.day = value + '-01';
}
function openEvent(event: ScheduleEvent) {
  if (event.plan) editingOccurrence.value = event.plan;
  else meetingDetails.value = event;
}
async function openDay(day: string) {
  ui.day = day;
  await ui.openSchedule('agenda');
}
async function toggleMeeting(event: Event) {
  const entry = meetingDetails.value;
  if (entry?.term && entry.meeting)
    await store.change(
      () =>
        api.setTimetableMeetingMonthVisible(
          entry.term!.id,
          entry.meeting!.meeting.id,
          (event.target as HTMLInputElement).checked,
        ),
      '课程月历显示已更新',
    );
}
const statusOperation = ref<{ event: PlanOccurrence; action: 'complete' | 'reopen' | 'cancel' }>();
const statusScope = ref<'all' | 'thisOccurrence' | 'thisAndFuture'>('all');
const statusTitle = computed(() =>
  statusOperation.value?.action === 'complete'
    ? '完成计划'
    : statusOperation.value?.action === 'reopen'
      ? '恢复待完成'
      : '取消计划',
);
async function eventStatus(entry: ScheduleEvent, action: 'complete' | 'reopen' | 'cancel') {
  if (!entry.plan) return;
  if (!entry.plan.task.repeatRule && action !== 'cancel') {
    await store.change(
      () => api.setPlanStatus(entry.plan!.task.id, action, 'all'),
      '计划状态已更新',
    );
    return;
  }
  statusOperation.value = { event: entry.plan, action };
  statusScope.value = entry.plan.task.repeatRule ? 'thisOccurrence' : 'all';
}
async function applyStatus() {
  const op = statusOperation.value;
  if (!op) return;
  const value = await store.change(
    () => api.setPlanStatus(op.event.task.id, op.action, statusScope.value, op.event.originalDate),
    '计划状态已更新',
  );
  if (value) statusOperation.value = undefined;
}
const week = computed({
  get: () => {
    const t = term.value;
    if (!t) return 1;
    const candidate = timetableWeek(t, ui.day + 'T00:00:00+08:00') ?? ui.weekFor(t.id) ?? 1;
    return Math.min(t.weekCount, Math.max(1, candidate));
  },
  set: (value: number) => {
    const t = term.value;
    if (!t || !Number.isInteger(value)) return;
    const next = Math.min(t.weekCount, Math.max(1, value));
    ui.rememberWeek(t.id, next);
    // Swift keeps the selected civil weekday when moving between academic weeks.
    const weekday = ((new Date(ui.day + 'T00:00:00Z').getUTCDay() + 6) % 7) + 1;
    const date = timetableDate(t, next, weekday);
    if (date !== undefined) ui.day = shanghaiDayKey(date);
  },
});
watch(
  [() => ui.identity, () => terms.value.map((t) => t.id).join(','), scheduleMode],
  () => {
    if (selected.value && !terms.value.some((t) => t.id === selected.value)) selected.value = '';
    if (scheduleMode.value === 'week' && !selected.value && terms.value.length) {
      const sorted = [...terms.value].sort((a, b) =>
        b.name.localeCompare(a.name, 'zh-CN', { numeric: true }),
      );
      selected.value = (
        sorted.find((t) => timetableWeek(t, ui.day + 'T00:00:00+08:00') !== undefined) ?? sorted[0]
      ).id;
    }
  },
  { immediate: true },
);
watch(courses, () => {
  if (filters.value.courseID && !courses.value.some((c) => c.id === filters.value.courseID))
    filters.value.courseID = '';
});
const days = computed(() =>
  scheduleWeekDays(ui.day).map((key, i) => {
    const day = undatedWeek.value ? undefined : shanghaiDay(key + 'T00:00:00+08:00');
    const entries = day === undefined ? [] : eventsOn(key);
    return {
      weekday: ['周一', '周二', '周三', '周四', '周五', '周六', '周日'][i],
      day,
      key: day === undefined ? '' : key,
      entries,
      items: entries.flatMap((e) => (e.meeting ? [e.meeting] : [])),
    };
  }),
);
const sections = computed(() =>
  Math.min(
    30,
    Math.max(
      11,
      ...(term.value?.meetings ?? []).map((m) => m.startSection + m.sectionCount - 1),
      ...(term.value?.reschedules ?? []).map(
        (r) => r.meeting.startSection + r.meeting.sectionCount - 1,
      ),
      ...(term.value?.sectionTimes ?? []).map((t) => t.section),
    ),
  ),
);
const timeline = computed(() =>
  scheduleTimeline(
    Math.max(260, viewportHeight.value - 68),
    sections.value,
    term.value?.sectionTimes ?? [],
  ),
);
const timelineDays = computed(() =>
  scheduleMode.value !== 'week'
    ? []
    : days.value.map((day) => {
        const events: TimelineEvent[] = [];
        for (const item of day.items) {
          const range = meetingTimeRange(item.meeting, term.value!.sectionTimes);
          if (range)
            events.push({
              id: item.id,
              title: item.meeting.title,
              location: item.meeting.classroom,
              color:
                item.meeting.colorHex ??
                store.state.courses.find((c) => c.id === item.meeting.courseID)?.colorHex ??
                '#39786B',
              date: item.date,
              range,
              fixed: true,
              course: item,
            });
        }
        const plans = day.entries.flatMap((e) => (e.plan ? [e.plan] : []));
        const untimed = plans.filter((p) => p.isAllDay || p.isDeadline);
        for (const occurrence of plans) {
          if (occurrence.isAllDay || occurrence.isDeadline) continue;
          const range = {
            start: Math.round(
              (dateMs(occurrence.date) - dateMs(shanghaiDay(occurrence.date))) / 60000,
            ),
            end: Math.round(
              (dateMs(
                occurrence.endDate ?? (dateMs(occurrence.date) - SWIFT_EPOCH_MS) / 1000 + 1800,
              ) -
                dateMs(shanghaiDay(occurrence.date))) /
                60000,
            ),
          };
          if (validMinuteRange(range))
            events.push({
              id: occurrence.id,
              title: occurrence.task.title,
              location: occurrence.task.location,
              color: occurrence.task.colorHex ?? '#587EA7',
              date: occurrence.date,
              range,
              clipped:
                dateMs(occurrence.date) !== dateMs(occurrence.task.startsAt) ||
                (occurrence.endDate != null &&
                  occurrence.task.endsAt != null &&
                  dateMs(occurrence.endDate) !== dateMs(occurrence.task.endsAt)),
              fixed: occurrence.isFixed,
              plan: occurrence,
            });
        }
        return {
          ...day,
          untimed,
          withoutTime: day.items.filter(
            (item) => !meetingTimeRange(item.meeting, term.value!.sectionTimes),
          ),
          events: timelineLanes(
            events.map((event) => ({ ...event, ...timeline.value.rect(event.range, 18) })),
          ),
        };
      }),
);
const chosen = computed(() =>
  timelineDays.value.flatMap((d) => d.events).find((e) => e.id === selectedEventID.value),
);
const targetConflicts = computed(() => {
  const target = drag.value?.target;
  if (!target) return [];
  return timelineDays.value[target.dayIndex].events.filter(
    (e) =>
      e.id !== drag.value!.event.id &&
      e.range.start < target.range.end &&
      e.range.end > target.range.start,
  );
});
function guard() {
  return store.snapshot
    ? { revision: store.snapshot.revision, root: store.snapshot.root }
    : undefined;
}
function guardCurrent(value: { revision: string; root: string } | undefined) {
  return (
    !!value && value.root === store.snapshot?.root && value.revision === store.snapshot?.revision
  );
}
function eventStyle(
  event: TimelineEvent & { top: number; height: number; lane: number; laneCount: number },
) {
  return {
    '--event-color': event.color,
    top: event.top + 'px',
    height: event.height + 'px',
    left: `calc(${(event.lane * 100) / event.laneCount}% + 3px)`,
    width: `calc(${100 / event.laneCount}% - 6px)`,
  };
}
async function chooseEvent(event: TimelineEvent) {
  if (Date.now() < suppressClickUntil) return;
  ui.day = shanghaiDayKey(event.date);
  await nextTick();
  selectedEventID.value = event.id;
}
function startDrag(
  event: PointerEvent,
  item: TimelineEvent,
  edge: 'move' | 'start' | 'end' = 'move',
) {
  if (event.button !== 0 || item.clipped || store.busy || (item.fixed && !fixedEditing.value))
    return;
  const currentGuard = guard();
  if (!currentGuard) return;
  const element = event.currentTarget as HTMLElement,
    rect = element.getBoundingClientRect();
  capture = element;
  capture.setPointerCapture(event.pointerId);
  capture.focus();
  drag.value = {
    event: item,
    termID: term.value?.id,
    pointerID: event.pointerId,
    originX: event.clientX,
    originY: event.clientY,
    grabOffset: event.clientY - rect.top,
    edge,
    active: false,
    guard: currentGuard,
  };
  event.preventDefault();
}
function dragTarget(event: PointerEvent, state: DragState) {
  const canvas = grid.value,
    viewport = scroll.value;
  if (!canvas || !viewport) return;
  if (state.edge !== 'move') {
    const initial = timeline.value.y(state.event.range[state.edge]);
    const position = Math.max(
      0,
      Math.min(timeline.value.height - 0.001, initial + event.clientY - state.originY),
    );
    const minute = timeline.value.minute(position, 1);
    const range = minute == null ? undefined : resizedRange(state.event.range, state.edge, minute);
    const dayIndex = days.value.findIndex(
      (day) => day.day != null && shanghaiDayKey(day.day) === shanghaiDayKey(state.event.date),
    );
    return range && dayIndex >= 0
      ? { date: shanghaiDay(state.event.date), dayIndex, range }
      : undefined;
  }
  const rect = canvas.getBoundingClientRect(),
    visible = viewport.getBoundingClientRect();
  if (
    event.clientX < visible.left ||
    event.clientX >= visible.right ||
    event.clientY < visible.top ||
    event.clientY >= visible.bottom
  )
    return;
  return timelineDrop(
    {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      width: rect.width,
      height: rect.height,
      grabOffset: state.grabOffset,
      days: days.value.map((d) => d.day),
      range: state.event.range,
    },
    timeline.value,
  );
}
function movePointer(event: PointerEvent) {
  const state = drag.value;
  if (!state || event.pointerId !== state.pointerID) return;
  if (
    !state.active &&
    Math.hypot(event.clientX - state.originX, event.clientY - state.originY) <
      (state.edge === 'move' ? 6 : 2)
  )
    return;
  state.active = true;
  selectedEventID.value = state.event.id;
  state.target = dragTarget(event, state);
  event.preventDefault();
}
function clearDrag() {
  const state = drag.value;
  drag.value = undefined;
  if (state?.active) suppressClickUntil = Date.now() + 200;
  if (state && capture?.hasPointerCapture(state.pointerID))
    capture.releasePointerCapture(state.pointerID);
  capture = undefined;
}
async function endPointer(event: PointerEvent) {
  const state = drag.value;
  if (!state || event.pointerId !== state.pointerID) return;
  const target = state.active ? dragTarget(event, state) : undefined;
  clearDrag();
  if (!target) return;
  await applyEventTime(state.event, target.date, target.range, state.guard, state.termID);
}
async function applyEventTime(
  item: TimelineEvent,
  date: number,
  range: MinuteRange,
  expected: { revision: string; root: string },
  termID: string | undefined,
) {
  if (store.busy || item.clipped || (item.fixed && !fixedEditing.value)) return;
  if (!guardCurrent(expected) || term.value?.id !== termID) {
    store.error = '资料库已变化，已取消这次时间调整。';
    return;
  }
  if (
    !validMinuteRange(range) ||
    (item.course && term.value && timetableWeek(term.value, date) === undefined)
  )
    return;
  if (
    shanghaiDayKey(date) === shanghaiDayKey(item.date) &&
    range.start === item.range.start &&
    range.end === item.range.end
  )
    return;
  let saved;
  if (item.course)
    saved = await store.change(
      () =>
        api.rescheduleTimetableClass(
          termID!,
          item.course!.meeting.id,
          item.course!.originalDate,
          {
            date,
            startSection: item.course!.meeting.startSection,
            sectionCount: item.course!.meeting.sectionCount,
            classroom: item.course!.meeting.classroom,
            startMinute: range.start,
            endMinute: range.end,
          },
          { ...expected },
        ),
      '已调整这次课程时间',
    );
  else if (item.plan)
    saved = await store.change(
      () =>
        api.setPlanOccurrenceTime(
          item.plan!.task.id,
          item.plan!.originalDate,
          date,
          { ...range },
          { ...expected },
        ),
      '已调整这次计划时间',
    );
  if (saved && store.snapshot?.root === expected.root && term.value?.id === termID) {
    ui.day = shanghaiDayKey(date);
    await nextTick();
    selectedEventID.value = item.id;
  }
}
function editingKeyContext(event: KeyboardEvent) {
  return (
    event.defaultPrevented ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    scheduleMode.value !== 'week' ||
    mode.value !== 'timeline' ||
    store.busy ||
    !!document.querySelector('[role="dialog"]') ||
    !!(
      event.target instanceof HTMLElement &&
      event.target.closest('input,textarea,select,[contenteditable="true"]')
    )
  );
}
async function timeKey(event: KeyboardEvent, item: TimelineEvent, edge?: 'start' | 'end') {
  if (editingKeyContext(event) || item.clipped || drag.value || (item.fixed && !fixedEditing.value))
    return;
  let minutes = 0,
    days = 0;
  if (event.key === 'ArrowUp') minutes = edge ? -1 : -10;
  else if (event.key === 'ArrowDown') minutes = edge ? 1 : 10;
  else if (event.key === '-' || event.key === '+' || event.key === '=')
    minutes = event.key === '-' ? -1 : 1;
  else if (!edge && event.key === 'ArrowLeft') days = -1;
  else if (!edge && event.key === 'ArrowRight') days = 1;
  else return;
  event.preventDefault();
  event.stopPropagation();
  const expected = guard();
  if (!expected) return;
  const range = edge
    ? resizedRange(item.range, edge, item.range[edge] + minutes, 1)
    : shiftedRange(item.range, minutes);
  if (range)
    await applyEventTime(item, addPlanDays(item.date, days), range, expected, term.value?.id);
}
function resizeStyle(
  item: TimelineEvent & { top: number; height: number; lane: number; laneCount: number },
  edge: 'start' | 'end',
) {
  return {
    top: item.top + (edge === 'end' ? item.height - 6 : 0) + 'px',
    left: `calc(${(item.lane * 100) / item.laneCount}% + 3px)`,
    width: `calc(${100 / item.laneCount}% - 6px)`,
  };
}
function cancelKey(event: KeyboardEvent) {
  if (event.key === 'Escape' && drag.value) {
    event.preventDefault();
    clearDrag();
  } else if (chosen.value) void timeKey(event, chosen.value);
}
function lostFocus() {
  clearDrag();
}
watch(
  [
    () => store.snapshot?.root,
    () => term.value?.id,
    () => ui.day,
    viewportHeight,
    week,
    mode,
    showPlans,
    scheduleMode,
    () => JSON.stringify(filters.value),
  ],
  () => {
    clearDrag();
    selectedEventID.value = '';
  },
);
watch(fixedEditing, () => {
  clearDrag();
  if (chosen.value?.fixed) selectedEventID.value = '';
});
watch(
  () => store.snapshot?.revision,
  (next, previous) => {
    if (next !== previous && drag.value) {
      store.status = '资料库已变化，已取消这次拖动';
      clearDrag();
    }
  },
);
onMounted(() => {
  window.addEventListener('pointermove', movePointer);
  window.addEventListener('pointerup', endPointer);
  window.addEventListener('pointercancel', clearDrag);
  window.addEventListener('keydown', cancelKey);
  window.addEventListener('blur', lostFocus);
});
onUnmounted(() => {
  clearDrag();
  viewportObserver?.disconnect();
  window.removeEventListener('pointermove', movePointer);
  window.removeEventListener('pointerup', endPointer);
  window.removeEventListener('pointercancel', clearDrag);
  window.removeEventListener('keydown', cancelKey);
  window.removeEventListener('blur', lostFocus);
});
function clock(minutes: number) {
  return (
    String(Math.floor(minutes / 60)).padStart(2, '0') + ':' + String(minutes % 60).padStart(2, '0')
  );
}
function openSettings() {
  const t = term.value;
  if (!t) return;
  monday.value = t.weekOneMonday == null ? '' : shanghaiDayKey(t.weekOneMonday);
  weekCount.value = t.weekCount;
  endDate.value = t.endDate == null ? '' : shanghaiDayKey(t.endDate);
  const count = Math.min(
    30,
    Math.max(11, ...t.meetings.map((m) => m.startSection + m.sectionCount - 1)),
  );
  times.value = Array.from({ length: count }, (_, i) => {
    const existing = t.sectionTimes.find((s) => s.section === i + 1);
    return {
      section: i + 1,
      start: existing ? clock(existing.startMinute) : '',
      end: existing ? clock(existing.endMinute) : '',
    };
  });
  editing.value = true;
}
async function save() {
  const sections = times.value
    .filter((t) => t.start || t.end)
    .map((t) => {
      if (!t.start || !t.end) throw new Error('每个节次需同时填写开始和结束时间');
      const minutes = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
      return { section: t.section, startMinute: minutes(t.start), endMinute: minutes(t.end) };
    });
  const result = await store.change(
    () =>
      api.saveTimetableSettings(term.value!.id, {
        weekOneMonday: monday.value ? monday.value + 'T00:00:00+08:00' : null,
        weekCount: weekCount.value,
        endDate: endDate.value ? endDate.value + 'T00:00:00+08:00' : null,
        sectionTimes: sections,
      }),
    '学期设置已保存',
  );
  if (result) editing.value = false;
}
async function importJSON() {
  const result = await store.run(() => api.importTimetable());
  if (result) {
    store.accept(result.snapshot);
    selected.value = result.summary.termID;
    store.status = `已导入 ${result.summary.meetingsImported} 个上课时段，新建 ${result.summary.coursesCreated} 门课程`;
    if (term.value?.weekOneMonday == null) openSettings();
  }
}
async function cancel(item: TimetableOccurrence) {
  const t = term.value,
    expected = guard();
  if (!t || !expected) return;
  if (
    await store.confirm(
      '取消这次课程？',
      `${item.meeting.title} · ${shanghaiDayKey(item.date)}。仅取消本次，可在下方恢复。`,
      '取消本次',
    )
  ) {
    if (!guardCurrent(expected)) {
      store.error = '资料库已变化，请重新确认取消。';
      return;
    }
    await store.change(
      () => api.cancelTimetableClass(t.id, item.meeting.id, item.originalDate, undefined, expected),
      '本次课程已取消',
    );
  }
}
function monthVisible(item: TimetableOccurrence) {
  return (
    (term.value?.meetings.find((m) => m.id === item.meeting.id)?.showInMonth ??
      item.meeting.showInMonth) === true
  );
}
async function setMonthVisible(item: TimetableOccurrence, event: Event) {
  if (!term.value) return;
  const visible = (event.target as HTMLInputElement).checked;
  await store.change(
    () => api.setTimetableMeetingMonthVisible(term.value!.id, item.meeting.id, visible),
    visible ? '该课程时段已加入月历' : '该课程时段已移出月历',
  );
}
function openMove(item: TimetableOccurrence) {
  moveGuard.value = guard();
  const range = meetingTimeRange(item.meeting, term.value!.sectionTimes);
  Object.assign(moveForm, {
    date: shanghaiDayKey(item.date),
    startSection: item.meeting.startSection,
    sectionCount: item.meeting.sectionCount,
    classroom: item.meeting.classroom,
    customTime: item.meeting.startMinuteOverride != null || item.meeting.endMinuteOverride != null,
    start: range ? clock(range.start) : '',
    end: range ? clock(range.end) : '',
  });
  moving.value = item;
}
const moveValidation = computed(() => {
  if (!moving.value) return '';
  if (
    !moveForm.date ||
    !term.value ||
    timetableWeek(term.value, moveForm.date + 'T00:00:00+08:00') === undefined
  )
    return '目标日期须在已设置的学期范围内。';
  if (
    !Number.isInteger(moveForm.startSection) ||
    !Number.isInteger(moveForm.sectionCount) ||
    moveForm.startSection < 1 ||
    moveForm.sectionCount < 1 ||
    moveForm.startSection + moveForm.sectionCount - 1 > 30
  )
    return '课程节次须在第 1–30 节内。';
  if (moveForm.customTime && (!moveForm.start || !moveForm.end || moveForm.end <= moveForm.start))
    return '请填写完整的开始和结束时间，结束须晚于开始。';
  return '';
});
async function saveMove() {
  const item = moving.value,
    t = term.value;
  if (!item || !t || moveValidation.value) return;
  if (!guardCurrent(moveGuard.value)) {
    store.error = '资料库已变化，请关闭并重新打开调整窗口。';
    return;
  }
  const minutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
  const value = await store.change(
    () =>
      api.rescheduleTimetableClass(
        t.id,
        item.meeting.id,
        item.originalDate,
        {
          date: moveForm.date + 'T00:00:00+08:00',
          startSection: moveForm.startSection,
          sectionCount: moveForm.sectionCount,
          classroom: moveForm.classroom,
          ...(moveForm.customTime
            ? { startMinute: minutes(moveForm.start), endMinute: minutes(moveForm.end) }
            : {}),
        },
        { ...moveGuard.value! },
      ),
    '本次课程已调整',
  );
  if (value) {
    week.value = timetableWeek(t, moveForm.date + 'T00:00:00+08:00') ?? week.value;
    moving.value = null;
  }
}
async function restoreMove(id: string) {
  const t = term.value,
    expected = guard();
  if (!t) return;
  const move = t.reschedules.find((r) => r.id === id);
  if (!move) return;
  if (
    await store.confirm(
      '还原这次调课？',
      `${move.meeting.title} 将恢复为 ${shanghaiDayKey(move.originalDate)} 的原始安排。`,
      '还原调课',
    )
  ) {
    if (!guardCurrent(expected)) {
      store.error = '资料库已变化，请重新确认还原。';
      return;
    }
    const value = await store.change(
      () => api.restoreTimetableMove(t.id, id, expected),
      '本次调课已还原',
    );
    if (value) week.value = timetableWeek(t, move.originalDate) ?? week.value;
  }
}
function time(item: TimetableOccurrence) {
  const range = meetingTimeRange(item.meeting, term.value!.sectionTimes);
  return range
    ? clock(range.start) + ' – ' + clock(range.end)
    : `第 ${item.meeting.startSection}–${item.meeting.startSection + item.meeting.sectionCount - 1} 节`;
}
</script>
<template>
  <section class="workspace timetable-workspace schedule-workspace" :data-view="scheduleMode">
    <aside class="schedule-options" aria-label="计划选项与当天安排">
      <div class="schedule-options-scroll">
        <header class="workspace-header">
          <div class="heading-block">
            <h1>计划</h1>
            <p>按北京时间与学期周次展示课程，保留原有调课与停课记录。</p>
          </div>
          <div class="toolbar-controls">
            <button
              title="计划列表"
              aria-label="计划列表视图"
              @click="
                ui.planMode = 'list';
                store.navigate('plans');
              "
            >
              <ArrowLeft :size="15" /></button
            ><button title="网站读取" aria-label="网站读取" @click="emit('website')">
              <Globe :size="15" /></button
            ><button
              title="导入课表 JSON"
              aria-label="导入课表 JSON"
              class="primary"
              @click="importJSON"
            >
              <Download :size="15" />
            </button>
          </div>
        </header>
        <div class="schedule-view-switch segmented" role="group" aria-label="计划视图">
          <button
            :class="{ active: scheduleMode === 'month' }"
            :aria-pressed="scheduleMode === 'month'"
            aria-label="计划月历视图"
            @click="ui.openSchedule('month')"
          >
            月
          </button>
          <button
            :class="{ active: scheduleMode === 'week' }"
            :aria-pressed="scheduleMode === 'week'"
            aria-label="查看课表"
            @click="ui.openSchedule('week')"
          >
            周
          </button>
          <button
            :class="{ active: scheduleMode === 'agenda' }"
            :aria-pressed="scheduleMode === 'agenda'"
            aria-label="计划日程视图"
            @click="ui.openSchedule('agenda')"
          >
            日
          </button>
        </div>
        <div class="filter-bar schedule-filters">
          <select v-choice v-model="selected" aria-label="课表学期" :disabled="!terms.length">
            <option v-if="scheduleMode !== 'week' || !terms.length" value="">全部学期</option>
            <option v-for="t in terms" :key="t.id" :value="t.id">{{ t.name }}</option>
          </select>
          <select v-choice v-model="filters.courseID" aria-label="计划课程筛选">
            <option value="">全部课程</option>
            <option v-for="c in courses" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
          <select v-choice v-model="filters.filter" aria-label="计划状态筛选">
            <option value="active">全部计划</option>
            <option value="pending">待完成</option>
            <option value="unscheduled">待安排</option>
            <option value="completed">已完成</option>
            <option value="cancelled">已取消</option>
          </select>
          <input v-model="filters.query" aria-label="搜索计划" placeholder="搜索计划与课程" />
          <div class="schedule-kind-toggles">
            <label class="check-label"
              ><input type="checkbox" v-model="filters.showsFixed" />固定</label
            ><label class="check-label"><input type="checkbox" v-model="showPlans" />活动</label>
          </div>
          <button v-if="term" @click="openSettings"><Settings2 :size="15" />学期设置</button>
        </div>
        <template v-if="scheduleMode === 'week'">
          <div v-if="term" class="timetable-mode" role="group" aria-label="课表视图">
            <button
              :class="{ active: mode === 'list' }"
              @click="mode = 'list'"
              aria-label="课表课程列表"
            >
              课程列表</button
            ><button
              :class="{ active: mode === 'timeline' }"
              @click="mode = 'timeline'"
              aria-label="课表时间网格"
            >
              时间网格
            </button>
          </div>
          <div v-if="mode === 'timeline'" class="timeline-controls">
            <label class="check-label"
              ><input
                type="checkbox"
                v-model="fixedEditing"
                :disabled="!filters.showsFixed"
              />编辑固定课程与计划</label
            >
            <span class="muted small">拖动只调整本次 · Esc 取消</span>
          </div>
          <div v-if="mode === 'timeline'" class="timeline-selection" aria-label="选中时间安排">
            <template v-if="chosen">
              <strong>{{ chosen.title }}</strong
              ><span
                >{{ clock(chosen.range.start) }} – {{ clock(chosen.range.end) }} ·
                {{ chosen.location }}</span
              >
              <span class="spacer" />
              <template v-if="chosen.course">
                <label class="meeting-month-toggle"
                  ><input
                    type="checkbox"
                    :checked="monthVisible(chosen.course)"
                    :disabled="!!store.busy"
                    @change="setMonthVisible(chosen.course, $event)"
                    :aria-label="'月历显示 ' + chosen.title"
                  />月历显示</label
                >
                <button @click="openMove(chosen.course)" :disabled="!!store.busy">调整本次</button>
                <button @click="cancel(chosen.course)" :disabled="!!store.busy">取消本次</button>
                <button
                  v-if="chosen.course.rescheduleID"
                  @click="restoreMove(chosen.course.rescheduleID)"
                  :disabled="!!store.busy"
                >
                  还原调课
                </button>
              </template>
              <span v-else class="small muted">{{
                chosen.clipped
                  ? '跨天安排请双击打开详情调整，保留完整时长'
                  : chosen.fixed && !fixedEditing
                    ? '固定计划已锁定'
                    : '可拖动调整本次；截止与其他发生项保持不变'
              }}</span> </template
            ><span v-else class="muted small">选择一个安排查看详情；固定课程默认锁定。</span>
          </div>
        </template>
        <p v-if="term && term.weekOneMonday == null" class="schedule-notice">
          此学期尚未设置开学日期。周视图按周次显示课程，设置日期后再与活动计划对应。
        </p>
        <p
          v-else-if="scheduleMode === 'week' && term && academicWeek == null"
          class="schedule-notice"
        >
          当前日期在学期之外，活动计划仍可正常安排。
        </p>
        <p v-if="scheduleMode === 'month'" class="schedule-notice">
          默认显示 DDL，其他安排可在详情中加入月历。
        </p>
        <div class="selected-day-plans" role="complementary" aria-label="选中日期安排">
          <strong>{{ selectedLabel }}</strong>
          <span class="muted small">{{ selectedEvents.length }} 项安排</span>
          <ScheduleEventRows
            :events="selectedEvents"
            compact
            :month="scheduleMode === 'month'"
            @open="openEvent"
          />
          <p v-if="!selectedEvents.length" class="muted small">
            {{ scheduleMode === 'month' ? '这一天没有月历条目。' : '这一天没有安排。' }}
          </p>
          <template v-if="loosePlans.length"
            ><h3>{{ filters.filter === 'active' ? '待安排' : '筛选计划' }}</h3>
            <button
              v-for="task in loosePlans"
              :key="task.id"
              class="loose-plan"
              @click="editingTask = task"
            >
              <strong>{{ task.title }}</strong
              ><small>{{
                task.cancelledAt ? '含已取消的安排' : task.completedAt ? '已完成' : '查看计划详情'
              }}</small>
            </button></template
          >
        </div>
      </div>
      <footer class="schedule-create">
        <button aria-label="新建计划" @click="creatingPlan = true">＋ 新建计划</button>
      </footer>
    </aside>
    <TaskEditor v-if="editingTask" :task="editingTask" @close="editingTask = undefined" />
    <TaskEditor
      v-if="creatingPlan"
      :initial-date="ui.day"
      :initial-course-i-d="filters.courseID"
      @close="creatingPlan = false"
    />
    <TaskEditor
      v-if="editingOccurrence"
      :task="store.state.tasks.find((t) => t.id === editingOccurrence!.task.id)"
      :occurrence="editingOccurrence"
      @close="editingOccurrence = undefined"
    />
    <div class="schedule-datebar">
      <button
        class="icon-button"
        :aria-label="
          scheduleMode === 'month' ? '上个月' : scheduleMode === 'agenda' ? '上一天' : '上一周'
        "
        :disabled="undatedWeek && week <= 1"
        @click="shiftDate(-1)"
      >
        <ChevronLeft :size="17" />
      </button>
      <label v-if="scheduleMode === 'week' && term" class="academic-week-label"
        ><template v-if="academicWeek != null || undatedWeek"
          >第
          <input
            v-model.number="week"
            aria-label="课表周次"
            type="number"
            :min="1"
            :max="term.weekCount"
            class="week-input"
          />
          周</template
        ><select
          v-else
          v-choice
          aria-label="课表周次"
          :value="''"
          @change="week = Number(($event.target as HTMLSelectElement).value)"
        >
          <option value="" disabled>学期外</option>
          <option v-for="n in term.weekCount" :key="n" :value="n">第 {{ n }} 周</option>
        </select></label
      >
      <strong v-if="!undatedWeek" class="schedule-date-title">{{ dateTitle }}</strong>
      <button
        class="icon-button"
        :aria-label="
          scheduleMode === 'month' ? '下个月' : scheduleMode === 'agenda' ? '下一天' : '下一周'
        "
        :disabled="undatedWeek && week >= (term?.weekCount ?? 1)"
        @click="shiftDate(1)"
      >
        <ChevronRight :size="17" />
      </button>
      <span class="spacer" /><button
        :disabled="undatedWeek"
        @click="ui.day = shanghaiDayKey(swiftNow())"
      >
        {{ scheduleMode === 'week' ? '本周' : '今天' }}
      </button>
      <input
        v-if="scheduleMode === 'month'"
        type="month"
        aria-label="月历月份"
        :value="ui.day.slice(0, 7)"
        @change="chooseMonth"
      />
      <input
        v-else
        v-model="ui.day"
        type="date"
        :aria-label="scheduleMode === 'agenda' ? '日程日期' : '跳转日期'"
        :disabled="undatedWeek"
      />
    </div>
    <PlanMonthCalendar
      v-if="scheduleMode === 'month'"
      v-model:day="ui.day"
      :events="monthEvents"
      @open-day="openDay"
    />
    <div v-else-if="scheduleMode === 'agenda'" ref="agendaScroll" class="schedule-day-view">
      <header>
        <div>
          <h2>{{ selectedLabel }}</h2>
          <p class="muted small">
            {{ selectedEvents.filter((e) => !e.deadline).length }} 项安排 ·
            {{ selectedEvents.filter((e) => e.deadline).length }} 个 DDL
          </p>
        </div>
      </header>
      <p v-if="!selectedEvents.length" class="schedule-day-empty">这一天没有符合条件的安排</p>
      <section
        v-for="section in daySections"
        v-show="selectedEvents.some((e) => e.section === section.id)"
        :key="section.id"
        :aria-label="section.title"
        class="schedule-day-section"
      >
        <h3>{{ section.title }}</h3>
        <ScheduleEventRows
          :events="selectedEvents.filter((e) => e.section === section.id)"
          :busy="!!store.busy"
          @open="openEvent"
          @status="eventStatus"
        />
      </section>
    </div>
    <template v-else-if="term || mode === 'timeline'">
      <div class="timetable-scroll" ref="scroll" @scroll="clearDrag">
        <div v-if="term && term.weekOneMonday == null" class="empty-state compact">
          <CalendarDays :size="38" />
          <h2>第 {{ week }} 周 · 尚未关联日期</h2>
          <p>设置开学日期后，课程才会显示在月历、日程及真实日期的时间轴中。</p>
          <button class="primary" @click="openSettings">设置学期</button>
          <div class="floating-week">
            <section v-for="n in 7" :key="n">
              <h3>{{ ['周一', '周二', '周三', '周四', '周五', '周六', '周日'][n - 1] }}</h3>
              <p
                v-for="meeting in floatingMeetings.filter((m) => m.weekday === n)"
                :key="meeting.id"
              >
                {{ meeting.title
                }}<small>第 {{ meeting.startSection }} 节 · {{ meeting.classroom }}</small>
              </p>
            </section>
          </div>
        </div>
        <template v-else-if="mode === 'timeline'">
          <p v-if="timelineDays.some((d) => d.withoutTime.length)" class="info-note">
            部分课程未配置完整节次时间，保留在课程列表中。请先到学期设置填写时间后再拖动。
          </p>
          <div class="timeline-board" :class="{ 'is-dragging': drag?.active }">
            <div class="timeline-header">
              <span class="timeline-label">北京时间</span>
              <button
                v-for="day in timelineDays"
                :key="day.weekday"
                :class="{ outside: day.day === undefined, selected: day.key === ui.day }"
                :aria-label="'选择日期 ' + day.key"
                :aria-pressed="day.key === ui.day"
                :disabled="day.day === undefined"
                @click="ui.day = day.key"
              >
                <strong>{{ day.weekday }}</strong
                ><span>{{ day.key.slice(5) || '学期外' }}</span>
                <small
                  v-if="day.untimed.length"
                  :title="
                    day.untimed
                      .map((p) => p.task.title + (p.isDeadline ? '（截止）' : '（全天）'))
                      .join('、')
                  "
                  >{{ day.untimed.length }} 项全天 / 截止</small
                >
              </button>
            </div>
            <div class="timeline-body" :style="{ height: timeline.height + 'px' }">
              <div class="timeline-axis">
                <template v-for="s in timeline.times" :key="s.section">
                  <span class="axis-time" :style="{ top: timeline.y(s.startMinute) + 'px' }">{{
                    !term || term.sectionTimes.some((t) => t.section === s.section)
                      ? clock(s.startMinute)
                      : ''
                  }}</span>
                  <span
                    class="axis-section"
                    :style="{
                      top: timeline.y(s.startMinute) + 'px',
                      height: timeline.y(s.endMinute) - timeline.y(s.startMinute) + 'px',
                    }"
                    >{{ s.section }}</span
                  >
                </template>
                <span
                  v-if="timeline.lunch"
                  class="axis-break"
                  :style="{
                    top: timeline.y(timeline.lunch.start) + 'px',
                    height:
                      timeline.y(timeline.lunch.end) - timeline.y(timeline.lunch.start) + 'px',
                  }"
                  >午休</span
                >
              </div>
              <div ref="grid" class="timeline-grid" :style="{ height: timeline.height + 'px' }">
                <div
                  v-for="day in timelineDays"
                  :key="day.weekday"
                  class="timeline-day"
                  :class="{ outside: day.day === undefined }"
                  :data-day="day.key"
                >
                  <div
                    v-for="minute in timeline.gridMinutes"
                    :key="minute"
                    class="timeline-rule"
                    :style="{ top: timeline.y(minute) + 'px' }"
                    :data-minute="minute"
                  />
                  <template v-for="item in day.events" :key="item.id">
                    <button
                      class="timeline-event"
                      :class="{
                        selected: chosen?.id === item.id,
                        locked: item.clipped || (item.fixed && !fixedEditing),
                        dragging: drag?.active && drag.event.id === item.id,
                      }"
                      :style="eventStyle(item)"
                      :data-event-id="item.id"
                      :data-kind="item.course ? 'course' : 'plan'"
                      :data-start="item.range.start"
                      :data-end="item.range.end"
                      :data-lane="item.lane"
                      :data-lanes="item.laneCount"
                      :disabled="!!store.busy"
                      :aria-label="
                        item.title + '，' + clock(item.range.start) + '–' + clock(item.range.end)
                      "
                      :title="
                        item.title +
                        ' · ' +
                        clock(item.range.start) +
                        '–' +
                        clock(item.range.end) +
                        ' · ' +
                        item.location +
                        (item.clipped
                          ? ' · 跨天安排，请双击编辑完整时间'
                          : item.fixed && !fixedEditing
                            ? ' · 开启编辑固定课程与计划后可拖动'
                            : ' · 拖动调整本次时间')
                      "
                      @pointerdown="startDrag($event, item)"
                      @click="chooseEvent(item)"
                      @dblclick="
                        item.course ? openMove(item.course) : (editingOccurrence = item.plan)
                      "
                      @lostpointercapture="clearDrag"
                    >
                      <strong>{{ item.title }}</strong
                      ><small>{{ clock(item.range.start) }}–{{ clock(item.range.end) }}</small
                      ><span v-if="item.height >= 62">{{ item.location }}</span
                      ><small v-if="item.course?.rescheduleID && item.height >= 80">已调课</small>
                    </button>
                    <template
                      v-if="
                        chosen?.id === item.id &&
                        !item.clipped &&
                        (!item.fixed || fixedEditing) &&
                        item.height >= 12
                      "
                    >
                      <button
                        v-for="edge in ['start', 'end'] as const"
                        :key="edge"
                        class="timeline-resize"
                        :disabled="!!store.busy"
                        :class="edge"
                        :style="resizeStyle(item, edge)"
                        :aria-label="
                          (edge === 'start' ? '调整开始边界 ' : '调整结束边界 ') + item.title
                        "
                        :title="
                          (edge === 'start' ? '调整开始' : '调整结束') +
                          '；方向键或 +/- 微调 1 分钟'
                        "
                        @pointerdown.stop="startDrag($event, item, edge)"
                        @lostpointercapture="clearDrag"
                        @keydown="timeKey($event, item, edge)"
                      >
                        <span />
                      </button>
                    </template>
                  </template>
                </div>
                <div
                  v-if="drag?.active && drag.target"
                  class="timeline-drop"
                  :class="{ conflict: targetConflicts.length }"
                  :style="{
                    left: (drag.target.dayIndex * 100) / 7 + '%',
                    width: 100 / 7 + '%',
                    top: timeline.rect(drag.target.range).top + 'px',
                    height: timeline.rect(drag.target.range).height + 'px',
                  }"
                  aria-label="拖动目标"
                >
                  <strong
                    >{{ clock(drag.target.range.start) }}–{{ clock(drag.target.range.end) }}</strong
                  ><span v-if="targetConflicts.length"
                    >与 {{ targetConflicts.length }} 项重叠，保留并列</span
                  >
                </div>
              </div>
            </div>
          </div>
          <p class="field-note">
            课程按实际节次时间排列，小课间压缩显示。拖动按 10
            分钟吸附，保留准确时长；选中后可拖动上下边缘。方向键调整 10 分钟或 1 天，+/- 调整 1
            分钟。重叠安排分列显示。
          </p>
        </template>
        <div v-else class="week-board">
          <section v-for="day in days" :key="day.weekday" class="week-day">
            <header>
              <strong>{{ day.weekday }}</strong
              ><span>{{ day.key.slice(5) }}</span>
            </header>
            <div
              v-for="item in day.items"
              :key="item.id"
              class="timetable-event"
              :style="{
                '--event-color':
                  item.meeting.colorHex ??
                  store.state.courses.find((c) => c.id === item.meeting.courseID)?.colorHex ??
                  '#39786B',
              }"
            >
              <small>{{ time(item) }}</small
              ><strong>{{ item.meeting.title }}</strong
              ><span>{{ item.meeting.classroom }}</span
              ><small>{{ item.meeting.teacher }}</small
              ><small v-if="item.rescheduleID">已调课</small
              ><label class="meeting-month-toggle" title="影响这个课程时段的所有周次"
                ><input
                  type="checkbox"
                  :checked="monthVisible(item)"
                  :disabled="!!store.busy"
                  :aria-label="'月历显示 ' + item.meeting.title"
                  @change="setMonthVisible(item, $event)"
                />月历显示</label
              >
              <div class="timetable-event-actions">
                <button class="small-button" @click="openMove(item)">调整本次</button
                ><button class="small-button" @click="cancel(item)">取消本次</button
                ><button
                  v-if="item.rescheduleID"
                  class="small-button"
                  @click="restoreMove(item.rescheduleID)"
                >
                  还原调课
                </button>
              </div>
            </div>
            <p v-if="!day.items.length" class="muted small day-empty">
              {{ day.day === undefined ? '学期范围外' : '无课程' }}
            </p>
          </section>
        </div>
        <div v-if="term" class="timetable-extra">
          <template v-if="term.reschedules.length"
            ><h3>调课记录</h3>
            <div v-for="r in term.reschedules" :key="r.id" class="cancel-row">
              <span
                >{{ shanghaiDayKey(r.originalDate) }} → {{ shanghaiDayKey(r.date) }} ·
                {{ r.meeting.title }}</span
              ><button @click="restoreMove(r.id)">还原调课</button>
            </div></template
          ><template v-if="term.meetings.some((m) => !isScheduled(m))"
            ><h3>待安排</h3>
            <p v-for="m in term.meetings.filter((m) => !isScheduled(m))" :key="m.id">
              {{ m.title }} · {{ m.teacher }} <span class="muted">{{ m.note }}</span>
            </p></template
          ><template v-if="term.cancellations.length"
            ><h3>停课记录</h3>
            <div v-for="c in term.cancellations" :key="c.id" class="cancel-row">
              <span
                >{{ shanghaiDayKey(c.date) }} · {{ c.title }}
                <span class="muted">{{ c.reason }}</span></span
              ><button
                @click="
                  store.change(() => api.restoreTimetableClass(term!.id, c.id), '已恢复本次课程')
                "
              >
                恢复课程
              </button>
            </div></template
          >
        </div>
      </div></template
    >
    <div v-else class="empty-state">
      <CalendarDays :size="44" />
      <h2>还没有学期课表</h2>
      <p>导入原版资料库中的课表，或读取学校网站和本科课表 JSON。</p>
      <button class="primary" @click="importJSON">导入课表 JSON</button>
    </div>
    <Modal
      v-if="meetingDetails"
      :title="scheduleMode === 'month' ? '月历课程' : '课程详情'"
      @close="meetingDetails = undefined"
      ><div class="form-stack">
        <h3>{{ meetingDetails.title }}</h3>
        <p>{{ ui.day }} · {{ meetingDetails.time }}</p>
        <p>{{ meetingDetails.location }} · {{ meetingDetails.meeting?.meeting.teacher }}</p>
        <p class="muted">{{ meetingDetails.term?.name }}</p>
        <label class="check-label"
          ><input
            type="checkbox"
            :checked="
              terms
                .find((t) => t.id === meetingDetails!.term?.id)
                ?.meetings.find((m) => m.id === meetingDetails!.meeting?.meeting.id)?.showInMonth ??
              false
            "
            :disabled="!!store.busy"
            @change="toggleMeeting"
          />此时段显示在月历</label
        >
        <div class="dialog-actions">
          <button @click="meetingDetails = undefined">关闭</button
          ><button
            @click="
              selected = meetingDetails!.term!.id;
              meetingDetails = undefined;
              ui.openSchedule('week');
            "
          >
            打开课表
          </button>
        </div>
      </div></Modal
    >
    <Modal v-if="statusOperation" :title="statusTitle" @close="statusOperation = undefined"
      ><div class="form-stack">
        <p>{{ statusOperation.event.task.title }}</p>
        <label
          >作用范围<select v-choice v-model="statusScope" aria-label="作用范围">
            <option v-if="statusOperation.event.task.repeatRule" value="thisOccurrence">
              仅本次
            </option>
            <option
              v-if="statusOperation.event.task.repeatRule && statusOperation.action === 'cancel'"
              value="thisAndFuture"
            >
              本次及以后
            </option>
            <option value="all">整组计划</option>
          </select></label
        >
        <div class="dialog-actions">
          <button @click="statusOperation = undefined">取消</button
          ><button class="primary" :disabled="!!store.busy" @click="applyStatus">
            {{
              statusOperation.action === 'complete'
                ? '确认完成'
                : statusOperation.action === 'cancel'
                  ? '确认取消'
                  : '恢复待完成'
            }}
          </button>
        </div>
      </div></Modal
    >
    <Modal v-if="moving" title="调整本次课程" @close="moving = null"
      ><form class="form-stack" @submit.prevent="saveMove">
        <h3>{{ moving.meeting.title }}</h3>
        <p class="muted">
          原定 {{ shanghaiDayKey(moving.originalDate) }}。仅调整这一次，其他周次保留。
        </p>
        <label>调至日期（北京时间）<input type="date" v-model="moveForm.date" required /></label>
        <div class="form-row">
          <label
            >起始节次<input
              type="number"
              v-model.number="moveForm.startSection"
              min="1"
              max="30"
              required /></label
          ><label
            >持续节数<input
              type="number"
              v-model.number="moveForm.sectionCount"
              min="1"
              :max="31 - moveForm.startSection"
              required
          /></label>
        </div>
        <label>教室<input v-model="moveForm.classroom" maxlength="500" /></label
        ><label class="check-label"
          ><input type="checkbox" v-model="moveForm.customTime" />使用自定义时间</label
        >
        <div v-if="moveForm.customTime" class="form-row">
          <label>上课时间<input type="time" v-model="moveForm.start" required /></label
          ><label>下课时间<input type="time" v-model="moveForm.end" required /></label>
        </div>
        <p v-else class="field-note">按学期节次设置显示上课时间。</p>
        <p v-if="moveValidation" class="warning-banner">{{ moveValidation }}</p>
        <div class="dialog-actions">
          <span class="spacer" /><button type="button" @click="moving = null">取消</button
          ><button class="primary" :disabled="!!store.busy || !!moveValidation">
            保存本次调整
          </button>
        </div>
      </form></Modal
    ><Modal v-if="editing" title="学期设置" @close="editing = false"
      ><form class="form-stack" @submit.prevent="store.run(save)">
        <label>第一周周一（北京时间）<input type="date" v-model="monday" required /></label>
        <div class="form-row">
          <label
            >学期周数<input
              v-model.number="weekCount"
              type="number"
              min="1"
              max="60"
              required /></label
          ><label>结束日期（可选）<input v-model="endDate" type="date" /></label>
        </div>
        <p class="field-note">节次时间请依据本学期学校安排填写。留空时仍按节次展示。</p>
        <div class="section-times">
          <div v-for="s in times" :key="s.section">
            <span>第 {{ s.section }} 节</span
            ><input type="time" v-model="s.start" :aria-label="`第${s.section}节开始时间`" /><span
              >至</span
            ><input type="time" v-model="s.end" :aria-label="`第${s.section}节结束时间`" />
          </div>
        </div>
        <div class="dialog-actions">
          <span class="spacer" /><button type="button" @click="editing = false">取消</button
          ><button class="primary" :disabled="!!store.busy">保存学期设置</button>
        </div>
      </form></Modal
    >
  </section>
</template>
<style scoped>
.timeline-header > button.selected {
  background: var(--selection);
  color: var(--accent);
}
.selected-day-plans {
  padding: 14px 0;
  border-top: 1px solid var(--border);
  display: grid;
  gap: 8px;
}
.selected-day-plans button {
  text-align: left;
  white-space: normal;
}
.timetable-mode {
  display: flex;
  gap: 3px;
}
.timetable-mode .active {
  background: var(--accent-soft);
  color: var(--accent);
  border-color: var(--accent);
}
.timeline-controls,
.timeline-selection {
  display: flex;
  align-items: center;
  gap: 15px;
  padding: 10px 22px;
  border-bottom: 1px solid var(--border);
  font-size: 12px;
  flex-wrap: wrap;
}
.timeline-controls label {
  display: flex;
  align-items: center;
  gap: 6px;
}
.timeline-selection {
  height: 58px;
  min-height: 58px;
  flex-shrink: 0;
  flex-wrap: nowrap;
  overflow-x: auto;
  gap: 8px;
  background: var(--surface);
}
.timeline-selection > strong {
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.timeline-selection > span {
  color: var(--muted);
  font-size: 11px;
}
.timeline-board {
  min-width: 730px;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  background: var(--bg);
}
.timeline-header {
  display: grid;
  grid-template-columns: 76px repeat(7, minmax(0, 1fr));
  background: var(--surface);
  height: 66px;
  border-bottom: 1px solid var(--border);
}
.timeline-header > button {
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--text);
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  padding: 9px 3px;
  border-left: 1px solid var(--border);
  font-size: 12px;
}
.timeline-header span,
.timeline-header small {
  font-size: 10px;
  color: var(--muted);
}
.timeline-label {
  padding: 22px 6px;
  text-align: center;
}
.timeline-body {
  position: relative;
  display: flex;
}
.timeline-axis {
  width: 76px;
  position: relative;
  flex: none;
  background: var(--surface);
  font-size: 10px;
  color: var(--muted);
}
.axis-time {
  position: absolute;
  left: 5px;
  transform: translateY(-50%);
}
.axis-section {
  position: absolute;
  right: 5px;
  width: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
}
.axis-break {
  position: absolute;
  right: 3px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
}
.timeline-grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  position: relative;
  flex: 1;
  touch-action: none;
}
.timeline-day {
  position: relative;
  border-left: 1px solid var(--border);
  min-width: 0;
}
.timeline-day.outside,
.timeline-header .outside {
  background: repeating-linear-gradient(
    135deg,
    var(--surface),
    var(--surface) 6px,
    var(--bg) 6px,
    var(--bg) 12px
  );
}
.timeline-rule {
  position: absolute;
  left: 0;
  right: 0;
  border-top: 1px solid var(--border);
  pointer-events: none;
}
.timeline-event {
  position: absolute;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: flex-start;
  gap: 3px;
  min-height: 0;
  padding: 4px 5px;
  border: 0;
  border-left: 3px solid var(--event-color);
  border-radius: 3px;
  background: color-mix(in srgb, var(--event-color) 17%, var(--bg));
  overflow: hidden;
  white-space: normal;
  text-align: left;
  font-size: 11px;
  touch-action: none;
  user-select: none;
  cursor: grab;
}
.timeline-event strong {
  font-size: 11px;
  line-height: 1.3;
  overflow-wrap: anywhere;
}
.timeline-event small,
.timeline-event span {
  font-size: 9px;
  line-height: 1.2;
}
.timeline-resize {
  position: absolute;
  height: 6px;
  min-height: 0;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: ns-resize;
  z-index: 3;
  touch-action: none;
}
.timeline-resize span {
  width: 18px;
  height: 2px;
  background: var(--accent);
  border-radius: 2px;
}
.timeline-resize:hover:not(:disabled),
.timeline-resize:focus-visible {
  background: var(--accent-soft);
}
.timeline-event.locked {
  cursor: default;
}
.timeline-event.selected {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}
.timeline-event.dragging {
  opacity: 0.2;
}
.timeline-drop {
  position: absolute;
  pointer-events: none;
  border: 2px dashed var(--accent);
  background: color-mix(in srgb, var(--accent) 15%, var(--bg));
  border-radius: 4px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 5px;
  font-size: 11px;
  z-index: 5;
  overflow: hidden;
}
.timeline-drop.conflict {
  border-color: #a76a1f;
  background: color-mix(in srgb, #ce9b43 20%, var(--bg));
}
.timeline-drop span {
  font-size: 10px;
}
.is-dragging {
  cursor: grabbing;
}
.timetable-scroll {
  overflow: auto;
  flex: 1;
  padding: 18px 22px;
}
.week-board {
  display: grid;
  grid-template-columns: repeat(7, minmax(105px, 1fr));
  min-height: 380px;
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
}
.week-day {
  border-right: 1px solid var(--border);
  padding: 8px;
  background: var(--surface);
}
.week-day:last-child {
  border: 0;
}
.week-day > header {
  display: flex;
  flex-direction: column;
  gap: 5px;
  text-align: center;
  padding: 6px 0 15px;
  font-size: 12px;
}
.week-day > header span {
  color: var(--muted);
}
.timetable-event {
  display: flex;
  flex-direction: column;
  gap: 6px;
  border-left: 3px solid var(--event-color);
  background: color-mix(in srgb, var(--event-color) 11%, transparent);
  padding: 10px 8px;
  margin-bottom: 10px;
  border-radius: 5px;
  font-size: 12px;
  word-break: break-word;
}
.timetable-event strong {
  line-height: 1.5;
}
.timetable-event small {
  font-size: 10px;
  opacity: 0.8;
}
.meeting-month-toggle {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 10px;
}
.meeting-month-toggle input {
  width: 13px;
  height: 13px;
  margin: 0;
  accent-color: var(--accent);
}
.timetable-event-actions {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}
.small-button {
  font-size: 10px;
  padding: 4px 6px;
  margin-top: 5px;
  align-self: flex-start;
}
.day-empty {
  text-align: center;
  margin-top: 25px;
}
.timetable-extra {
  padding-top: 22px;
}
.timetable-extra h3 {
  font-size: 14px;
  margin: 18px 0 12px;
}
.cancel-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 0;
  font-size: 12px;
  border-bottom: 1px solid var(--border);
}
.week-input {
  width: 56px;
  padding: 5px;
}
.section-times {
  max-height: 220px;
  overflow: auto;
}
.section-times > div {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 7px 0;
  font-size: 12px;
}
.section-times input {
  max-width: 135px;
}
.empty-state.compact {
  min-height: 260px;
}
</style>
