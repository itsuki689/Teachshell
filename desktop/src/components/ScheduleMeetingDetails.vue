<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { CalendarDays, Palette, FolderOpen, Plus, SlidersHorizontal } from 'lucide-vue-next';
import type { TimetableOccurrence, TimetableTerm, TimetableMeeting } from '../../shared/timetable';
import { isScheduled, meetingTimeRange, shanghaiDayKey } from '../../shared/timetable';
import { useLibrary } from '../stores/library';
import Modal from './Modal.vue';
import ScheduleMeetingEditor from './ScheduleMeetingEditor.vue';
const props = defineProps<{
  termID: string;
  meetingID: string;
  occurrence?: TimetableOccurrence;
  selectedDate: string;
  title: string;
}>();
const emit = defineEmits<{
  close: [];
  changed: [day?: string];
  linkedPlan: [courseID: string, day: string];
  openWeek: [termID: string];
}>();
const store = useLibrary(),
  api = window.teachshelf,
  workspaceID = store.workspaceID;
const term = computed(() =>
  (store.state.timetableTerms as unknown as TimetableTerm[]).find((t) => t.id === props.termID),
);
const master = computed(() => term.value?.meetings.find((m) => m.id === props.meetingID));
const meeting = computed(() =>
  props.occurrence?.rescheduleID
    ? term.value?.reschedules.find((r) => r.id === props.occurrence?.rescheduleID)?.meeting
    : master.value,
);
const course = computed(() => store.state.courses.find((c) => c.id === meeting.value?.courseID));
const range = computed(() =>
  meeting.value && term.value
    ? meetingTimeRange(meeting.value, term.value.sectionTimes)
    : undefined,
);
const clock = (n: number) =>
  `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
const color = computed(
  () => meeting.value?.colorHex ?? course.value?.colorHex ?? store.state.accentColor,
);
const editing = ref<{ term: TimetableTerm; meeting: TimetableMeeting }>(),
  coloring = ref(false),
  colorDraft = ref(color.value);
const palette = [
  '#39786B',
  '#287D8E',
  '#3B72B8',
  '#5555A5',
  '#8058A1',
  '#AE567C',
  '#B2534D',
  '#AC633C',
  '#967326',
  '#6C7E3D',
  '#826452',
  '#596574',
];
const guard = () => ({ root: store.snapshot!.root, revision: store.snapshot!.revision });
watch(
  () => store.workspaceID,
  (id) => {
    if (id !== workspaceID) emit('close');
  },
);
async function saveColor(hex: string | null) {
  if (
    await store.change(
      () => api.setTimetableMeetingColor(props.termID, props.meetingID, hex, guard()),
      '课程颜色已更新',
    )
  )
    coloring.value = false;
}
async function cancel() {
  if (!props.occurrence) return;
  const expected = guard();
  if (
    !(await store.confirm(
      '本次停课？',
      `${meeting.value?.title} · ${shanghaiDayKey(props.occurrence.date)}，其他周次保留。`,
      '本次停课',
    ))
  )
    return;
  if (
    await store.change(
      () =>
        api.cancelTimetableClass(
          props.termID,
          props.meetingID,
          props.occurrence!.originalDate,
          '',
          expected,
        ),
      '已取消本次课程',
    )
  )
    emit('changed');
}
async function restoreMove() {
  const expected = guard();
  if (
    !props.occurrence?.rescheduleID ||
    !(await store.confirm(
      '还原这次调课？',
      `恢复至 ${shanghaiDayKey(props.occurrence.originalDate)} 的原始安排。`,
      '还原调课',
    ))
  )
    return;
  if (
    await store.change(
      () => api.restoreTimetableMove(props.termID, props.occurrence!.rescheduleID!, expected),
      '本次调课已还原',
    )
  )
    emit('changed', shanghaiDayKey(props.occurrence.originalDate));
}
async function materials() {
  if (course.value && (await store.navigate('course:' + course.value.id))) emit('close');
}
</script>
<template>
  <Modal :title="title" :width="560" @close="emit('close')">
    <div v-if="term && meeting" class="form-stack meeting-details">
      <div class="meeting-title">
        <CalendarDays :size="25" :style="{ color }" />
        <div>
          <h3>{{ meeting.title }}</h3>
          <small class="muted">{{ term.name }} · 固定课程</small>
        </div>
        <span class="spacer" /><button
          class="icon-button"
          aria-label="课程颜色"
          title="课程颜色"
          @click="
            colorDraft = color;
            coloring = true;
          "
        >
          <Palette :size="18" :style="{ color }" />
        </button>
      </div>
      <label class="check-label"
        ><input
          type="checkbox"
          :checked="master?.showInMonth ?? meeting.showInMonth ?? false"
          :disabled="!!store.busy"
          @change="
            store.change(
              () =>
                api.setTimetableMeetingMonthVisible(
                  termID,
                  meetingID,
                  ($event.target as HTMLInputElement).checked,
                  guard(),
                ),
              '课程月历显示已更新',
            )
          "
        />此时段显示在月历</label
      >
      <dl>
        <template v-if="occurrence"
          ><dt>上课日期</dt>
          <dd>{{ shanghaiDayKey(occurrence.date) }}</dd></template
        ><template v-if="occurrence?.rescheduleID"
          ><dt>原定日期</dt>
          <dd>{{ shanghaiDayKey(occurrence.originalDate) }} · 已调课</dd></template
        >
        <dt>上课时段</dt>
        <dd>
          {{
            isScheduled(meeting)
              ? `${['周一', '周二', '周三', '周四', '周五', '周六', '周日'][meeting.weekday! - 1]} · 第 ${meeting.startSection}–${meeting.startSection + meeting.sectionCount - 1} 节`
              : '自由时间 · 尚未安排'
          }}
        </dd>
        <template v-if="range"
          ><dt>钟点</dt>
          <dd>{{ clock(range.start) }} – {{ clock(range.end) }}</dd></template
        >
        <dt>周次</dt>
        <dd>{{ meeting.weeks.length ? meeting.weeks.join('、') + ' 周' : '未指定周次' }}</dd>
        <dt>地点</dt>
        <dd>{{ meeting.classroom || '未填写' }}</dd>
        <dt>教师</dt>
        <dd>{{ meeting.teacher || '未填写' }}</dd>
        <template v-if="meeting.courseCode"
          ><dt>课程编号</dt>
          <dd>{{ meeting.courseCode }}</dd></template
        ><template v-if="meeting.note"
          ><dt>备注</dt>
          <dd class="meeting-note">{{ meeting.note }}</dd></template
        >
      </dl>
      <p v-if="!occurrence" class="muted small">
        尚未对应具体上课日期。新建关联计划将使用所选日期 {{ selectedDate }}。
      </p>
      <div class="meeting-links">
        <button v-if="course" @click="materials"><FolderOpen :size="15" />查看课程资料</button
        ><button
          v-if="course"
          @click="
            emit(
              'linkedPlan',
              course.id,
              occurrence ? shanghaiDayKey(occurrence.date) : selectedDate,
            )
          "
        >
          <Plus :size="15" />新建关联计划
        </button>
      </div>
      <div class="dialog-actions">
        <button v-if="occurrence" class="danger" :disabled="!!store.busy" @click="cancel">
          本次停课</button
        ><button v-if="occurrence?.rescheduleID" :disabled="!!store.busy" @click="restoreMove">
          还原调课</button
        ><span class="spacer" /><button @click="emit('openWeek', termID)">打开课表</button
        ><button class="primary" :disabled="!!store.busy" @click="editing = { term, meeting }">
          <SlidersHorizontal :size="14" />调整安排
        </button>
      </div>
    </div>
    <p v-else class="muted">这个课程时段已变化或移除，请关闭后重新选择。</p>
  </Modal>
  <ScheduleMeetingEditor
    v-if="editing"
    :term="editing.term"
    :meeting="editing.meeting"
    :occurrence="occurrence"
    @close="editing = undefined"
    @saved="emit('changed', $event)"
  />
  <Modal v-if="coloring" title="课程颜色" :width="380" @close="coloring = false"
    ><div class="form-stack">
      <p class="muted small">颜色应用于这个时段及其调课记录。恢复后继承课程颜色。</p>
      <div class="meeting-palette">
        <button
          v-for="hex in palette"
          :key="hex"
          :aria-label="`颜色 ${hex}`"
          :aria-pressed="colorDraft.toUpperCase() === hex"
          :style="{ background: hex }"
          @click="colorDraft = hex"
        />
      </div>
      <label
        >自定义颜色<input v-model="colorDraft" aria-label="自定义课程颜色" type="color"
      /></label>
      <div class="dialog-actions">
        <button :disabled="!!store.busy" @click="saveColor(null)">恢复课程颜色</button
        ><span class="spacer" /><button
          class="primary"
          :disabled="!!store.busy"
          @click="saveColor(colorDraft)"
        >
          应用颜色
        </button>
      </div>
    </div></Modal
  >
</template>
<style scoped>
.meeting-title {
  display: flex;
  align-items: center;
  gap: 10px;
}
.meeting-title h3 {
  margin: 0 0 6px;
  overflow-wrap: anywhere;
}
.meeting-details dl {
  display: grid;
  grid-template-columns: 74px minmax(0, 1fr);
  gap: 11px 12px;
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
}
.meeting-details dt {
  color: var(--muted);
}
.meeting-details dd {
  margin: 0;
  overflow-wrap: anywhere;
}
.meeting-note {
  white-space: pre-wrap;
}
.meeting-links,
.meeting-palette {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.meeting-palette button {
  width: 30px;
  height: 30px;
  padding: 0;
  border-radius: 50%;
}
.meeting-palette button[aria-pressed='true'] {
  outline: 2px solid var(--text);
  outline-offset: 3px;
}
</style>
