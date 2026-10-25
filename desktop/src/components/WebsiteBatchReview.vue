<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { Download, FileSearch, Square } from 'lucide-vue-next';
import type {
  BatchReview,
  BatchReviewRow,
  BatchApplyResult,
  BackgroundStatus,
} from '../../shared/api';
import type { SwiftDate } from '../../shared/model';
import { dateMs } from '../../shared/model';
import { useLibrary } from '../stores/library';
import Modal from './Modal.vue';
const api = window.teachshelf,
  store = useLibrary();
const props = defineProps<{
    connections: { id: string; courseID: string; remoteTitle: string; accountID: string }[];
  }>(),
  emit = defineEmits<{ close: [] }>();
const connectionIDs = ref(props.connections.map((c) => c.id)),
  loading = ref(true),
  includeExisting = ref(true),
  review = ref<BatchReview | null>(null),
  selected = ref<string[]>([]),
  decisions = ref<Record<string, string>>({}),
  approvedLocal = ref<string[]>([]),
  running = ref<'check' | 'apply' | null>(null),
  lastResult = ref<BatchApplyResult | null>(null),
  invalidated = ref(false),
  newerReview = ref<BatchReview>();
let adoptingScope = false,
  allowAutomaticReview = true;
function clearSelection() {
  selected.value = [];
  decisions.value = {};
  approvedLocal.value = [];
}
function adoptReview(value: BatchReview) {
  adoptingScope = true;
  connectionIDs.value = [...value.connectionIDs];
  adoptingScope = false;
  review.value = value;
  selected.value = value.rows.filter((row) => row.selectedByDefault).map((row) => row.id);
  decisions.value = {};
  approvedLocal.value = [];
  invalidated.value = false;
  newerReview.value = undefined;
  lastResult.value = null;
  allowAutomaticReview = false;
}
watch(
  [connectionIDs, includeExisting],
  () => {
    if (adoptingScope) return;
    allowAutomaticReview = false;
    invalidated.value = false;
    newerReview.value = undefined;
    review.value = null;
    lastResult.value = null;
    clearSelection();
  },
  { deep: true, flush: 'sync' },
);
const statusLabels: Record<BatchReviewRow['status'], string> = {
  'new-file': '新增资料',
  'missing-file': '本地缺失',
  'verify-file': '待下载核验',
  'new-plan': '新增计划',
  'update-plan': '计划变更',
  'deadline-conflict': '截止时间冲突',
  'local-modified': '本地文件已修改',
};
const now = ref(Date.now());
let expiryTimer: ReturnType<typeof setInterval> | undefined;
let active = true,
  eventSequence = 0,
  authoritative: BackgroundStatus | undefined,
  unsubscribe: (() => void) | undefined;
function reconcile(status: BackgroundStatus) {
  const pending = status.review?.rows.length ? status.review : undefined;
  now.value = Date.now();
  if (review.value) {
    if (
      pending?.id === review.value.id &&
      pending.revision === review.value.revision &&
      !invalidated.value
    ) {
      // Status-only broadcasts must never replace the user's choices.
      review.value = pending;
      newerReview.value = undefined;
    } else if (!pending && !review.value.rows.length) {
      newerReview.value = undefined;
    } else {
      invalidated.value = true;
      newerReview.value = pending;
    }
  } else if (pending && allowAutomaticReview) adoptReview(pending);
  else newerReview.value = pending;
}
function receive(status: BackgroundStatus) {
  eventSequence++;
  authoritative = status;
  if (active && !running.value) reconcile(status);
}
async function readStatus() {
  const before = eventSequence;
  try {
    const value = await api.websiteBackgroundStatus();
    if (active && before === eventSequence) authoritative = value;
  } catch (error) {
    if (active) store.error = String(error);
  }
}
async function finishOperation() {
  // Foreground check/apply publishes intermediate states. Reconcile only the
  // authoritative state after its result; late mount responses cannot win.
  await readStatus();
  running.value = null;
  if (active && authoritative) reconcile(authoritative);
}
onMounted(async () => {
  expiryTimer = setInterval(() => {
    now.value = Date.now();
  }, 1000);
  unsubscribe = api.onWebsiteBackground(receive);
  await readStatus();
  if (active && !running.value && authoritative) reconcile(authoritative);
  loading.value = false;
});
onUnmounted(() => {
  active = false;
  unsubscribe?.();
  if (expiryTimer) clearInterval(expiryTimer);
});
const expired = computed(() => !!review.value && review.value.expiresAt <= now.value);
const stale = computed(
  () =>
    !!review.value &&
    (invalidated.value || review.value.revision !== store.snapshot?.revision || expired.value),
);
const selectedRows = computed(
  () => review.value?.rows.filter((row) => selected.value.includes(row.id)) ?? [],
);
const unresolved = computed(() =>
  selectedRows.value.some(
    (row) =>
      (row.pendingDeadline && !['local', 'website'].includes(decisions.value[row.id])) ||
      (row.status === 'local-modified' && !approvedLocal.value.includes(row.id)),
  ),
);
const groups = computed(() =>
  props.connections
    .map((connection) => ({
      connection,
      rows: review.value?.rows.filter((row) => row.connectionID === connection.id) ?? [],
    }))
    .filter((group) => group.rows.length),
);
async function check() {
  if (loading.value || running.value) return;
  allowAutomaticReview = false;
  invalidated.value = false;
  newerReview.value = undefined;
  now.value = Date.now();
  running.value = 'check';
  review.value = null;
  lastResult.value = null;
  try {
    const value = await store.run(
      () =>
        api.checkWebsiteBatch({
          connectionIDs: [...connectionIDs.value],
          includeExisting: includeExisting.value,
        }),
      '网站更新检查完成',
    );
    if (active && value) adoptReview(value);
  } finally {
    await finishOperation();
  }
}
async function apply() {
  now.value = Date.now();
  if (
    loading.value ||
    running.value ||
    !review.value ||
    !selected.value.length ||
    unresolved.value ||
    stale.value
  )
    return;
  running.value = 'apply';
  const previous = [...selected.value];
  try {
    const deadlineChoices = Object.fromEntries(
      selectedRows.value
        .filter((row) => row.pendingDeadline)
        .map((row) => [row.id, decisions.value[row.id] === 'website']),
    );
    const value = await store.run(
      () =>
        api.applyWebsiteBatch({
          reviewID: review.value!.id,
          selectedIDs: previous,
          deadlineChoices,
          adoptLocalFileIDs: approvedLocal.value.filter((id) => previous.includes(id)),
        }),
      '所选更新已处理',
    );
    if (active && value) {
      store.accept(value.snapshot);
      review.value = value.review;
      invalidated.value = false;
      newerReview.value = undefined;
      lastResult.value = value;
      selected.value = value.review.rows
        .filter((row) => previous.includes(row.id) && row.status !== 'local-modified')
        .map((row) => row.id);
      approvedLocal.value = [];
      store.status = `更新成功 ${value.results.filter((r) => r.success).length} 项，保留待处理 ${value.review.rows.length} 项`;
    }
  } finally {
    await finishOperation();
  }
}
async function cancel() {
  try {
    await api.cancelWebsiteBatch();
    store.status = '已请求停止；已完成的更新保留';
  } catch (error) {
    store.error = error instanceof Error ? error.message : String(error);
  }
}
async function close() {
  if (running.value) {
    await cancel();
    return;
  }
  emit('close');
}
async function discard() {
  if (running.value) return;
  const discarded = await store.run(async () => {
    await api.discardWebsiteReview();
    return true;
  }, '已丢弃审核清单，下次检查将重新读取网页');
  if (active && discarded) {
    allowAutomaticReview = false;
    invalidated.value = false;
    newerReview.value = undefined;
    review.value = null;
    selected.value = [];
    decisions.value = {};
    approvedLocal.value = [];
    lastResult.value = null;
  }
}
function selectAll() {
  if (!review.value) return;
  const available = review.value.rows
    .filter((row) => row.status !== 'local-modified' || approvedLocal.value.includes(row.id))
    .map((row) => row.id);
  selected.value = available.every((id) => selected.value.includes(id)) ? [] : available;
}
function toggleLocal(row: BatchReviewRow, event: Event) {
  if ((event.target as HTMLInputElement).checked)
    approvedLocal.value = [...approvedLocal.value, row.id];
  else {
    approvedLocal.value = approvedLocal.value.filter((id) => id !== row.id);
    selected.value = selected.value.filter((id) => id !== row.id);
  }
}
function deadline(value?: SwiftDate, allDay = false) {
  return value == null
    ? '未设置'
    : new Date(dateMs(value)).toLocaleString('zh-CN', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        ...(allDay ? {} : { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }),
      }) + (allDay ? '（全天）' : '（北京时间）');
}
</script>
<template>
  <Modal title="教学网站批量更新审核" wide @close="close"
    ><div class="form-stack batch-review">
      <p class="muted">
        先读取课程与活动清单，再由你选择需要下载或应用的项目。已存在的资料正文只有确认后才会下载核验。
      </p>
      <fieldset :disabled="!!running || loading" class="batch-connections">
        <legend>检查课程</legend>
        <label v-for="connection in connections" :key="connection.id" class="check-label"
          ><input type="checkbox" v-model="connectionIDs" :value="connection.id" />{{
            store.state.courses.find((c) => c.id === connection.courseID)?.name ??
            connection.remoteTitle
          }}<small class="muted">账号 {{ connection.accountID }}</small></label
        >
      </fieldset>
      <label class="check-label"
        ><input
          type="checkbox"
          v-model="includeExisting"
          :disabled="!!running || loading"
        />列出已有资料，供选择后下载核验</label
      >
      <div class="setting-actions">
        <button
          class="primary"
          :disabled="!!running || loading || !connectionIDs.length"
          @click="check"
        >
          <FileSearch :size="15" />{{ review ? '重新检查网站更新' : '检查网站更新' }}</button
        ><button v-if="review && !running" @click="discard">丢弃当前审核</button
        ><button v-if="running" @click="cancel">
          <Square :size="14" />停止{{ running === 'check' ? '检查' : '更新' }}</button
        ><span v-if="running" class="muted small">{{
          running === 'check'
            ? '正在读取官方课程和活动页面…'
            : '正在处理已选项目；完成项会立即保存。'
        }}</span>
      </div>
      <p v-if="invalidated" class="warning-banner" role="status">
        当前审核已失效，不能继续应用。请加载最新审核或重新检查网站更新；原选择暂时保留。
      </p>
      <div v-if="newerReview && !running && !loading" class="info-note">
        有另一份待审核清单（{{ newerReview.rows.length }}
        项）。加载后将采用该清单的课程并重置当前选择。
        <button @click="adoptReview(newerReview)">加载最新审核</button>
      </div>
      <template v-if="review"
        ><p class="info-note">
          待审核 {{ review.rows.length }} 项 · 已有资料未核验 {{ review.unverifiedFiles }} 份 ·
          本次未列入 {{ review.skippedFiles }} 份。清单有效期 15 分钟。
        </p>
        <div v-if="review.messages.length" class="batch-messages">
          <p
            v-for="(message, index) in review.messages"
            :key="index"
            :class="{ 'warning-banner': message.isIssue }"
          >
            {{ message.text }}
          </p>
        </div>
        <p v-if="review.interrupted" class="warning-banner">
          本次操作已中止；成功项保留，请检查下方结果或重新检查。
        </p>
        <p v-if="expired" class="warning-banner">更新清单已过期，请重新检查网站更新。</p>
        <p v-else-if="stale && !invalidated" class="warning-banner">
          资料库已变化，当前清单不能继续应用，请重新检查网站更新。
        </p>
        <div v-if="lastResult" class="batch-results" aria-label="批量更新结果">
          <strong
            >成功 {{ lastResult.results.filter((r) => r.success).length }} 项，未完成
            {{ lastResult.results.filter((r) => !r.success).length }} 项；下载核验
            {{ lastResult.downloaded }} 份。</strong
          >
          <p
            v-for="result in lastResult.results"
            :key="result.id"
            :class="{ failed: !result.success }"
          >
            {{ result.success ? '已完成' : '待重试' }} · {{ result.message }}
          </p>
        </div>
        <div v-if="review.rows.length" class="batch-selection">
          <button :disabled="!!running" @click="selectAll">选择或清空全部可处理项</button
          ><span>已选 {{ selected.length }} 项</span>
        </div>
        <section v-for="group in groups" :key="group.connection.id" class="batch-course">
          <h3>{{ group.connection.remoteTitle }}</h3>
          <article
            v-for="row in group.rows"
            :key="row.id"
            class="batch-row"
            :data-review-id="row.id"
            :data-status="row.status"
          >
            <label class="batch-row-heading"
              ><input
                type="checkbox"
                :value="row.id"
                v-model="selected"
                :disabled="
                  !!running || (row.status === 'local-modified' && !approvedLocal.includes(row.id))
                "
                :aria-label="'选择更新 ' + row.title"
              /><strong>{{ row.title }}</strong
              ><span class="tag">{{ statusLabels[row.status] }}</span></label
            >
            <p class="muted small">{{ row.detail }}</p>
            <p v-if="row.error" class="warning-banner">{{ row.error }}</p>
            <label v-if="row.status === 'local-modified'" class="check-label local-version-consent"
              ><input
                type="checkbox"
                :checked="approvedLocal.includes(row.id)"
                :disabled="!!running"
                :aria-label="'允许保留本地版本后更新 ' + row.title"
                @change="toggleLocal(row, $event)"
              />保留本地文件为历史版本，并下载网站版本作为当前资料</label
            >
            <div v-if="row.pendingDeadline" class="batch-deadline">
              <p>
                本地：{{ deadline(row.before?.deadline, row.before?.deadlineIsAllDay)
                }}<br />网站：{{ deadline(row.pendingDeadline.date, row.pendingDeadline.allDay) }}
              </p>
              <label
                >截止冲突处理<select
                  v-choice
                  v-model="decisions[row.id]"
                  :aria-label="'截止冲突处理 ' + row.title"
                  :disabled="!!running"
                >
                  <option value="">请选择处理方式</option>
                  <option value="local">保留本地截止</option>
                  <option value="website">采用网站截止</option>
                </select></label
              >
            </div>
            <details v-if="row.kind === 'plan'" class="batch-plan-diff">
              <summary>查看计划差异</summary>
              <div>
                <section>
                  <h4>本地当前</h4>
                  <template v-if="row.before"
                    ><strong>{{ row.before.title }}</strong>
                    <pre>{{ row.before.content }}</pre>
                    <p>
                      {{ deadline(row.before.deadline, row.before.deadlineIsAllDay) }}
                    </p></template
                  >
                  <p v-else>尚无本地计划</p>
                </section>
                <section>
                  <h4>应用后</h4>
                  <template v-if="row.proposed"
                    ><strong>{{ row.proposed.title }}</strong>
                    <pre>{{ row.proposed.content }}</pre>
                    <p>
                      {{
                        row.pendingDeadline && decisions[row.id] === 'website'
                          ? deadline(row.pendingDeadline.date, row.pendingDeadline.allDay)
                          : deadline(row.proposed.deadline, row.proposed.deadlineIsAllDay)
                      }}
                    </p></template
                  >
                </section>
              </div>
            </details>
          </article>
        </section>
        <p v-if="!review.rows.length" class="muted">
          本次清单没有剩余待审核项目。已有正文仍以未核验数量为准。
        </p>
        <p v-if="unresolved" class="field-note">
          请先为选中的截止冲突选择处理方式，并单独确认本地文件修改的处理。
        </p>
        <div class="dialog-actions">
          <span class="spacer" /><button @click="close">
            {{ running ? '停止并保留结果' : '关闭' }}</button
          ><button
            class="primary"
            :disabled="!!running || !selected.length || unresolved || stale"
            @click="apply"
          >
            <Download :size="15" />{{
              selectedRows.some((row) => row.error) ? '重试所选更新' : '应用所选更新'
            }}
          </button>
        </div></template
      >
    </div></Modal
  >
</template>
<style scoped>
.batch-connections {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.batch-connections legend {
  font-size: 12px;
  color: var(--muted);
  padding: 0 5px;
}
.batch-connections small {
  margin-left: auto;
}
.batch-course h3 {
  font-size: 14px;
  margin: 16px 0 10px;
}
.batch-row {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 13px;
  margin: 10px 0;
}
.batch-review .batch-row-heading {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 9px;
}
.batch-row-heading input[type='checkbox'] {
  width: 14px;
  flex: 0 0 14px;
}
.batch-row-heading strong {
  font-size: 13px;
  flex: 1;
}
.batch-row > p {
  line-height: 1.7;
  margin: 10px 0;
}
.batch-selection {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
}
.batch-results {
  background: var(--accent-soft);
  padding: 13px;
  border-radius: 8px;
  font-size: 12px;
}
.batch-results p {
  margin: 8px 0;
  line-height: 1.5;
}
.batch-results .failed {
  color: var(--danger);
}
.batch-plan-diff {
  font-size: 12px;
  margin-top: 10px;
}
.batch-plan-diff summary {
  cursor: pointer;
  color: var(--muted);
}
.batch-plan-diff > div {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
  margin-top: 12px;
}
.batch-plan-diff section {
  background: var(--surface);
  padding: 10px;
  border-radius: 6px;
  min-width: 0;
}
.batch-plan-diff h4 {
  margin: 0 0 10px;
}
.batch-plan-diff pre {
  font: inherit;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 160px;
  overflow: auto;
}
.batch-deadline {
  padding: 10px;
  background: var(--surface);
  font-size: 12px;
  line-height: 1.7;
}
.local-version-consent {
  font-size: 12px;
  padding: 10px;
  background: var(--accent-soft);
  border-radius: 6px;
}
.batch-messages {
  font-size: 12px;
}
</style>
