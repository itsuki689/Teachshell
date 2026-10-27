<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import type { TimetableTerm, TimetableMeeting, TimetableOccurrence } from '../../shared/timetable';
import { meetingTimeRange, shanghaiDayKey, timetableWeek } from '../../shared/timetable';
import Modal from './Modal.vue';
import { useLibrary } from '../stores/library';
import { useUnsavedCloseGuard } from '../composables/useUnsavedCloseGuard';
const props = defineProps<{
  term: TimetableTerm;
  meeting: TimetableMeeting;
  occurrence?: TimetableOccurrence;
}>();
const emit = defineEmits<{ close: []; saved: [day?: string] }>();
const store = useLibrary(),
  api = window.teachshelf;
const guard = { root: store.snapshot!.root, revision: store.snapshot!.revision };
const master = props.term.meetings.find((m) => m.id === props.meeting.id);
const scope = ref<'occurrence' | 'weekly'>(props.occurrence ? 'occurrence' : 'weekly');
const clock = (n: number) =>
  `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
const range = meetingTimeRange(props.meeting, props.term.sectionTimes);
const once = reactive({
  date: props.occurrence ? shanghaiDayKey(props.occurrence.date) : '',
  startSection: props.meeting.startSection || 1,
  sectionCount: props.meeting.sectionCount || 1,
  classroom: props.meeting.classroom,
  customTime: props.meeting.startMinuteOverride != null,
  start: clock(range?.start ?? 480),
  end: clock(range?.end ?? 530),
});
const base = master ?? props.meeting;
const weekly = reactive({
  weekday: base.weekday || 1,
  startSection: base.startSection || 1,
  sectionCount: base.sectionCount || 1,
  classroom: base.classroom,
  weeks: base.weeks.length
    ? [...base.weeks]
    : Array.from({ length: props.term.weekCount }, (_, i) => i + 1),
});
const form = computed(() => (scope.value === 'weekly' ? weekly : once));
const fingerprint = () => JSON.stringify({ once, weekly });
const initial = fingerprint();
const dirty = () => fingerprint() !== initial;
useUnsavedCloseGuard(dirty);
async function close() {
  if (store.busy) return;
  if (
    !dirty() ||
    (await store.confirm('放弃课程安排修改？', '尚未保存的日期、节次与周次将丢弃。', '放弃修改'))
  )
    emit('close');
}
const minutes = (value: string) =>
  /^\d{2}:\d{2}$/.test(value) ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3)) : NaN;
const validation = computed(() => {
  const value = form.value;
  if (
    ![value.startSection, value.sectionCount].every(Number.isInteger) ||
    value.startSection < 1 ||
    value.sectionCount < 1 ||
    value.startSection + value.sectionCount - 1 > 30
  )
    return '课程节次须在第 1–30 节内。';
  if (scope.value === 'weekly')
    return !master
      ? '原始时段已不存在，无法修改每周安排。'
      : !weekly.weeks.length
        ? '至少选择一个上课周次。'
        : '';
  if (!once.date || timetableWeek(props.term, once.date + 'T00:00:00+08:00') == null)
    return '目标日期须在已设置的学期范围内。';
  if (
    once.customTime &&
    (!Number.isFinite(minutes(once.start)) ||
      !Number.isFinite(minutes(once.end)) ||
      minutes(once.start) < 0 ||
      minutes(once.end) > 1440 ||
      minutes(once.start) >= minutes(once.end))
  )
    return '请填写有效的开始和结束时间。';
  return '';
});
async function save() {
  if (validation.value || store.busy) return;
  const result = await store.change(
    () =>
      scope.value === 'weekly'
        ? api.updateTimetableMeeting(
            props.term.id,
            props.meeting.id,
            { ...weekly, weeks: [...weekly.weeks].sort((a, b) => a - b) },
            guard,
          )
        : api.rescheduleTimetableClass(
            props.term.id,
            props.meeting.id,
            props.occurrence!.originalDate,
            {
              date: once.date + 'T00:00:00+08:00',
              startSection: once.startSection,
              sectionCount: once.sectionCount,
              classroom: once.classroom,
              ...(once.customTime
                ? { startMinute: minutes(once.start), endMinute: minutes(once.end) }
                : {}),
            },
            guard,
          ),
    scope.value === 'weekly'
      ? '每周课程安排已更新，可撤销上次课表修改'
      : '本次课程已调整，可撤销上次课表修改',
  );
  if (result) emit('saved', scope.value === 'occurrence' ? once.date : undefined);
}
async function remove() {
  if (store.busy) return;
  const weeklyScope = scope.value === 'weekly';
  if (
    !(await store.confirm(
      weeklyScope ? '移除每周时段？' : '本次停课？',
      weeklyScope
        ? '移除此时段及其调课记录，保留课程、资料、计划和停课历史。可使用“撤销上次课表修改”恢复。'
        : '仅取消这一次上课，其他周次保留。',
      weeklyScope ? '移除时段' : '本次停课',
    ))
  )
    return;
  const result = await store.change(
    () =>
      weeklyScope
        ? api.deleteTimetableMeeting(props.term.id, props.meeting.id, guard)
        : api.cancelTimetableClass(
            props.term.id,
            props.meeting.id,
            props.occurrence!.originalDate,
            '',
            guard,
          ),
    '课程安排已移除，可撤销上次课表修改',
  );
  if (result) emit('saved');
}
</script>
<template>
  <Modal title="调整课程安排" :width="560" @close="close">
    <form class="form-stack meeting-editor" @submit.prevent="save">
      <h3>{{ meeting.title }}</h3>
      <div class="segmented" role="group" aria-label="课程调整范围">
        <button
          v-if="occurrence"
          type="button"
          :class="{ active: scope === 'occurrence' }"
          :aria-pressed="scope === 'occurrence'"
          @click="scope = 'occurrence'"
        >
          仅这次课
        </button>
        <button
          v-if="master"
          type="button"
          :class="{ active: scope === 'weekly' }"
          :aria-pressed="scope === 'weekly'"
          @click="scope = 'weekly'"
        >
          每周时段
        </button>
      </div>
      <p class="muted small">
        {{
          scope === 'weekly'
            ? '调整这个时段的上课星期、节次与周次，保留单次调课和停课记录。'
            : '只修改本次课程；其他周次保留原始安排。'
        }}
      </p>
      <label v-if="scope === 'occurrence'"
        >上课日期<input v-model="once.date" type="date" aria-label="上课日期"
      /></label>
      <label v-else
        >上课星期<select v-choice v-model.number="weekly.weekday" aria-label="上课星期">
          <option
            v-for="(day, i) in ['周一', '周二', '周三', '周四', '周五', '周六', '周日']"
            :key="day"
            :value="i + 1"
          >
            {{ day }}
          </option>
        </select></label
      >
      <div class="form-row">
        <label
          >起始节次<input
            v-model.number="form.startSection"
            type="number"
            min="1"
            max="30"
            aria-label="起始节次" /></label
        ><label
          >连续节数<input
            v-model.number="form.sectionCount"
            type="number"
            min="1"
            max="30"
            aria-label="连续节数"
        /></label>
      </div>
      <label
        >上课地点<input v-model="form.classroom" aria-label="上课地点" maxlength="10000"
      /></label>
      <template v-if="scope === 'weekly'">
        <div class="week-choice-heading">
          <strong>上课周次</strong><span class="spacer" /><button
            type="button"
            @click="weekly.weeks = Array.from({ length: term.weekCount }, (_, i) => i + 1)"
          >
            全选</button
          ><button type="button" @click="weekly.weeks = []">清空</button>
        </div>
        <div class="meeting-weeks" role="group" aria-label="上课周次">
          <label
            v-for="n in term.weekCount"
            :key="n"
            :class="{ selected: weekly.weeks.includes(n) }"
            ><input
              type="checkbox"
              v-model="weekly.weeks"
              :value="n"
              :aria-label="`第 ${n} 周`"
            /><span>{{ n }}</span></label
          >
        </div>
        <p v-if="master?.startMinuteOverride != null" class="muted small">
          此时段已有自定义钟点；修改周次与节次会保留钟点设置。
        </p>
      </template>
      <template v-else
        ><label class="check-label"
          ><input type="checkbox" v-model="once.customTime" />自定义钟点</label
        >
        <div v-if="once.customTime" class="form-row">
          <label>开始时间<input v-model="once.start" type="time" aria-label="课程开始时间" /></label
          ><label
            >结束时间<input
              v-model="once.end"
              placeholder="24:00"
              pattern="(?:[01][0-9]|2[0-3]):[0-5][0-9]|24:00"
              aria-label="课程结束时间"
          /></label></div
      ></template>
      <p v-if="validation" role="status" class="warning">{{ validation }}</p>
      <div class="dialog-actions">
        <button type="button" class="danger" :disabled="!!store.busy" @click="remove">
          {{ scope === 'weekly' ? '移除时段' : '本次停课' }}</button
        ><span class="spacer" /><button type="button" @click="close">取消</button
        ><button class="primary" type="submit" :disabled="!!validation || !!store.busy">
          保存安排
        </button>
      </div>
    </form>
  </Modal>
</template>
<style scoped>
.meeting-editor h3 {
  margin: 0;
  overflow-wrap: anywhere;
}
.week-choice-heading {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}
.week-choice-heading button {
  padding: 4px 8px;
  font-size: 12px;
}
.meeting-weeks {
  display: grid;
  grid-template-columns: repeat(8, minmax(0, 1fr));
  gap: 6px;
}
.meeting-weeks label {
  position: relative;
  display: grid;
  place-items: center;
  border: 1px solid var(--border);
  border-radius: 7px;
  min-height: 32px;
  cursor: pointer;
}
.meeting-weeks input {
  position: absolute;
  opacity: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  cursor: pointer;
}
.meeting-weeks label:focus-within {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.meeting-weeks .selected {
  background: var(--accent);
  color: white;
  border-color: var(--accent);
}
</style>
