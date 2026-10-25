<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  Download,
  ExternalLink,
  FileSearch,
  FileText,
  Globe,
  Link2,
  Unlink,
} from 'lucide-vue-next';
import type { AssignmentPreview, WebsiteResult } from '../../shared/api';
import type { StudyTask, SwiftDate } from '../../shared/model';
import { dateMs } from '../../shared/model';
import { useLibrary } from '../stores/library';
import Modal from './Modal.vue';
const api = window.teachshelf,
  store = useLibrary();
const props = defineProps<{ initialKind?: 'teaching' | 'timetable' }>(),
  emit = defineEmits<{ close: [] }>();
const kind = ref<'teaching' | 'timetable'>(props.initialKind ?? 'teaching'),
  result = ref<WebsiteResult | null>(null),
  selected = ref<string[]>([]),
  localCourseID = ref(store.courseID ?? ''),
  summary = ref(''),
  includeHistory = ref(false),
  assignmentConnectionID = ref(''),
  managedID = ref(''),
  review = ref<AssignmentPreview | null>(null),
  observedRevision = ref('');
type Connection = Awaited<ReturnType<typeof api.connectWebsite>>['connection'];
const connections = computed(
  () =>
    store.state.teachingConnections.filter(
      (c) =>
        typeof c.id === 'string' &&
        typeof c.courseID === 'string' &&
        typeof c.remoteCourseID === 'string' &&
        typeof c.accountID === 'string',
    ) as unknown as Connection[],
);
const initialConnection = connections.value.find((c) => c.courseID === store.courseID);
const url = ref(
  kind.value === 'timetable'
    ? 'https://ehallapp.nju.edu.cn/jwapp/sys/wdkb/*default/index.do'
    : initialConnection?.remoteCourseID
      ? `https://selearning.nju.edu.cn/course/view.php?id=${initialConnection.remoteCourseID}`
      : 'https://selearning.nju.edu.cn/',
);
interface TeachingFile {
  key: string;
  name: string;
  url: string;
  subfolders?: string[];
}
interface TeachingActivity {
  id: string;
  title: string;
  url: string;
  kind: string;
}
const page = computed(() =>
  result.value?.data && typeof result.value.data === 'object'
    ? (result.value.data as Record<string, unknown>)
    : {},
);
const files = computed(() =>
  Array.isArray(page.value.files)
    ? page.value.files.filter(
        (f): f is TeachingFile =>
          !!f &&
          typeof f === 'object' &&
          typeof f.key === 'string' &&
          typeof f.name === 'string' &&
          typeof f.url === 'string',
      )
    : [],
);
const activities = computed(() =>
  Array.isArray(page.value.activities)
    ? page.value.activities.filter(
        (a): a is TeachingActivity =>
          !!a &&
          typeof a === 'object' &&
          typeof a.title === 'string' &&
          typeof a.url === 'string' &&
          typeof a.id === 'string',
      )
    : [],
);
const matchingConnections = computed(() =>
  connections.value.filter(
    (c) => c.accountID === page.value.accountID && c.remoteCourseID === page.value.courseID,
  ),
);
const managed = computed(() => connections.value.find((c) => c.id === managedID.value));
const pendingDeadlines = computed(() =>
  Array.isArray(managed.value?.items) ? managed.value!.items.filter((i) => i.pendingDeadline) : [],
);
const observationStale = computed(
  () => !!result.value && observedRevision.value !== store.snapshot?.revision,
);
const reviewStale = computed(
  () =>
    !!review.value &&
    (review.value.revision !== store.snapshot?.revision || review.value.expiresAt < Date.now()),
);
watch(
  connections,
  (list) => {
    if (!list.some((c) => c.id === managedID.value))
      managedID.value = list.find((c) => c.courseID === store.courseID)?.id ?? list[0]?.id ?? '';
  },
  { immediate: true },
);
watch(matchingConnections, (list) => {
  if (!list.some((c) => c.id === assignmentConnectionID.value))
    assignmentConnectionID.value = list[0]?.id ?? '';
});
watch(assignmentConnectionID, () => {
  review.value = null;
});
function clearObservation() {
  result.value = null;
  selected.value = [];
  summary.value = '';
  review.value = null;
  observedRevision.value = '';
}
watch(kind, (k) => {
  url.value =
    k === 'teaching'
      ? 'https://selearning.nju.edu.cn/'
      : 'https://ehallapp.nju.edu.cn/jwapp/sys/wdkb/*default/index.do';
  clearObservation();
});
async function open(target = url.value) {
  const ok = await store.run(async () => {
    await api.openWebsite(target, kind.value);
    return true;
  }, '教学网站窗口已打开');
  if (ok) {
    url.value = target;
    clearObservation();
  }
}
async function inspect() {
  const value = await store.run(() => api.inspectWebsite(kind.value), '当前页面已解析');
  if (value) {
    result.value = value;
    observedRevision.value = store.snapshot?.revision ?? '';
    selected.value = [];
    summary.value = '';
    review.value = null;
  }
}
function selectAll() {
  selected.value =
    selected.value.length === files.value.length ? [] : files.value.map((f) => f.key);
}
async function importSelected() {
  if (!result.value?.proposalID || !selected.value.length) return;
  const proposalID = result.value.proposalID;
  const imported = await store.run(
    () =>
      api.importWebsite({
        proposalID,
        courseID: localCourseID.value || undefined,
        fileKeys: [...selected.value],
      }),
    '网站资料导入完成',
  );
  if (imported) {
    await store.refresh();
    summary.value = `已导入 ${imported.imported} 份，跳过 ${imported.skipped} 份`;
    store.status = summary.value;
    if (imported.errors.length) store.error = imported.errors.join('\n');
    selected.value = [];
  }
}
async function importSchedule() {
  const proposalID = result.value?.proposalID;
  if (!proposalID) return;
  const imported = await store.run(() => api.importTimetable(proposalID), '课表已导入');
  if (imported) {
    store.accept(imported.snapshot);
    store.status = `已导入 ${imported.summary.meetingsImported} 个上课时段，新建 ${imported.summary.coursesCreated} 门课程`;
    store.navigate('timetable');
    emit('close');
  }
}
async function connect() {
  const proposalID = result.value?.proposalID;
  if (!proposalID || !localCourseID.value) return;
  const value = await store.run(
    () => api.connectWebsite(proposalID, localCourseID.value, includeHistory.value),
    '课程连接已保存',
  );
  if (value) {
    store.accept(value.snapshot);
    managedID.value = value.connection.id;
    assignmentConnectionID.value = value.connection.id;
    summary.value = value.created
      ? '已建立课程连接。打开下方作业条目后读取并审核当前作业。'
      : '已使用现有课程连接。';
  }
}
async function previewAssignment() {
  if (!result.value?.proposalID || !assignmentConnectionID.value) return;
  const value = await store.run(
    () => api.previewWebsiteAssignment(result.value!.proposalID!, assignmentConnectionID.value),
    '作业更新预览已生成',
  );
  if (value) {
    review.value = value;
    summary.value = '';
  }
}
async function applyAssignment() {
  const value = review.value;
  if (!value || !value.reviewable || reviewStale.value) return;
  const applied = await store.run(
    () => api.applyWebsiteAssignment(value.proposalID),
    '当前作业更新已应用',
  );
  if (applied) {
    store.accept(applied.snapshot);
    managedID.value = value.connectionID;
    summary.value = applied.message;
    review.value = null;
  }
}
async function disconnect() {
  const c = managed.value;
  if (
    !c ||
    !(await store.confirm(
      '断开网站课程连接？',
      `${c.remoteTitle} 的连接记录将移除。已经导入的课程、计划、资料和文件保留。`,
      '断开连接',
    ))
  )
    return;
  await store.change(() => api.disconnectWebsite(c.id), '课程连接已断开');
  review.value = null;
}
type Option = 'includeHistory' | 'includeAssignments' | 'includeExperiments' | 'includeMaterials';
const options: { key: Option; label: string }[] = [
  { key: 'includeHistory', label: '纳入历史作业' },
  { key: 'includeAssignments', label: '纳入普通作业' },
  { key: 'includeExperiments', label: '纳入实验作业' },
  { key: 'includeMaterials', label: '保留资料同步选项' },
];
async function updateOption(key: Option, event: Event) {
  const c = managed.value;
  if (!c) return;
  await store.change(
    () => api.updateWebsiteOptions(c.id, { [key]: (event.target as HTMLInputElement).checked }),
    '连接选项已保存',
  );
}
async function resolveDeadline(key: string, useWebsite: boolean) {
  const c = managed.value,
    revision = store.snapshot?.revision;
  if (!c || !revision) return;
  await store.change(
    () => api.resolveWebsiteDeadline(c.id, key, useWebsite, revision),
    useWebsite ? '已采用网站截止时间' : '已保留本地截止时间',
  );
}
function courseName(id: string) {
  return store.state.courses.find((c) => c.id === id)?.name ?? '课程已移除';
}
function deadline(value?: SwiftDate, allDay = false) {
  if (value == null) return '未设置';
  try {
    return (
      new Date(dateMs(value)).toLocaleString('zh-CN', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        ...(allDay ? {} : { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }),
      }) + (allDay ? '（全天）' : '（北京时间）')
    );
  } catch {
    return '日期无法显示';
  }
}
function localTask(id?: string) {
  return store.state.tasks.find((t) => t.id === id);
}
function fieldChanged(key: 'title' | 'content' | 'deadline') {
  const a = review.value?.before,
    b = review.value?.proposed;
  return (
    a?.[key] !== b?.[key] || (key === 'deadline' && a?.deadlineIsAllDay !== b?.deadlineIsAllDay)
  );
}
const reviewColumns = computed(
  () =>
    [
      { label: '本地当前', task: review.value?.before },
      { label: '应用后', task: review.value?.proposed },
    ] as { label: string; task?: StudyTask }[],
);
const pretty = computed(() => JSON.stringify(result.value?.data, null, 2));
</script>
<template>
  <Modal title="教学网站" wide @close="emit('close')"
    ><div class="form-stack">
      <p class="muted">在独立窗口完成登录。先读取课程首页，再打开作业或资料条目读取详情。</p>
      <div class="form-row">
        <label
          >网站类型<select aria-label="网站类型" v-model="kind">
            <option value="teaching">教学平台（Moodle）</option>
            <option value="timetable">南京大学课表</option>
          </select></label
        ><label class="grow">页面地址<input v-model="url" type="url" /></label>
      </div>
      <div class="setting-actions">
        <button class="primary" @click="open()" :disabled="!!store.busy">
          <ExternalLink :size="15" />打开登录窗口</button
        ><button @click="inspect" :disabled="!!store.busy">
          <FileSearch :size="15" />读取当前页面
        </button>
      </div>
      <div class="info-note">
        <Globe :size="17" /><span
          >教学网页在隔离窗口中运行。资料需选择后导入，作业需预览后应用；更新只针对当前作业，不会执行全课程自动同步。</span
        >
      </div>
      <details v-if="kind === 'teaching' && connections.length" class="website-connections">
        <summary>已绑定课程与截止冲突 · {{ connections.length }} 个连接</summary>
        <div class="form-stack">
          <label
            >管理课程连接<select v-model="managedID" aria-label="管理课程连接">
              <option v-for="c in connections" :key="c.id" :value="c.id">
                {{ courseName(c.courseID) }} · {{ c.remoteTitle }}
              </option>
            </select></label
          ><template v-if="managed"
            ><p class="field-note">
              网站账号 {{ managed.accountID }} · 课程 {{ managed.remoteCourseID }}
            </p>
            <div class="setting-actions">
              <button
                @click="
                  open('https://selearning.nju.edu.cn/course/view.php?id=' + managed.remoteCourseID)
                "
              >
                <ExternalLink :size="14" />打开绑定课程</button
              ><button @click="disconnect" :disabled="!!store.busy">
                <Unlink :size="14" />断开连接
              </button>
            </div>
            <div class="website-options">
              <label v-for="option in options" :key="option.key" class="check-label"
                ><input
                  type="checkbox"
                  :checked="managed[option.key] ?? option.key !== 'includeHistory'"
                  :disabled="!!store.busy"
                  @change="updateOption(option.key, $event)"
                />{{ option.label }}</label
              >
            </div>
            <p class="field-note">
              普通作业、实验与历史选项用于当前作业审核。资料同步选项随连接保存；附件仍需在当前页面选择导入。
            </p>
            <div v-if="pendingDeadlines.length" class="deadline-conflicts">
              <h4>待处理截止时间</h4>
              <article v-for="item in pendingDeadlines" :key="item.id" class="deadline-conflict">
                <strong>{{ localTask(item.localID)?.title ?? item.title }}</strong>
                <p>
                  本地：{{
                    deadline(
                      localTask(item.localID)?.deadline,
                      localTask(item.localID)?.deadlineIsAllDay,
                    )
                  }}
                </p>
                <p>
                  网站：{{ deadline(item.pendingDeadline?.date, item.pendingDeadline?.allDay) }}
                </p>
                <p class="small muted">{{ item.pendingDeadline?.text }}</p>
                <div class="setting-actions">
                  <button :disabled="!!store.busy" @click="resolveDeadline(item.id, false)">
                    保留本地截止</button
                  ><button :disabled="!!store.busy" @click="resolveDeadline(item.id, true)">
                    采用网站截止
                  </button>
                </div>
              </article>
            </div>
            <p v-else class="field-note">没有待处理的截止时间冲突。</p></template
          >
        </div>
      </details>
      <div v-if="result" class="website-result">
        <h3>{{ String(page.title ?? result.title ?? '页面解析结果') }}</h3>
        <p class="small muted wrap">{{ result.url }}</p>
        <template v-if="kind === 'teaching'">
          <div v-if="page.kind === 'course'" class="website-binding">
            <h4>绑定本地课程</h4>
            <p class="field-note">网站账号 {{ page.accountID }} · 网站课程 {{ page.courseID }}</p>
            <div class="form-row">
              <label class="grow"
                >绑定到本地课程<select v-model="localCourseID" aria-label="绑定到本地课程">
                  <option value="">请选择课程</option>
                  <option
                    v-for="c in store.state.courses.filter((c) => !c.isArchived)"
                    :key="c.id"
                    :value="c.id"
                  >
                    {{ c.name }}
                  </option>
                </select></label
              ><button
                class="primary"
                :disabled="!localCourseID || !result.proposalID || !!store.busy || observationStale"
                @click="connect"
              >
                <Link2 :size="15" />绑定当前网站课程
              </button>
            </div>
            <label class="check-label"
              ><input
                type="checkbox"
                v-model="includeHistory"
              />新连接纳入已提交或已截止的历史作业</label
            >
            <p v-if="matchingConnections.length" class="field-note">
              该账号课程已绑定到 {{ courseName(matchingConnections[0].courseID) }}。
            </p>
          </div>
          <div v-if="activities.length" class="website-activities">
            <p class="field-note">打开条目后，再点击“读取当前页面”生成当前作业预览或选择附件。</p>
            <button
              v-for="activity in activities"
              :key="activity.kind + activity.id"
              :disabled="!!store.busy"
              @click="open(activity.url)"
            >
              <FileText :size="16" /><span>{{ activity.title }}</span
              ><ExternalLink :size="13" />
            </button>
          </div>
          <div v-if="page.kind === 'assign'" class="website-assignment">
            <h4>当前作业更新审核</h4>
            <p class="small muted">
              网站截止：{{ page.deadlineText || '未设置' }}{{ page.submitted ? ' · 已提交' : '' }}
            </p>
            <pre v-if="page.intro" class="website-intro">{{ page.intro }}</pre>
            <template v-if="matchingConnections.length"
              ><label
                >作业所属连接<select v-model="assignmentConnectionID" aria-label="作业所属连接">
                  <option v-for="c in matchingConnections" :key="c.id" :value="c.id">
                    {{ courseName(c.courseID) }} · {{ c.remoteTitle }}
                  </option>
                </select></label
              ><button
                :disabled="
                  !result.proposalID || !assignmentConnectionID || !!store.busy || observationStale
                "
                @click="previewAssignment"
              >
                <FileSearch :size="15" />预览当前作业更新
              </button></template
            >
            <p v-else class="info-note">
              该账号与网站课程尚未绑定。请先打开课程首页、读取并绑定本地课程，再从课程条目进入此作业。
            </p>
            <div v-if="review" class="assignment-review">
              <p class="info-note">{{ review.message }}</p>
              <div class="assignment-diff">
                <section v-for="column in reviewColumns" :key="column.label">
                  <h4>{{ column.label }}</h4>
                  <template v-if="column.task"
                    ><label :class="{ changed: fieldChanged('title') }"
                      >标题<strong>{{ column.task.title }}</strong></label
                    ><label :class="{ changed: fieldChanged('content') }"
                      >内容
                      <pre>{{ column.task.content || '无内容' }}</pre></label
                    ><label :class="{ changed: fieldChanged('deadline') }"
                      >截止时间<span>{{
                        deadline(column.task.deadline, column.task.deadlineIsAllDay)
                      }}</span></label
                    ></template
                  >
                  <p v-else class="muted">
                    {{
                      column.label === '本地当前' ? '本地尚无此作业计划' : '没有可应用的计划变更'
                    }}
                  </p>
                </section>
              </div>
              <p v-if="review.pendingDeadline" class="warning-banner">
                检测到截止冲突。应用后将保留当前本地截止，并将网站值
                {{ deadline(review.pendingDeadline.date, review.pendingDeadline.allDay) }}
                加入上方待处理列表。
              </p>
              <p class="field-note">
                本地手工修改的标题与内容会保留。预览仅更新当前作业，附件需另行选择导入。
              </p>
              <p v-if="reviewStale" class="warning-banner">
                本地资料已变化或预览已过期，请重新读取当前页面并预览。
              </p>
              <div class="dialog-actions">
                <span class="spacer" /><button @click="review = null">取消预览</button
                ><button
                  class="primary"
                  :disabled="!review.reviewable || reviewStale || !!store.busy"
                  @click="applyAssignment"
                >
                  确认应用当前作业
                </button>
              </div>
            </div>
          </div>
          <p v-if="observationStale" class="field-note">
            本地资料已更新。继续绑定或生成作业预览前，请重新读取当前页面。
          </p>
          <div v-if="files.length" class="website-files">
            <div class="website-files-header">
              <label class="check-label"
                ><input
                  type="checkbox"
                  :checked="selected.length === files.length"
                  @change="selectAll"
                />选择全部 {{ files.length }} 个文件</label
              ><span class="small muted">已选 {{ selected.length }} 个</span>
            </div>
            <label v-for="file in files" :key="file.key" class="website-file-row"
              ><input type="checkbox" :value="file.key" v-model="selected" /><FileText
                :size="17"
              /><span
                >{{ file.name
                }}<small v-if="file.subfolders?.length">{{
                  file.subfolders.join(' / ')
                }}</small></span
              ></label
            >
            <div class="website-import">
              <label
                >导入到课程<select aria-label="导入到课程" v-model="localCourseID">
                  <option value="">未分类</option>
                  <option v-for="c in store.state.courses" :key="c.id" :value="c.id">
                    {{ c.name }}
                  </option>
                </select></label
              ><button
                class="primary"
                @click="importSelected"
                :disabled="!selected.length || !!store.busy"
              >
                <Download :size="15" />导入选中资料
              </button>
            </div>
            <p class="field-note">导入清单在读取后 15 分钟内有效；已有文件由主进程检查并跳过。</p>
          </div>
          <p v-if="!activities.length && !files.length && page.kind !== 'assign'" class="info-note">
            当前页面没有可下载文件或活动条目，请确认已进入完整课程。
          </p>
          <p v-if="summary" class="import-summary">{{ summary }}</p>
        </template>
        <template v-else
          ><p class="info-note">
            核对解析结果后，可将本课表导入资料库。同名学期会更新上课时段并保留已设置的学期日期和停课、调课记录。
          </p>
          <pre>{{ pretty }}</pre>
          <div class="dialog-actions">
            <span class="spacer" /><button
              class="primary"
              @click="importSchedule"
              :disabled="!result.proposalID || !!store.busy"
            >
              <Download :size="15" />导入本课表
            </button>
          </div></template
        >
      </div>
    </div></Modal
  >
</template>
<style scoped>
.website-connections {
  border: 1px solid var(--border);
  border-radius: 9px;
  padding: 12px 14px;
}
.website-connections > summary {
  cursor: pointer;
  font-weight: 600;
  font-size: 13px;
}
.website-connections > .form-stack {
  padding-top: 15px;
}
.website-options {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.website-binding,
.website-assignment {
  padding: 15px;
  border: 1px solid var(--border);
  border-radius: 9px;
  margin: 16px 0;
}
.website-binding .form-row {
  align-items: flex-end;
  margin: 12px 0;
}
.website-binding h4,
.website-assignment h4,
.deadline-conflicts h4 {
  font-size: 13px;
  margin: 0 0 10px;
}
.website-assignment > label {
  margin: 12px 0;
}
.website-assignment > button {
  margin-top: 10px;
}
.website-intro {
  max-height: 130px;
  overflow: auto;
  white-space: pre-wrap;
}
.assignment-review {
  margin-top: 18px;
}
.assignment-diff {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin: 14px 0;
}
.assignment-diff > section {
  padding: 12px;
  min-width: 0;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 7px;
}
.assignment-diff label {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 10px 0;
  border-top: 1px solid var(--border);
  font-size: 11px;
  color: var(--muted);
}
.assignment-diff label strong,
.assignment-diff label > span {
  font-size: 12px;
  color: var(--text);
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.assignment-diff label.changed {
  border-left: 2px solid var(--accent);
  padding-left: 8px;
}
.assignment-diff pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 180px;
  overflow: auto;
  margin: 0;
  font-size: 11px;
  color: var(--text);
  font-family: inherit;
}
.deadline-conflict {
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 7px;
  margin-top: 10px;
  font-size: 12px;
}
.deadline-conflict p {
  line-height: 1.6;
  margin: 6px 0;
}
.website-options .check-label {
  font-size: 12px;
}
</style>
