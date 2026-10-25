<script setup lang="ts">
const api = window.teachshelf;
import { computed, ref, toRaw, watch } from 'vue';
import {
  Archive,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  History,
  List,
  Plus,
  Repeat2,
  RotateCcw,
  Search,
  Trash2,
  XCircle,
} from 'lucide-vue-next';
import { dateMs, swiftNow } from '../../shared/model';
import type { StudyTask, SwiftDate } from '../../shared/model';
import {
  addPlanDays,
  planAnchor,
  planEvents,
  planSnapshot,
  readPlan,
  swiftSeconds,
} from '../../shared/plans';
import type { PlanEditScope, PlanOccurrence, PlanStatus } from '../../shared/plans';
import { shanghaiDayKey } from '../../shared/timetable';
import { useLibrary } from '../stores/library';
import { useWorkspaceUI } from '../stores/workspace-ui';
import { storeToRefs } from 'pinia';
import TaskEditor from '../components/TaskEditor.vue';
import PlanMonthCalendar from '../components/PlanMonthCalendar.vue';
import Modal from '../components/Modal.vue';
import { matchesPlanStatus, planVariants } from '../composables/plan-filter';
import type { PlanFilter } from '../composables/plan-filter';
const store = useLibrary(),
  filter = ref<PlanFilter>(store.route === 'pending' ? 'pending' : 'active'),
  query = ref(''),
  courseID = ref('');
const ui = useWorkspaceUI();
const { planMode: mode, day } = storeToRefs(ui);
const editing = ref<{ task?: StudyTask; occurrence?: PlanOccurrence } | null>(null),
  historyID = ref<string | null>(null);
type Action = PlanStatus | 'delete';
interface Row {
  key: string;
  task: StudyTask;
  occurrence?: PlanOccurrence;
}
const operation = ref<{ task: StudyTask; occurrence?: PlanOccurrence; action: Action } | null>(
    null,
  ),
  operationScope = ref<PlanEditScope>('all');
const plans = computed(() => store.state.tasks);
const listOnly = computed(() => ['unscheduled', 'cancelled', 'archived'].includes(filter.value));
watch(
  () => store.route,
  (route) => {
    filter.value = route === 'pending' ? 'pending' : 'active';
  },
);
watch(listOnly, (value) => {
  if (value) mode.value = 'list';
});
function matches(task: StudyTask) {
  return (
    matchesPlanStatus(task, filter.value) &&
    (!courseID.value || task.courseID === courseID.value) &&
    [
      task.title,
      task.content,
      task.kind,
      task.location,
      store.state.courses.find((c) => c.id === task.courseID)?.name,
    ]
      .filter(Boolean)
      .join(' ')
      .toLocaleLowerCase()
      .includes(query.value.toLocaleLowerCase())
  );
}
function hasMatchingException(task: StudyTask) {
  return !matches(task) && planVariants(toRaw(task)).some(matches);
}
const rows = computed<Row[]>(() => {
  if (mode.value === 'agenda')
    return day.value
      ? planEvents(
          day.value + 'T00:00:00+08:00',
          plans.value.map((t) => toRaw(t)),
        )
          .filter((e) => matches(e.task))
          .map((e) => ({ key: e.id, task: e.task, occurrence: e }))
      : [];
  const due = (task: StudyTask) =>
    task.deadline != null
      ? dateMs(task.deadline)
      : (task.hasExecutionTime ?? task.deadline == null)
        ? dateMs(task.startsAt)
        : Number.POSITIVE_INFINITY;
  return plans.value
    .filter((task) => planVariants(toRaw(task)).some(matches))
    .sort(
      (a, b) =>
        Number(a.cancelledAt != null) - Number(b.cancelledAt != null) ||
        Number(a.completedAt != null) - Number(b.completedAt != null) ||
        (due(a) === due(b) ? 0 : due(a) - due(b)) ||
        a.title.localeCompare(b.title, 'zh-CN', { numeric: true }),
    )
    .map((task) => ({ key: task.id, task }));
});
const historyPlan = computed(() => {
  const task = store.state.tasks.find((t) => t.id === historyID.value);
  return task ? readPlan(toRaw(task)) : undefined;
});
const exceptions = computed(() => {
  const plan = historyPlan.value;
  return plan
    ? plan.exceptions
        .map((change) => ({ change, occurrence: exceptionEvent(plan, change.originalDate) }))
        .sort((a, b) => a.occurrence.originalDate - b.occurrence.originalDate)
    : [];
});
function label(value: SwiftDate) {
  return new Date(dateMs(value)).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
}
function repeatLabel(task: StudyTask) {
  const r = task.repeatRule;
  return r
    ? `每 ${r.interval} ${r.frequency === 'daily' ? '天' : r.frequency === 'weekly' ? '周' : '月'}`
    : '';
}
function base(task: StudyTask) {
  return store.state.tasks.find((t) => t.id === task.id) ?? task;
}
function edit(row: Row) {
  editing.value = { task: base(row.task), occurrence: row.occurrence };
}
function shiftDay(offset: number) {
  day.value = shanghaiDayKey(addPlanDays(day.value + 'T00:00:00+08:00', offset));
}
function exceptionEvent(task: StudyTask, original: SwiftDate): PlanOccurrence {
  const effective = planSnapshot(toRaw(task), original),
    isDeadline = !effective.hasExecutionTime;
  return {
    id: task.id + '-' + swiftSeconds(original),
    task: effective,
    originalDate: swiftSeconds(original),
    date: planAnchor(effective),
    endDate: effective.endsAt == null ? undefined : swiftSeconds(effective.endsAt),
    isDeadline,
    isAllDay: isDeadline ? effective.deadlineIsAllDay : effective.isAllDay,
    isFixed: isDeadline || effective.origin === 'fixed',
    origin: isDeadline ? 'fixed' : effective.origin,
  };
}
const actionNames: Record<Action, string> = {
  complete: '完成计划',
  reopen: '恢复待完成',
  cancel: '取消计划',
  restore: '恢复计划',
  archive: '归档计划',
  unarchive: '恢复归档计划',
  resetOccurrence: '还原本次',
  delete: '删除计划',
};
const actionButtons: Record<Action, string> = {
  complete: '确认完成',
  reopen: '恢复待完成',
  cancel: '确认取消',
  restore: '恢复计划',
  archive: '确认归档',
  unarchive: '恢复归档',
  resetOccurrence: '还原本次变更',
  delete: '删除计划',
};
const scopes = computed<PlanEditScope[]>(() => {
  const op = operation.value;
  if (!op) return ['all'];
  if (op.action === 'resetOccurrence') return ['thisOccurrence'];
  if (op.action === 'archive' || op.action === 'unarchive' || !op.task.repeatRule || !op.occurrence)
    return ['all'];
  return op.action === 'complete' || op.action === 'reopen'
    ? ['thisOccurrence', 'all']
    : ['thisOccurrence', 'thisAndFuture', 'all'];
});
const scopeNames: Record<PlanEditScope, string> = {
  all: '整组计划',
  thisOccurrence: '仅本次',
  thisAndFuture: '本次及以后',
};
async function status(row: Row, action: Action) {
  const task = base(row.task);
  if (!task.repeatRule && ['complete', 'reopen'].includes(action)) {
    await store.change(
      () => api.setPlanStatus(task.id, action as PlanStatus, 'all'),
      action === 'complete' ? '计划已完成' : '计划已恢复为待完成',
    );
    return;
  }
  operation.value = { task, occurrence: row.occurrence, action };
  operationScope.value =
    action === 'resetOccurrence' ||
    (row.occurrence && task.repeatRule && !['archive', 'unarchive'].includes(action))
      ? 'thisOccurrence'
      : 'all';
}
async function applyOperation() {
  const op = operation.value;
  if (!op) return;
  const scope = operationScope.value;
  const value = await store.change(
    () =>
      op.action === 'delete'
        ? api.deletePlan(op.task.id, scope, op.occurrence?.originalDate)
        : api.setPlanStatus(op.task.id, op.action, scope, op.occurrence?.originalDate),
    actionNames[op.action] + '已完成',
  );
  if (value) operation.value = null;
}
function editException(occurrence: PlanOccurrence) {
  historyID.value = null;
  editing.value = { task: base(occurrence.task), occurrence };
}
defineExpose({
  create: () => {
    editing.value = {};
  },
});
</script>
<template>
  <section class="workspace">
    <header class="workspace-header">
      <div class="heading-block">
        <div class="heading-line">
          <h1>{{ store.title }}</h1>
          <span v-if="mode !== 'month'" class="subtle-count">{{ rows.length }} 项</span>
        </div>
        <p>安排学习与作业，按北京时间管理执行与截止时间。</p>
      </div>
      <div class="toolbar-controls">
        <div class="segmented">
          <button
            :class="{ active: mode === 'list' }"
            aria-label="计划列表视图"
            @click="mode = 'list'"
          >
            <List :size="16" />列表</button
          ><button
            :class="{ active: mode === 'agenda' }"
            aria-label="计划日程视图"
            :disabled="listOnly"
            :title="listOnly ? '此状态请在列表中查看' : ''"
            @click="mode = 'agenda'"
          >
            <CalendarDays :size="16" />日程</button
          ><button
            :class="{ active: mode === 'month' }"
            aria-label="计划月历视图"
            :disabled="listOnly"
            :title="listOnly ? '此状态请在列表中查看' : ''"
            @click="mode = 'month'"
          >
            <CalendarDays :size="16" />月历
          </button>
        </div>
        <button @click="store.navigate('timetable')"><CalendarDays :size="16" />查看课表</button
        ><button class="primary" @click="editing = {}"><Plus :size="16" />新建计划</button>
      </div>
    </header>
    <div class="filter-bar">
      <label class="search-field"
        ><Search :size="16" /><input
          v-model="query"
          placeholder="搜索计划名称与内容"
          aria-label="搜索计划" /></label
      ><select v-model="courseID" aria-label="计划课程筛选">
        <option value="">全部课程</option>
        <option v-for="c in store.state.courses" :key="c.id" :value="c.id">
          {{ c.name }}
        </option></select
      ><select v-model="filter" aria-label="计划状态筛选">
        <option value="active">当前计划</option>
        <option value="unscheduled">待安排</option>
        <option value="pending">未完成</option>
        <option value="completed">已完成</option>
        <option value="cancelled">已取消</option>
        <option value="archived">已归档</option>
        <option value="all">全部计划</option>
      </select>
    </div>
    <div v-if="mode === 'agenda'" class="agenda-controls">
      <button class="icon-button" aria-label="上一天" @click="shiftDay(-1)">
        <ChevronLeft :size="17" /></button
      ><input v-model="day" type="date" aria-label="日程日期" required /><button
        class="icon-button"
        aria-label="下一天"
        @click="shiftDay(1)"
      >
        <ChevronRight :size="17" /></button
      ><button @click="day = shanghaiDayKey(swiftNow())">今天</button><span class="spacer" /><span
        class="small muted"
        >重复安排按实际发生项展示，执行与截止各自列出。</span
      >
    </div>
    <PlanMonthCalendar
      v-if="mode === 'month'"
      v-model:day="day"
      :plans="plans"
      :query="query"
      :course-id="courseID"
      :pending="filter === 'pending'"
      :status-filter="filter"
      :include-courses="filter === 'active' || filter === 'all'"
      @edit="(event) => edit({ key: event.id, task: event.task, occurrence: event })"
    />
    <div v-else class="plans-scroll">
      <div v-if="!rows.length" class="empty-state">
        <CalendarDays :size="43" />
        <h2>{{ mode === 'agenda' ? '这一天没有符合条件的安排' : '还没有符合条件的计划' }}</h2>
        <p>
          {{
            mode === 'agenda'
              ? '已取消和已归档的安排不显示。可在列表的临时变更中恢复。'
              : '创建任务，关联课程、资料和截止时间。'
          }}
        </p>
        <button class="primary" @click="editing = {}">新建计划</button>
      </div>
      <div
        v-for="row in rows"
        :key="row.key"
        class="plan-row"
        :class="{
          completed: row.task.completedAt != null,
          cancelled: row.task.cancelledAt != null,
        }"
        :data-plan-id="row.task.id"
        :data-original-date="row.occurrence?.originalDate"
      >
        <button
          class="complete-button"
          :class="{ checked: row.task.completedAt != null }"
          :aria-label="(row.task.completedAt != null ? '恢复计划 ' : '完成计划 ') + row.task.title"
          :disabled="row.task.completionRequired === false || row.task.cancelledAt != null"
          @click="status(row, row.task.completedAt != null ? 'reopen' : 'complete')"
        >
          <Check v-if="row.task.completedAt != null" :size="15" /></button
        ><button class="plan-content" :aria-label="'编辑计划 ' + row.task.title" @click="edit(row)">
          <div class="plan-title">
            <strong>{{ row.task.title }}</strong
            ><span class="tag">{{ row.occurrence?.isDeadline ? '截止 DDL' : row.task.kind }}</span
            ><span v-if="row.task.repeatRule" class="repeat-tag"
              ><Repeat2 :size="13" />{{ repeatLabel(row.task) }}</span
            ><span v-if="row.task.archivedAt != null" class="tag">已归档</span
            ><span v-if="row.task.cancelledAt != null" class="tag">已取消</span>
            <span v-if="!row.occurrence && hasMatchingException(row.task)" class="tag"
              >匹配单次安排</span
            >
          </div>
          <p v-if="row.task.content" class="plan-description">{{ row.task.content }}</p>
          <div class="plan-meta">
            <span v-if="row.task.courseID"
              ><span
                class="inline-dot"
                :style="{
                  background: store.state.courses.find((c) => c.id === row.task.courseID)?.colorHex,
                }"
              />{{
                store.state.courses.find((c) => c.id === row.task.courseID)?.name ??
                row.task.courseNameSnapshot
              }}</span
            ><span
              ><Clock3 :size="12" />{{
                row.occurrence
                  ? row.occurrence.isAllDay
                    ? '全天 · '
                    : ''
                  : row.task.deadline
                    ? '截止：'
                    : '执行：'
              }}{{ label(row.occurrence?.date ?? row.task.deadline ?? row.task.startsAt) }}</span
            ><span v-if="row.task.location">{{ row.task.location }}</span
            ><span v-if="row.task.materialIDs.length"
              >{{ row.task.materialIDs.length }} 份关联资料</span
            >
          </div>
        </button>
        <div class="plan-actions">
          <button
            v-if="base(row.task).exceptions?.length"
            class="icon-button"
            :aria-label="'查看临时变更 ' + row.task.title"
            title="查看临时变更"
            @click="historyID = row.task.id"
          >
            <History :size="16" /><span class="exception-count">{{
              base(row.task).exceptions?.length
            }}</span></button
          ><button
            class="icon-button"
            :aria-label="
              (row.task.cancelledAt != null ? '恢复已取消计划 ' : '取消计划 ') + row.task.title
            "
            :title="row.task.cancelledAt != null ? '恢复已取消计划' : '取消计划'"
            @click="status(row, row.task.cancelledAt != null ? 'restore' : 'cancel')"
          >
            <RotateCcw v-if="row.task.cancelledAt != null" :size="16" /><XCircle
              v-else
              :size="16"
            /></button
          ><button
            class="icon-button"
            :aria-label="row.task.archivedAt != null ? '恢复归档计划' : '归档计划'"
            :title="row.task.archivedAt != null ? '恢复归档计划' : '归档计划'"
            @click="status(row, row.task.archivedAt != null ? 'unarchive' : 'archive')"
          >
            <Archive :size="16" /></button
          ><button
            class="icon-button danger-text"
            aria-label="删除计划"
            @click="status(row, 'delete')"
          >
            <Trash2 :size="16" />
          </button>
        </div>
      </div>
      <div v-if="mode === 'list' && store.state.timetableTerms.length" class="info-note">
        <CalendarDays :size="17" />
        <div>
          资料库中 {{ store.state.timetableTerms.length }} 个课表学期已完整保留。
          <p>
            点击“查看课表”可按周查看、设置学期并取消或恢复单次课程。月历按原版设置显示截止项、计划与课程。
          </p>
        </div>
      </div>
    </div>
    <TaskEditor
      v-if="editing"
      :task="editing.task"
      :occurrence="editing.occurrence"
      @close="editing = null"
    /><Modal v-if="historyPlan" title="计划临时变更" @close="historyID = null"
      ><div class="form-stack">
        <p class="muted">
          {{ historyPlan.title }} · {{ exceptions.length }} 次临时变更。每次变更以原始发生时间定位。
        </p>
        <div
          v-for="entry in exceptions"
          :key="String(entry.change.originalDate)"
          class="exception-card"
        >
          <strong>{{ label(entry.change.originalDate) }}</strong>
          <p>{{ entry.occurrence.task.title }}</p>
          <div class="exception-tags">
            <span v-if="entry.change.cancelledAt != null" class="tag">已取消本次</span
            ><span v-if="entry.occurrence.task.completedAt != null" class="tag">已完成</span
            ><span v-if="entry.change.details" class="tag">内容或时间已调整</span>
          </div>
          <div class="setting-actions">
            <button @click="editException(entry.occurrence)">编辑本次</button
            ><button
              v-if="entry.change.cancelledAt != null"
              @click="
                status(
                  {
                    key: entry.occurrence.id,
                    task: entry.occurrence.task,
                    occurrence: entry.occurrence,
                  },
                  'restore',
                )
              "
            >
              恢复本次安排</button
            ><button
              @click="
                status(
                  {
                    key: entry.occurrence.id,
                    task: entry.occurrence.task,
                    occurrence: entry.occurrence,
                  },
                  'resetOccurrence',
                )
              "
            >
              还原本次变更
            </button>
          </div>
        </div>
        <p v-if="!exceptions.length" class="muted">没有临时变更。</p>
      </div></Modal
    ><Modal v-if="operation" :title="actionNames[operation.action]" @close="operation = null"
      ><div class="form-stack">
        <p>{{ operation.occurrence?.task.title ?? operation.task.title }}</p>
        <label
          >作用范围<select v-model="operationScope" aria-label="作用范围">
            <option v-for="scope in scopes" :key="scope" :value="scope">
              {{ operation.task.repeatRule ? scopeNames[scope] : '此计划' }}
            </option>
          </select></label
        >
        <p v-if="operation.occurrence" class="field-note">
          原始发生日：{{ label(operation.occurrence.originalDate) }}（北京时间）
        </p>
        <p class="muted small">
          {{
            operation.action === 'resetOccurrence'
              ? '将清除本次的时间、内容、完成及取消例外，恢复到整组计划的安排。'
              : operationScope === 'thisOccurrence'
                ? '仅影响本次安排及关联的截止项，其他发生项保留。'
                : operationScope === 'thisAndFuture'
                  ? '影响本次及以后的安排；此前发生项保留。'
                  : '操作将应用到整组计划。课程、资料和实际文件保留。'
          }}
        </p>
        <div class="dialog-actions">
          <span class="spacer" /><button @click="operation = null">返回</button
          ><button class="primary" :disabled="!!store.busy" @click="applyOperation">
            {{ actionButtons[operation.action] }}
          </button>
        </div>
      </div></Modal
    >
  </section>
</template>
