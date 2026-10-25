<script setup lang="ts">
import { ref, watch, computed, onUnmounted } from 'vue';
import {
  Folder,
  File,
  FolderOpen,
  FolderPlus,
  Upload,
  RefreshCw,
  Link,
  ArrowLeft,
  Pencil,
} from 'lucide-vue-next';
import type { HomeworkEntry, HomeworkListing } from '../../shared/api';
import { useLibrary } from '../stores/library';
import Modal from '../components/Modal.vue';
const api = window.teachshelf,
  store = useLibrary(),
  course = ref(store.courseID ?? ''),
  relative = ref(''),
  listing = ref<HomeworkListing>(),
  editing = ref<HomeworkEntry | null | undefined>(undefined),
  name = ref('');
const loading = ref(false);
const mountedWorkspace = store.workspaceID;
let sequence = 0,
  active = true;
type Location = { workspace: string | undefined; course: string; relative: string };
let editingLocation: Location | undefined;
const location = (): Location => ({
  workspace: store.workspaceID,
  course: course.value,
  relative: relative.value,
});
const sameLocation = (value: Location) =>
  active &&
  value.workspace === store.workspaceID &&
  value.course === course.value &&
  value.relative === relative.value;
function closeEditor() {
  editing.value = undefined;
  editingLocation = undefined;
}
async function load() {
  if (!active || mountedWorkspace !== store.workspaceID) return;
  const request = ++sequence,
    target = location();
  listing.value = undefined;
  loading.value = true;
  try {
    const result = await store.run(
      () => api.listHomework(target.course || undefined, target.relative),
      '作业目录已读取',
    );
    if (result && request === sequence && sameLocation(target)) listing.value = result;
  } finally {
    if (active && request === sequence) loading.value = false;
  }
}
watch(
  course,
  () => {
    if (!active || mountedWorkspace !== store.workspaceID) return;
    relative.value = '';
    closeEditor();
    void load();
  },
  { immediate: true, flush: 'sync' },
);
watch(
  () => store.snapshot?.revision,
  () => {
    if (!active || mountedWorkspace !== store.workspaceID) return;
    if (course.value && !store.state.courses.some((item) => item.id === course.value))
      course.value = '';
    else void load();
  },
);
onUnmounted(() => {
  active = false;
  sequence++;
});
const crumbs = computed(() => relative.value.split('/').filter(Boolean));
async function go(value: string) {
  closeEditor();
  relative.value = value;
  await load();
}
async function importFiles() {
  if (loading.value || !listing.value) return;
  const target = location();
  const result = await store.run(() =>
    api.importHomework(target.course || undefined, target.relative),
  );
  if (result && sameLocation(target)) {
    await load();
    if (!sameLocation(target)) return;
    store.status = `已复制 ${result.imported} 份，跳过 ${result.skipped} 份`;
    if (result.errors.length) store.error = result.errors.join('\n');
  }
}
function edit(item?: HomeworkEntry) {
  if (loading.value || !listing.value) return;
  editingLocation = location();
  editing.value = item ?? null;
  name.value = item?.name ?? '';
}
async function save() {
  const item = editing.value,
    target = editingLocation;
  if (item === undefined || !target || !sameLocation(target) || loading.value) return;
  const result = await store.run(() =>
    item
      ? api.renameHomework(target.course || undefined, item.relativePath, name.value)
      : api.createHomeworkFolder(target.course || undefined, target.relative, name.value),
  );
  if (result && sameLocation(target) && editingLocation === target) {
    closeEditor();
    await load();
  }
}
async function mount(reset = false) {
  const target = location();
  if (
    reset &&
    !(await store.confirm(
      '恢复库内作业目录？',
      '外部作业文件保持原位置，之后显示课程内的作业目录。',
      '恢复默认',
    ))
  )
    return;
  if (!sameLocation(target)) return;
  const result = await store.run(() => api.mountHomework(target.course, reset));
  if (result && sameLocation(target)) {
    store.accept(result);
    relative.value = '';
    await load();
  }
}
</script>
<template>
  <section class="workspace">
    <header class="workspace-header">
      <div class="heading-block">
        <h1>作业文件夹</h1>
        <p>直接管理真实目录；复制导入保留原文件。</p>
      </div>
      <div class="toolbar-controls">
        <button v-if="course" :disabled="loading" @click="mount()">
          <Link :size="15" />挂载目录</button
        ><button v-if="listing?.mounted" :disabled="loading" @click="mount(true)">
          恢复默认目录</button
        ><button :disabled="loading || !listing" @click="edit()">
          <FolderPlus :size="15" />新建文件夹</button
        ><button class="primary" :disabled="loading || !listing" @click="importFiles">
          <Upload :size="15" />导入文件
        </button>
      </div>
    </header>
    <div class="filter-bar">
      <select v-model="course" aria-label="作业所属课程">
        <option value="">未分类作业</option>
        <option v-for="c in store.state.courses" :key="c.id" :value="c.id">
          {{ c.name }}
        </option></select
      ><span class="spacer" /><button @click="load"><RefreshCw :size="15" />刷新</button
      ><button
        v-if="listing"
        @click="store.run(() => api.revealHomework(course || undefined, relative))"
      >
        <FolderOpen :size="15" />文件位置
      </button>
    </div>
    <nav class="homework-crumb">
      <button @click="go('')">作业</button
      ><template v-for="(c, i) in crumbs" :key="i"
        ><span>/</span
        ><button @click="go(crumbs.slice(0, i + 1).join('/'))">{{ c }}</button></template
      ><span v-if="listing?.mounted" class="tag">外部挂载</span>
    </nav>
    <div class="homework-list">
      <button v-if="relative" class="homework-row" @click="go(crumbs.slice(0, -1).join('/'))">
        <ArrowLeft :size="18" />上一级
      </button>
      <div v-for="entry in listing?.entries" :key="entry.relativePath" class="homework-row">
        <button
          class="homework-entry"
          @dblclick="
            entry.isDirectory
              ? go(entry.relativePath)
              : store.run(() => api.openHomework(course || undefined, entry.relativePath))
          "
          @click="entry.isDirectory && go(entry.relativePath)"
        >
          <Folder v-if="entry.isDirectory" :size="21" /><File v-else :size="21" /><strong>{{
            entry.name
          }}</strong></button
        ><span class="muted small">{{
          entry.isDirectory ? '文件夹' : new Intl.NumberFormat('zh-CN').format(entry.size) + ' B'
        }}</span
        ><button class="icon-button" :aria-label="'重命名 ' + entry.name" @click="edit(entry)">
          <Pencil :size="15" /></button
        ><button
          class="icon-button"
          :aria-label="'显示 ' + entry.name"
          @click="store.run(() => api.revealHomework(course || undefined, entry.relativePath))"
        >
          <FolderOpen :size="16" />
        </button>
      </div>
      <div v-if="loading" class="empty-state" role="status">正在读取作业目录…</div>
      <div v-else-if="listing && !listing.entries.length" class="empty-state">
        <Folder :size="43" />
        <h2>目录里还没有文件</h2>
        <p>导入作业文件，或创建文件夹。</p>
      </div>
    </div>
    <p class="homework-location muted small wrap">{{ listing?.root }}</p>
    <Modal
      v-if="editing !== undefined"
      :title="editing ? '重命名' : '新建作业文件夹'"
      @close="closeEditor"
      ><form class="form-stack" @submit.prevent="save">
        <label>名称<input v-model="name" required maxlength="255" /></label>
        <div class="dialog-actions">
          <span class="spacer" /><button type="button" @click="closeEditor">取消</button
          ><button class="primary" :disabled="!name.trim() || !!store.busy || loading">
            保存名称
          </button>
        </div>
      </form></Modal
    >
  </section>
</template>
<style scoped>
.homework-crumb {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 12px 24px;
  border-bottom: 1px solid var(--border);
}
.homework-crumb button {
  border: 0;
  background: none;
  padding: 3px;
}
.homework-list {
  padding: 10px 24px;
  overflow: auto;
  flex: 1;
}
.homework-row {
  display: flex;
  align-items: center;
  gap: 16px;
  min-height: 52px;
  border-bottom: 1px solid var(--border);
  width: 100%;
  font-size: 13px;
}
.homework-entry {
  flex: 1;
  display: flex;
  gap: 12px;
  align-items: center;
  text-align: left;
  border: 0;
  background: none;
  box-shadow: none;
  min-width: 0;
}
.homework-entry strong {
  font-weight: 450;
  word-break: break-word;
}
.homework-entry svg {
  flex: none;
  color: var(--accent);
}
.homework-location {
  padding: 10px 24px;
  margin: 0;
}
.homework-crumb .tag {
  margin-left: auto;
}
</style>
