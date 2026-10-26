<script setup lang="ts">
const api = window.teachshelf;
import { computed, ref, toRaw, watch } from 'vue';
import {
  Archive,
  CalendarDays,
  Check,
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
import { dateMs } from '../../shared/model';
import type { StudyTask, SwiftDate } from '../../shared/model';
import { planAnchor, planSnapshot, readPlan, swiftSeconds } from '../../shared/plans';
import type { PlanEditScope, PlanOccurrence, PlanStatus } from '../../shared/plans';
import { useLibrary } from '../stores/library';
import { useWorkspaceUI } from '../stores/workspace-ui';
import TaskEditor from '../components/TaskEditor.vue';
import Modal from '../components/Modal.vue';
import { matchesPlanStatus, planVariants } from '../composables/plan-filter';
import type { PlanFilter } from '../composables/plan-filter';
const store = useLibrary(),
  filter = ref<PlanFilter>(store.route === 'pending' ? 'pending' : 'active'),
  query = ref(''),
  courseID = ref('');
const ui = useWorkspaceUI();
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
const selectedKey = ref('');
const selectedRow = computed(() => rows.value.find((row) => row.key === selectedKey.value));
const listOnly = computed(() => ['unscheduled', 'cancelled', 'archived'].includes(filter.value));
watch(
  () => store.route,
  (route) => {
    filter.value = route === 'pending' ? 'pending' : 'active';
  },
);
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
  <section class="workspace plans-workspace plan-list-workspace">
    <header class="workspace-header">
      <div class="heading-block">
        <div class="heading-line">
          <h1>
            {{ store.route === 'pending' ? '待完成计划' : '计划列表' }}
          </h1>
          <span class="subtle-count">{{ rows.length }} 项</span>
        </div>
        <p>安排学习与作业，按北京时间管理执行与截止时间。</p>
      </div>
      <div class="toolbar-controls">
        <div class="segmented">
          <button class="active" aria-label="计划列表视图" aria-pressed="true">
            <List :size="16" />列表</button
          ><button
            aria-label="计划日程视图"
            :disabled="listOnly"
            :title="listOnly ? '此状态请在列表中查看' : ''"
            @click="ui.openSchedule('agenda')"
          >
            <CalendarDays :size="16" />日程</button
          ><button
            aria-label="计划月历视图"
            :disabled="listOnly"
            :title="listOnly ? '此状态请在列表中查看' : ''"
            @click="ui.openSchedule('month')"
          >
            <CalendarDays :size="16" />月历
          </button>
        </div>
        <button @click="ui.openSchedule('week')"><CalendarDays :size="16" />查看课表</button
        ><button class="primary" @click="editing = {}"><Plus :size="16" />新建计划</button>
      </div>
    </header>
    <div class="filter-bar">
      <label class="search-field"
        ><Search :size="16" /><input
          v-model="query"
          placeholder="搜索计划名称与内容"
          aria-label="搜索计划" /></label
      ><select v-choice v-model="courseID" aria-label="计划课程筛选">
        <option value="">全部课程</option>
        <option v-for="c in store.state.courses" :key="c.id" :value="c.id">
          {{ c.name }}
        </option></select
      ><select v-choice v-model="filter" aria-label="计划状态筛选">
        <option value="active">当前计划</option>
        <option value="unscheduled">待安排</option>
        <option value="pending">未完成</option>
        <option value="completed">已完成</option>
        <option value="cancelled">已取消</option>
        <option value="archived">已归档</option>
        <option value="all">全部计划</option>
      </select>
    </div>
    <div class="plans-list-body">
      <div class="plans-scroll">
        <div class="plan-columns" aria-hidden="true">
          <span>状态</span><span>计划</span><span>执行</span><span>截止</span><span>操作</span>
        </div>
        <div v-if="!rows.length" class="empty-state">
          <CalendarDays :size="43" />
          <h2>还没有符合条件的计划</h2>
          <p>创建任务，关联课程、资料和截止时间。</p>
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
          :aria-selected="selectedKey === row.key"
          @click="selectedKey = row.key"
          :data-original-date="row.occurrence?.originalDate"
        >
          <button
            class="complete-button"
            :class="{ checked: row.task.completedAt != null }"
            :aria-label="
              (row.task.completedAt != null ? '恢复计划 ' : '完成计划 ') + row.task.title
            "
            :disabled="row.task.completionRequired === false || row.task.cancelledAt != null"
            @click="status(row, row.task.completedAt != null ? 'reopen' : 'complete')"
          >
            <Check v-if="row.task.completedAt != null" :size="15" /></button
          ><button
            class="plan-content"
            :aria-label="'编辑计划 ' + row.task.title"
            @click="edit(row)"
          >
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
                    background: store.state.courses.find((c) => c.id === row.task.courseID)
                      ?.colorHex,
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
          <span class="plan-date" :title="label(row.task.startsAt)">{{
            row.task.hasExecutionTime === false
              ? '未安排'
              : new Date(dateMs(row.task.startsAt)).toLocaleDateString('zh-CN', {
                  timeZone: 'Asia/Shanghai',
                  month: 'numeric',
                  day: 'numeric',
                })
          }}</span>
          <span
            class="plan-date"
            :title="row.task.deadline == null ? '' : label(row.task.deadline)"
            >{{
              row.task.deadline == null
                ? '—'
                : new Date(dateMs(row.task.deadline)).toLocaleDateString('zh-CN', {
                    timeZone: 'Asia/Shanghai',
                    month: 'numeric',
                    day: 'numeric',
                  })
            }}</span
          >
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
      </div>
      <aside class="plan-detail" aria-label="计划详情">
        <template v-if="selectedRow">
          <h2>{{ selectedRow.task.title }}</h2>
          <p class="muted">{{ selectedRow.task.kind }}</p>
          <dl>
            <dt>执行时间</dt>
            <dd>
              {{
                selectedRow.task.hasExecutionTime === false
                  ? '未安排'
                  : label(selectedRow.task.startsAt)
              }}
            </dd>
            <dt>截止时间</dt>
            <dd>
              {{
                selectedRow.task.deadline == null ? '无截止时间' : label(selectedRow.task.deadline)
              }}
            </dd>
            <dt>所属课程</dt>
            <dd>
              {{
                store.state.courses.find((c) => c.id === selectedRow?.task.courseID)?.name || '无'
              }}
            </dd>
            <dt>地点</dt>
            <dd>{{ selectedRow.task.location || '未设置' }}</dd>
          </dl>
          <p class="wrap">{{ selectedRow.task.content }}</p>
          <button @click="edit(selectedRow)">编辑所选计划</button>
        </template>
        <div v-else class="empty-state compact">
          <CalendarDays :size="32" />
          <h3>选择一个计划</h3>
          <p>查看时间、课程与计划详情。</p>
        </div>
      </aside>
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
          >作用范围<select v-choice v-model="operationScope" aria-label="作用范围">
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
