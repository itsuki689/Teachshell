<script setup lang="ts">
const api = window.teachshelf;
import { computed, reactive, ref, toRaw, watch } from 'vue';
import { dateMs, SWIFT_EPOCH_MS, swiftNow } from '../../shared/model';
import type { StudyTask, SwiftDate } from '../../shared/model';
import { addPlanDays, planSnapshot, readPlan } from '../../shared/plans';
import type { PlanEditScope, PlanOccurrence, PlanRepeatRule } from '../../shared/plans';
import { shanghaiDayKey } from '../../shared/timetable';
import Modal from './Modal.vue';
import { useLibrary } from '../stores/library';
const props = defineProps<{ task?: StudyTask; occurrence?: PlanOccurrence }>(),
  emit = defineEmits<{ close: [] }>(),
  store = useLibrary();
const scope = ref<PlanEditScope>(
  props.occurrence && props.task?.repeatRule ? 'thisOccurrence' : 'all',
);
const currentParent = computed(
  () => store.state.tasks.find((t) => t.id === props.task?.id) ?? props.task,
);
function local(value?: SwiftDate) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
    .format(new Date(value === undefined ? Date.now() : dateMs(value)))
    .replace(' ', 'T');
}
function makeForm(task?: StudyTask) {
  const source = task ? readPlan(toRaw(task)) : undefined,
    rule = source?.repeatRule;
  return {
    title: source?.title ?? '',
    content: source?.content ?? '',
    kind: source?.kind ?? '任务',
    courseID: source?.courseID ?? store.courseID ?? '',
    materialIDs: [...(source?.materialIDs ?? [])],
    startsAt: local(source?.startsAt),
    endsAt: local(
      source?.endsAt ??
        (source ? (dateMs(source.startsAt) - SWIFT_EPOCH_MS) / 1000 + 3600 : swiftNow() + 3600),
    ),
    hasEnd: source?.endsAt != null,
    hasExecutionTime: source?.hasExecutionTime ?? true,
    hasDeadline: source?.deadline != null,
    deadline: local(source?.deadline),
    isAllDay: source?.isAllDay ?? false,
    deadlineIsAllDay: source?.deadlineIsAllDay ?? false,
    showOnCalendar: source?.showOnCalendar ?? true,
    showInMonth: source?.showInMonth ?? true,
    origin: source?.origin ?? 'activity',
    location: source?.location ?? '',
    completionRequired: source?.completionRequired ?? true,
    repeats: !!rule,
    frequency: rule?.frequency ?? 'weekly',
    interval: rule?.interval ?? 1,
    repeatHasEnd: rule?.until != null,
    repeatEnd: shanghaiDayKey(rule?.until ?? addPlanDays(source?.startsAt ?? swiftNow(), 90)),
  };
}
function effective() {
  const task = currentParent.value;
  if (!task) return undefined;
  return scope.value === 'all' || !props.occurrence
    ? task
    : planSnapshot(toRaw(task), props.occurrence.originalDate);
}
const form = reactive(makeForm(effective()));
function seconds(value: string) {
  const ms = Date.parse(value.length === 10 ? value + 'T00:00:00+08:00' : value + ':00+08:00');
  if (!Number.isFinite(ms)) throw new Error('请输入有效的北京时间');
  return (ms - SWIFT_EPOCH_MS) / 1000;
}
function values() {
  return {
    title: form.title,
    content: form.content,
    kind: form.kind,
    courseID: form.courseID || null,
    materialIDs: [...form.materialIDs],
    startsAt: seconds(form.startsAt),
    endsAt: form.hasEnd ? seconds(form.endsAt) : null,
    hasExecutionTime: form.hasExecutionTime,
    deadline: form.hasDeadline ? seconds(form.deadline) : null,
    isAllDay: form.isAllDay,
    deadlineIsAllDay: form.deadlineIsAllDay,
    showOnCalendar: form.showOnCalendar,
    location: form.location,
    completionRequired: form.completionRequired,
    origin: form.origin,
    showInMonth: form.showInMonth,
    repeatRule: form.repeats
      ? {
          frequency: form.frequency,
          interval: Number(form.interval),
          ...(form.repeatHasEnd ? { until: seconds(form.repeatEnd) } : {}),
        }
      : null,
  };
}
const initial = ref(values());
const expectedRevision = ref(store.snapshot?.revision);
watch(scope, () => {
  Object.assign(form, makeForm(effective()));
  initial.value = values();
  expectedRevision.value = store.snapshot?.revision;
});
const single = computed(
  () => !!props.occurrence && !!props.task?.repeatRule && scope.value === 'thisOccurrence',
);
const materials = computed(() =>
  store.state.materials.filter(
    (m) => !form.courseID || m.courseID === form.courseID || form.materialIDs.includes(m.id),
  ),
);
const scopeHint = computed(
  () =>
    ({
      all: '修改整组计划；已设置的单次例外会按实际覆盖字段保留。',
      thisOccurrence: '只调整原始发生日对应的本次安排，不改变其他发生项。',
      thisAndFuture: '从本次开始拆分为新计划；此前发生项保留。',
    })[scope.value],
);
const validation = computed(() => {
  try {
    if (currentParent.value?.archivedAt != null) return '归档计划为只读，请先恢复归档。';
    if (form.hasExecutionTime && form.hasEnd && seconds(form.endsAt) < seconds(form.startsAt))
      return '结束时间不能早于开始时间。';
    if (form.repeats && !form.hasExecutionTime && !form.hasDeadline)
      return '重复计划需要执行时间或截止时间。';
    if (
      form.repeats &&
      !single.value &&
      form.repeatHasEnd &&
      form.repeatEnd < (form.hasExecutionTime ? form.startsAt : form.deadline).slice(0, 10)
    )
      return '重复结束日期不能早于首次发生日。';
    if (
      form.repeats &&
      (!Number.isInteger(Number(form.interval)) ||
        Number(form.interval) < 1 ||
        Number(form.interval) > 366)
    )
      return '重复间隔应为 1–366。';
    return '';
  } catch {
    return '请输入完整的日期和时间。';
  }
});
async function save() {
  if (validation.value) {
    store.error = validation.value;
    return;
  }
  const next = values();
  const payload: Record<string, unknown> = {
    ...(props.task ? { id: props.task.id } : {}),
    title: next.title,
  };
  for (const [key, value] of Object.entries(next)) {
    if (single.value && ['repeatRule', 'origin', 'showOnCalendar'].includes(key)) continue;
    if (
      !props.task ||
      JSON.stringify(value) !== JSON.stringify(initial.value[key as keyof typeof next])
    )
      payload[key] = value;
  }
  const result = await store.change(
    () =>
      api.savePlan(
        payload as Parameters<typeof api.savePlan>[0],
        scope.value,
        props.occurrence?.originalDate,
        props.task ? expectedRevision.value : undefined,
      ),
    '计划已保存',
  );
  if (result) emit('close');
}
</script>
<template>
  <Modal :title="task ? '编辑计划' : '新建计划'" @close="emit('close')"
    ><form class="form-stack" @submit.prevent="save">
      <div v-if="occurrence && task?.repeatRule" class="scope-editor">
        <label
          >修改范围<select v-model="scope" aria-label="修改范围">
            <option value="thisOccurrence">仅本次</option>
            <option value="thisAndFuture">本次及以后</option>
            <option value="all">整组计划</option>
          </select></label
        >
        <p class="field-note">{{ scopeHint }}</p>
        <p class="field-note">
          原始发生日：{{ local(occurrence.originalDate).replace('T', ' ') }}（北京时间）
        </p>
      </div>
      <label>计划名称<input v-model="form.title" required maxlength="500" /></label
      ><label>内容<textarea v-model="form.content" rows="3" /></label>
      <div class="form-row">
        <label
          >类型<input v-model="form.kind" list="plan-kinds" required /><datalist id="plan-kinds">
            <option>任务</option>
            <option>作业</option>
            <option>考试</option>
            <option>活动</option>
            <option>复习</option>
          </datalist></label
        ><label
          >课程<select aria-label="课程" v-model="form.courseID">
            <option value="">不关联课程</option>
            <option v-for="c in store.state.courses" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select></label
        >
      </div>
      <label
        >计划类型<select v-model="form.origin" aria-label="计划类型" :disabled="single">
          <option value="activity">活动计划</option>
          <option value="fixed">固定计划</option>
        </select></label
      >
      <div class="form-row">
        <label class="check-label"
          ><input type="checkbox" v-model="form.hasExecutionTime" />安排执行时间</label
        ><label class="check-label"><input type="checkbox" v-model="form.isAllDay" />全天</label>
      </div>
      <label v-if="form.hasExecutionTime"
        >开始时间<input type="datetime-local" v-model="form.startsAt" required /><small
          class="field-note"
          >所有计划时间按北京时间保存和展示。</small
        ></label
      ><label v-if="form.hasExecutionTime" class="check-label"
        ><input type="checkbox" v-model="form.hasEnd" />设置结束时间</label
      ><label v-if="form.hasExecutionTime && form.hasEnd"
        >结束时间<input type="datetime-local" v-model="form.endsAt" required /></label
      ><label class="check-label"
        ><input type="checkbox" v-model="form.hasDeadline" />设置截止时间</label
      >
      <div v-if="form.hasDeadline" class="form-row">
        <label>截止时间<input type="datetime-local" v-model="form.deadline" required /></label
        ><label class="check-label"
          ><input type="checkbox" v-model="form.deadlineIsAllDay" />截止日全天</label
        >
      </div>
      <label>地点<input v-model="form.location" /></label>
      <div class="repeat-editor">
        <label class="check-label"
          ><input type="checkbox" v-model="form.repeats" :disabled="single" />重复安排</label
        ><template v-if="form.repeats"
          ><div class="form-row">
            <label
              >重复频率<select v-model="form.frequency" aria-label="重复频率" :disabled="single">
                <option value="daily">每天</option>
                <option value="weekly">每周</option>
                <option value="monthly">每月</option>
              </select></label
            ><label
              >重复间隔<input
                type="number"
                min="1"
                max="366"
                step="1"
                v-model.number="form.interval"
                :disabled="single"
                required
            /></label>
          </div>
          <label class="check-label"
            ><input
              type="checkbox"
              v-model="form.repeatHasEnd"
              :disabled="single"
            />设置重复结束日期</label
          ><label v-if="form.repeatHasEnd"
            >重复至（含当天）<input
              type="date"
              v-model="form.repeatEnd"
              :disabled="single"
              required
          /></label>
          <p v-if="single" class="field-note">
            修改重复规则需选择“本次及以后”或“整组计划”。
          </p></template
        >
      </div>
      <div class="form-row">
        <label class="check-label"
          ><input type="checkbox" v-model="form.completionRequired" />需要标记完成</label
        ><label class="check-label"
          ><input
            type="checkbox"
            v-model="form.showOnCalendar"
            :disabled="single"
          />显示在日历</label
        >
      </div>
      <label class="check-label"
        ><input type="checkbox" v-model="form.showInMonth" />执行安排显示在月历</label
      ><label v-if="materials.length"
        >关联资料<select
          v-model="form.materialIDs"
          multiple
          class="material-select"
          aria-label="关联资料"
        >
          <option v-for="m in materials" :key="m.id" :value="m.id">{{ m.title }}</option></select
        ><small class="field-note">按住 Command / Ctrl 可选择多份资料。</small></label
      >
      <p v-if="validation" class="warning-banner">{{ validation }}</p>
      <div class="dialog-actions">
        <span class="spacer" /><button type="button" @click="emit('close')">取消</button
        ><button class="primary" :disabled="!form.title.trim() || !!store.busy || !!validation">
          保存
        </button>
      </div>
    </form></Modal
  >
</template>
