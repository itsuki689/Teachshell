<script setup lang="ts">
import { computed, ref, toRaw } from 'vue';
import { CalendarDays, ChevronLeft, ChevronRight, Flag } from 'lucide-vue-next';
import { dateMs, swiftNow } from '../../shared/model';
import type { StudyTask } from '../../shared/model';
import { planEvents } from '../../shared/plans';
import type { PlanOccurrence } from '../../shared/plans';
import { meetingTimeRange, shanghaiDayKey, timetableOccurrences } from '../../shared/timetable';
import type { TimetableOccurrence, TimetableTerm } from '../../shared/timetable';
import { useLibrary } from '../stores/library';
import Modal from './Modal.vue';
import { matchesPlanStatus } from '../composables/plan-filter';
import type { PlanFilter } from '../composables/plan-filter';
const props = defineProps<{
  day: string;
  plans: StudyTask[];
  query: string;
  courseId: string;
  pending: boolean;
  statusFilter?: PlanFilter;
  includeCourses: boolean;
}>();
const api = window.teachshelf;
const emit = defineEmits<{ 'update:day': [day: string]; edit: [event: PlanOccurrence] }>(),
  store = useLibrary();
interface Entry {
  id: string;
  title: string;
  date: number;
  allDay: boolean;
  deadline: boolean;
  completed: boolean;
  color: string;
  time: string;
  location: string;
  plan?: PlanOccurrence;
  meeting?: TimetableOccurrence;
  term?: TimetableTerm;
}
const meetingDetails = ref<Entry | null>(null);
const today = shanghaiDayKey(swiftNow()),
  month = computed(() => props.day.slice(0, 7));
const monthLabel = computed(
  () => `${Number(month.value.slice(0, 4))} 年 ${Number(month.value.slice(5))} 月`,
);
const selectedLabel = computed(() =>
  new Date(props.day + 'T00:00:00+08:00').toLocaleDateString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }),
);
const terms = computed(() => store.state.timetableTerms as unknown as TimetableTerm[]);
const rawPlans = computed(() => props.plans.map((task) => toRaw(task)));
function clock(minutes: number) {
  return (
    String(Math.floor(minutes / 60)).padStart(2, '0') + ':' + String(minutes % 60).padStart(2, '0')
  );
}
function instantTime(date: number) {
  return new Date(dateMs(date)).toLocaleTimeString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
}
function matches(id: string | undefined, text: string) {
  return (
    (!props.courseId || id === props.courseId) &&
    text.toLocaleLowerCase().includes(props.query.toLocaleLowerCase())
  );
}
function color(value: unknown, courseID?: string) {
  return typeof value === 'string'
    ? value
    : (store.state.courses.find((c) => c.id === courseID)?.colorHex ?? 'var(--accent)');
}
function events(key: string): Entry[] {
  const result: Entry[] = planEvents(key + 'T00:00:00+08:00', rawPlans.value)
    .filter(
      (event) =>
        (event.isDeadline || event.task.showInMonth) &&
        matchesPlanStatus(event.task, props.statusFilter ?? 'active') &&
        matches(
          event.task.courseID,
          [event.task.title, event.task.content, event.task.kind].join(' '),
        ) &&
        (!props.pending || (event.task.completedAt == null && event.task.completionRequired)),
    )
    .map((plan) => ({
      id: 'plan-' + plan.id,
      title: plan.task.title,
      date: plan.date,
      allDay: plan.isAllDay,
      deadline: plan.isDeadline,
      completed: plan.task.completedAt != null,
      color: color(plan.task.colorHex, plan.task.courseID),
      time: plan.isDeadline
        ? plan.isAllDay
          ? '当日截止'
          : instantTime(plan.date) + ' 截止'
        : plan.isAllDay
          ? '全天'
          : instantTime(plan.date) +
            (plan.endDate == null ? '' : ' – ' + instantTime(plan.endDate)),
      location: plan.task.location,
      plan,
    }));
  if (props.includeCourses && !props.pending)
    for (const term of terms.value)
      for (const meeting of timetableOccurrences(term, key + 'T00:00:00+08:00')) {
        const master = term.meetings.find((item) => item.id === meeting.meeting.id);
        if (
          (master?.showInMonth ?? meeting.meeting.showInMonth) !== true ||
          !matches(
            meeting.meeting.courseID,
            [meeting.meeting.title, meeting.meeting.teacher, meeting.meeting.classroom].join(' '),
          )
        )
          continue;
        const range = meetingTimeRange(meeting.meeting, term.sectionTimes);
        result.push({
          id: 'course-' + term.id + '-' + meeting.id,
          title: meeting.meeting.title,
          date: meeting.date + (range?.start ?? 0) * 60,
          allDay: false,
          deadline: false,
          completed: false,
          color: color(meeting.meeting.colorHex, meeting.meeting.courseID),
          time: range
            ? clock(range.start) + ' – ' + clock(range.end)
            : `第 ${meeting.meeting.startSection}–${meeting.meeting.startSection + meeting.meeting.sectionCount - 1} 节`,
          location: meeting.meeting.classroom,
          meeting,
          term,
        });
      }
  return result.sort(
    (a, b) => Number(b.allDay) - Number(a.allDay) || a.date - b.date || a.id.localeCompare(b.id),
  );
}
const days = computed(() => {
  const [year, monthNumber] = month.value.split('-').map(Number),
    first = Date.UTC(year, monthNumber - 1, 1),
    offset = (new Date(first).getUTCDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, index) => {
    const key = new Date(first + (index - offset) * 86400000).toISOString().slice(0, 10);
    return {
      key,
      number: Number(key.slice(8)),
      current: key.startsWith(month.value),
      events: events(key),
    };
  });
});
const selectedEvents = computed(
  () => days.value.find((day) => day.key === props.day)?.events ?? [],
);
function shiftMonth(offset: number) {
  const [year, monthNumber, dayNumber] = props.day.split('-').map(Number),
    first = new Date(Date.UTC(year, monthNumber - 1 + offset, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(dayNumber, last));
  emit('update:day', first.toISOString().slice(0, 10));
}
function chooseMonth(event: Event) {
  const value = (event.target as HTMLInputElement).value;
  if (/^\d{4}-\d{2}$/.test(value)) emit('update:day', value + '-01');
}
function meetingVisible(entry: Entry) {
  const term = terms.value.find((t) => t.id === entry.term?.id);
  return (
    (term?.meetings.find((m) => m.id === entry.meeting?.meeting.id)?.showInMonth ??
      entry.meeting?.meeting.showInMonth) === true
  );
}
async function toggleMeeting(entry: Entry, event: Event) {
  if (!entry.term || !entry.meeting) return;
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
function open(entry: Entry) {
  if (entry.plan) emit('edit', entry.plan);
  else meetingDetails.value = entry;
}
</script>
<template>
  <div class="month-controls">
    <button class="icon-button" aria-label="上个月" @click="shiftMonth(-1)">
      <ChevronLeft :size="17" /></button
    ><strong>{{ monthLabel }}</strong
    ><button class="icon-button" aria-label="下个月" @click="shiftMonth(1)">
      <ChevronRight :size="17" /></button
    ><input type="month" aria-label="月历月份" :value="month" @change="chooseMonth" /><button
      @click="emit('update:day', today)"
    >
      今天</button
    ><span class="spacer" /><span class="small muted"
      >截止项默认显示，其他安排依照“月历显示”设置。</span
    >
  </div>
  <div class="month-layout">
    <div class="month-board">
      <div class="month-weekdays">
        <span v-for="weekday in ['一', '二', '三', '四', '五', '六', '日']" :key="weekday">{{
          weekday
        }}</span>
      </div>
      <div class="month-grid" aria-label="计划月历">
        <button
          v-for="cell in days"
          :key="cell.key"
          class="month-day"
          :class="{ outside: !cell.current, selected: cell.key === day, today: cell.key === today }"
          :data-date="cell.key"
          :aria-label="'选择日期 ' + cell.key"
          :aria-pressed="cell.key === day"
          @click="emit('update:day', cell.key)"
        >
          <span class="month-day-number">{{ cell.number }}</span
          ><span
            v-for="entry in cell.events.slice(0, 2)"
            :key="entry.id"
            class="month-event"
            :class="{ completed: entry.completed }"
            :data-source="entry.plan ? 'plan' : 'course'"
            ><Flag v-if="entry.deadline" :size="10" :style="{ color: entry.color }" /><span
              v-else
              class="month-event-dot"
              :style="{ background: entry.color }"
            /><span>{{ entry.title }}</span></span
          ><span v-if="cell.events.length > 2" class="month-more"
            >+{{ cell.events.length - 2 }} 项</span
          >
        </button>
      </div>
    </div>
    <aside class="month-agenda" aria-label="选中日期安排">
      <header>
        <strong>{{ selectedLabel }}</strong
        ><span class="muted small">{{ selectedEvents.length }} 项安排</span>
      </header>
      <p v-if="!selectedEvents.length" class="muted small">这一天没有月历条目。</p>
      <button
        v-for="entry in selectedEvents"
        :key="entry.id"
        class="month-agenda-event"
        :class="{ completed: entry.completed }"
        :style="{ '--event-color': entry.color }"
        :aria-label="(entry.plan ? '编辑月历计划 ' : '查看月历课程 ') + entry.title"
        @click="open(entry)"
      >
        <span class="small muted">{{ entry.time }}</span
        ><strong>{{ entry.title }}</strong
        ><span v-if="entry.location" class="small muted">{{ entry.location }}</span
        ><span class="small muted"
          >{{ entry.deadline ? '截止 DDL' : (entry.plan?.task.kind ?? '课程')
          }}{{ entry.completed ? ' · 已完成' : ''
          }}{{ entry.meeting?.rescheduleID ? ' · 已调课' : '' }}</span
        >
      </button>
    </aside>
  </div>
  <Modal v-if="meetingDetails" title="月历课程" @close="meetingDetails = null"
    ><div class="form-stack">
      <h3>{{ meetingDetails.title }}</h3>
      <p>{{ day }} · {{ meetingDetails.time }}</p>
      <p>
        {{ meetingDetails.location }}
        <span class="muted">{{ meetingDetails.meeting?.meeting.teacher }}</span>
      </p>
      <p class="muted">{{ meetingDetails.term?.name }}</p>
      <label class="check-label"
        ><input
          type="checkbox"
          :checked="meetingVisible(meetingDetails)"
          :disabled="!!store.busy"
          @change="toggleMeeting(meetingDetails, $event)"
        />此时段显示在月历</label
      >
      <p class="field-note">此设置影响该课程时段的所有周次，保留原有上课时间。</p>
      <p v-if="meetingDetails.meeting?.rescheduleID" class="info-note">
        该次课程已按原版调课记录调整。
      </p>
      <div class="dialog-actions">
        <span class="spacer" /><button @click="meetingDetails = null">关闭</button
        ><button class="primary" @click="store.navigate('timetable')">
          <CalendarDays :size="15" />打开课表
        </button>
      </div>
    </div></Modal
  >
</template>
<style scoped>
.month-controls {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 25px;
  border-bottom: 1px solid var(--border);
  flex-wrap: wrap;
}
.month-controls strong {
  font-size: 15px;
  min-width: 110px;
  text-align: center;
}
.month-controls input {
  width: 150px;
}
.month-layout {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: auto;
}
.month-board {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}
.month-weekdays {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  height: 35px;
  flex-shrink: 0;
  align-items: center;
  text-align: center;
  font-size: 12px;
  color: var(--muted);
  border-bottom: 1px solid var(--border);
}
.month-grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  grid-template-rows: repeat(6, minmax(80px, 1fr));
  flex: 1;
}
.month-day {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: flex-start;
  gap: 5px;
  min-width: 0;
  padding: 7px;
  border: 0;
  border-right: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  border-radius: 0;
  background: var(--surface);
  text-align: left;
  box-shadow: none;
}
.month-day:nth-child(7n) {
  border-right: 0;
}
.month-day:hover {
  background: var(--hover);
}
.month-day.selected {
  background: var(--accent-soft);
  box-shadow: inset 0 0 0 1px var(--accent);
}
.month-day.outside {
  opacity: 0.5;
}
.month-day-number {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  flex-shrink: 0;
}
.month-day.today .month-day-number {
  background: var(--accent);
  color: white;
  border-radius: 50%;
}
.month-event {
  display: flex;
  gap: 4px;
  align-items: center;
  width: 100%;
  font-size: 10px;
  line-height: 1.3;
}
.month-event svg {
  flex-shrink: 0;
}
.month-event > span:last-child {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.month-event-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  flex-shrink: 0;
}
.month-more {
  font-size: 10px;
  color: var(--muted);
}
.month-event.completed > span:last-child,
.month-agenda-event.completed strong {
  text-decoration: line-through;
  color: var(--muted);
}
.month-agenda {
  width: 220px;
  flex-shrink: 0;
  border-left: 1px solid var(--border);
  padding: 18px 14px;
  overflow: auto;
}
.month-agenda > header {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 22px;
  font-size: 13px;
}
.month-agenda-event {
  width: 100%;
  display: flex;
  align-items: flex-start;
  flex-direction: column;
  gap: 7px;
  text-align: left;
  margin: 0 0 10px;
  border-left: 3px solid var(--event-color);
  padding: 11px 10px;
}
.month-agenda-event strong {
  font-size: 12px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
@media (max-width: 1100px) {
  .month-agenda {
    width: 190px;
    padding: 14px 10px;
  }
  .month-controls .spacer,
  .month-controls > .muted {
    display: none;
  }
  .month-day {
    padding: 5px 4px;
  }
  .month-event {
    font-size: 9px;
  }
}
</style>
