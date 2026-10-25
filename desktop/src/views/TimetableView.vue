<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import {
  ArrowLeft,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Download,
  Globe,
  Settings2,
} from 'lucide-vue-next';
import { swiftNow } from '../../shared/model';
import {
  timetableDate,
  timetableOccurrences,
  timetableWeek,
  shanghaiDayKey,
  meetingTimeRange,
  isScheduled,
} from '../../shared/timetable';
import type { TimetableTerm, TimetableOccurrence } from '../../shared/timetable';
import { useLibrary } from '../stores/library';
import Modal from '../components/Modal.vue';
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
  if (
    await store.confirm(
      '取消这次课程？',
      `${item.meeting.title} · ${shanghaiDayKey(item.date)}。仅取消本次，可在下方恢复。`,
      '取消本次',
    )
  )
    await store.change(
      () => api.cancelTimetableClass(term.value!.id, item.meeting.id, item.originalDate),
      '本次课程已取消',
    );
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
  const minutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
  const value = await store.change(
    () =>
      api.rescheduleTimetableClass(t.id, item.meeting.id, item.originalDate, {
        date: moveForm.date + 'T00:00:00+08:00',
        startSection: moveForm.startSection,
        sectionCount: moveForm.sectionCount,
        classroom: moveForm.classroom,
        ...(moveForm.customTime
          ? { startMinute: minutes(moveForm.start), endMinute: minutes(moveForm.end) }
          : {}),
      }),
    '本次课程已调整',
  );
  if (value) {
    week.value = timetableWeek(t, moveForm.date + 'T00:00:00+08:00') ?? week.value;
    moving.value = null;
  }
}
async function restoreMove(id: string) {
  const t = term.value;
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
    const value = await store.change(() => api.restoreTimetableMove(t.id, id), '本次调课已还原');
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
          <option v-for="t in terms" :key="t.id" :value="t.id">{{ t.name }}</option></select
        ><span class="spacer" /><button
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
      <div class="timetable-scroll">
        <div v-if="term.weekOneMonday == null" class="empty-state compact">
          <CalendarDays :size="38" />
          <h2>设置第一周的周一日期</h2>
          <p>已有 {{ term.meetings.length }} 个时段，设置起始日期后显示到具体日期。</p>
          <button class="primary" @click="openSettings">设置学期</button>
        </div>
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
