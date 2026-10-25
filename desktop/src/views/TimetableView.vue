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
  timetableOccurrences,
  timetableWeek,
  shanghaiDayKey,
  meetingTimeRange,
  isScheduled,
  shanghaiDay,
} from '../../shared/timetable';
import type { TimetableTerm, TimetableOccurrence } from '../../shared/timetable';
import { useLibrary } from '../stores/library';
import Modal from '../components/Modal.vue';
import { addPlanDays, planEvents } from '../../shared/plans';
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
const selected = ref(''),
  week = ref(1),
  editing = ref(false),
  monday = ref(''),
  weekCount = ref(20),
  endDate = ref(''),
  times = ref<{ section: number; start: string; end: string }[]>([]);
const mode = ref<'list' | 'timeline'>('list'),
  fixedEditing = ref(false),
  showPlans = ref(true),
  grid = ref<HTMLElement>(),
  scroll = ref<HTMLElement>();
const selectedEventID = ref('');
const moveGuard = ref<{ revision: string; root: string }>();
interface TimelineEvent {
  id: string;
  title: string;
  location: string;
  color: string;
  date: number;
  range: MinuteRange;
  fixed: boolean;
  course?: TimetableOccurrence;
  plan?: PlanOccurrence;
}
interface DragState {
  event: TimelineEvent;
  termID: string;
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
  term = computed(() => terms.value.find((t) => t.id === selected.value) ?? terms.value[0]);
watch(
  () => term.value?.id,
  () => {
    if (term.value) {
      selected.value = term.value.id;
      week.value = timetableWeek(term.value, swiftNow()) ?? 1;
    }
  },
  { immediate: true },
);
const days = computed(() =>
  Array.from({ length: 7 }, (_, i) => {
    const day = term.value ? timetableDate(term.value, week.value, i + 1) : undefined;
    return {
      weekday: ['周一', '周二', '周三', '周四', '周五', '周六', '周日'][i],
      day,
      key: day === undefined ? '' : shanghaiDayKey(day),
      items: term.value && day !== undefined ? timetableOccurrences(term.value, day) : [],
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
    Math.max(520, sections.value * 48),
    sections.value,
    term.value?.sectionTimes ?? [],
  ),
);
const timelineDays = computed(() =>
  days.value.map((day) => {
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
    const plans =
      showPlans.value && day.day !== undefined
        ? planEvents(
            day.day,
            store.state.tasks.map((t) => toRaw(t)),
          )
        : [];
    const untimed = plans.filter((p) => p.isAllDay || p.isDeadline);
    for (const occurrence of plans) {
      if (occurrence.isAllDay || occurrence.isDeadline) continue;
      const range = {
        start: Math.round(
          (dateMs(occurrence.task.startsAt) - dateMs(shanghaiDay(occurrence.date))) / 60000,
        ),
        end: Math.round(
          (dateMs(
            occurrence.task.endsAt ??
              (dateMs(occurrence.task.startsAt) - SWIFT_EPOCH_MS) / 1000 + 1800,
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
function chooseEvent(event: TimelineEvent) {
  if (Date.now() < suppressClickUntil) return;
  selectedEventID.value = event.id;
}
function startDrag(
  event: PointerEvent,
  item: TimelineEvent,
  edge: 'move' | 'start' | 'end' = 'move',
) {
  if (event.button !== 0 || store.busy || (item.fixed && !fixedEditing.value) || !term.value)
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
    termID: term.value.id,
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
  termID: string,
) {
  if (store.busy || (item.fixed && !fixedEditing.value)) return;
  if (!guardCurrent(expected) || term.value?.id !== termID) {
    store.error = '资料库已变化，已取消这次时间调整。';
    return;
  }
  if (!validMinuteRange(range) || timetableWeek(term.value!, date) === undefined) return;
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
          termID,
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
    week.value = timetableWeek(term.value, date) ?? week.value;
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
  if (editingKeyContext(event) || drag.value || (item.fixed && !fixedEditing.value) || !term.value)
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
    await applyEventTime(item, addPlanDays(item.date, days), range, expected, term.value.id);
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
watch([() => store.snapshot?.root, () => term.value?.id, week, mode, showPlans], () => {
  clearDrag();
  selectedEventID.value = '';
});
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
  <section class="workspace">
    <header class="workspace-header">
      <div class="heading-block">
        <h1>课表</h1>
        <p>按北京时间与学期周次展示课程，保留原有调课与停课记录。</p>
      </div>
      <div class="toolbar-controls">
        <button @click="store.navigate('plans')"><ArrowLeft :size="15" />计划列表</button
        ><button @click="emit('website')"><Globe :size="15" />网站读取</button
        ><button class="primary" @click="importJSON"><Download :size="15" />导入课表 JSON</button>
      </div>
    </header>
    <template v-if="term"
      ><div class="filter-bar">
        <select v-model="selected" aria-label="课表学期">
          <option v-for="t in terms" :key="t.id" :value="t.id">{{ t.name }}</option>
        </select>
        <div class="timetable-mode" role="group" aria-label="课表视图">
          <button
            :class="{ active: mode === 'list' }"
            @click="mode = 'list'"
            aria-label="课表课程列表"
          >
            课程列表
          </button>
          <button
            :class="{ active: mode === 'timeline' }"
            @click="mode = 'timeline'"
            aria-label="课表时间网格"
          >
            时间网格
          </button>
        </div>
        <span class="spacer" /><button
          class="icon-button"
          aria-label="上一周"
          :disabled="week <= 1"
          @click="week--"
        >
          <ChevronLeft :size="17" /></button
        ><label
          >第
          <input
            v-model.number="week"
            aria-label="课表周次"
            type="number"
            :min="1"
            :max="term.weekCount"
            class="week-input"
          />
          周</label
        ><button
          class="icon-button"
          aria-label="下一周"
          :disabled="week >= term.weekCount"
          @click="week++"
        >
          <ChevronRight :size="17" /></button
        ><button @click="openSettings"><Settings2 :size="15" />学期设置</button>
      </div>
      <div v-if="mode === 'timeline'" class="timeline-controls">
        <label class="check-label"
          ><input type="checkbox" v-model="fixedEditing" />编辑固定课程与计划</label
        >
        <label class="check-label"><input type="checkbox" v-model="showPlans" />显示计划</label>
        <span class="muted small">拖动只调整本次 · 保留时长 · Esc 取消</span>
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
            chosen.fixed && !fixedEditing
              ? '固定计划已锁定'
              : '可拖动调整本次；截止与其他发生项保持不变'
          }}</span> </template
        ><span v-else class="muted small">选择一个安排查看详情；固定课程默认锁定。</span>
      </div>
      <div class="timetable-scroll" ref="scroll" @scroll="clearDrag">
        <div v-if="term.weekOneMonday == null" class="empty-state compact">
          <CalendarDays :size="38" />
          <h2>设置第一周的周一日期</h2>
          <p>已有 {{ term.meetings.length }} 个时段，设置起始日期后显示到具体日期。</p>
          <button class="primary" @click="openSettings">设置学期</button>
        </div>
        <template v-else-if="mode === 'timeline'">
          <p v-if="timelineDays.some((d) => d.withoutTime.length)" class="info-note">
            部分课程未配置完整节次时间，保留在课程列表中。请先到学期设置填写时间后再拖动。
          </p>
          <div class="timeline-board" :class="{ 'is-dragging': drag?.active }">
            <div class="timeline-header">
              <span class="timeline-label">北京时间</span>
              <div
                v-for="day in timelineDays"
                :key="day.weekday"
                :class="{ outside: day.day === undefined }"
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
              </div>
            </div>
            <div class="timeline-body" :style="{ height: timeline.height + 'px' }">
              <div class="timeline-axis">
                <template v-for="s in timeline.times" :key="s.section">
                  <span class="axis-time" :style="{ top: timeline.y(s.startMinute) + 'px' }">{{
                    term.sectionTimes.some((t) => t.section === s.section)
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
                        locked: item.fixed && !fixedEditing,
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
                        (item.fixed && !fixedEditing
                          ? ' · 开启编辑固定课程与计划后可拖动'
                          : ' · 拖动调整本次时间')
                      "
                      @pointerdown="startDrag($event, item)"
                      @click="chooseEvent(item)"
                      @dblclick="item.course && openMove(item.course)"
                      @lostpointercapture="clearDrag"
                    >
                      <strong>{{ item.title }}</strong
                      ><small>{{ clock(item.range.start) }}–{{ clock(item.range.end) }}</small
                      ><span v-if="item.height >= 62">{{ item.location }}</span
                      ><small v-if="item.course?.rescheduleID && item.height >= 80">已调课</small>
                    </button>
                    <template
                      v-if="
                        chosen?.id === item.id && (!item.fixed || fixedEditing) && item.height >= 12
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
        <div class="timetable-extra">
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
.timeline-header > div {
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
