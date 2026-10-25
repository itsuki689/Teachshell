<script setup lang="ts">
const api = window.teachshelf;
import { computed, nextTick, onMounted, onUnmounted, ref, watchEffect } from 'vue';
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Search,
  Download,
  FolderOpen,
  LoaderCircle,
  Plus,
  RefreshCw,
  Settings,
  Upload,
  X,
} from 'lucide-vue-next';
import type { Course, StudyTask } from '../shared/model';
import { useLibrary } from './stores/library';
import Sidebar from './components/Sidebar.vue';
import CourseEditor from './components/CourseEditor.vue';
import ImportDialog from './components/ImportDialog.vue';
import Modal from './components/Modal.vue';
import WebsiteDialog from './components/WebsiteDialog.vue';
import TaskEditor from './components/TaskEditor.vue';
import WorkspaceSearch from './components/WorkspaceSearch.vue';
import type { WorkspaceSearchResult } from './composables/workspace-search';
import LibraryView from './views/LibraryView.vue';
import PlansView from './views/PlansView.vue';
import TimetableView from './views/TimetableView.vue';
import HomeworkView from './views/HomeworkView.vue';
import ChatView from './views/ChatView.vue';
import SettingsView from './views/SettingsView.vue';
const hasAPI = !!api;
const store = useLibrary(),
  courseEditor = ref<Course | null | undefined>(undefined),
  showImport = ref(false),
  showWebsite = ref(false),
  websiteKind = ref<'teaching' | 'timetable'>('teaching'),
  showTask = ref(false),
  searchedTask = ref<StudyTask | undefined>(),
  showSearch = ref(false),
  loaded = ref(false);
const releases: (() => void)[] = [];
const theme = computed(() => store.settings?.theme ?? store.state.appearance);
watchEffect(() => {
  document.documentElement.dataset.theme = theme.value;
  document.documentElement.style.setProperty('--accent', store.state.accentColor || '#39786B');
});
function openWebsite(kind: 'teaching' | 'timetable' = 'teaching') {
  websiteKind.value = kind;
  showWebsite.value = true;
}
function editCourse(course?: Course) {
  courseEditor.value = course ?? null;
}
async function activateSearch(result: WorkspaceSearchResult) {
  if (store.busy) return;
  if (result.kind === 'material') {
    if (!(await store.revealMaterial(result.id))) return;
  } else if (result.kind === 'course') {
    if (
      !store.state.courses.some((c) => c.id === result.id) ||
      !(await store.navigate('course:' + result.id))
    )
      return;
    store.searchNavigationID++;
  } else {
    const task = store.state.tasks.find((t) => t.id === result.id);
    if (!task || !(await store.requestLeave())) return;
    searchedTask.value = task;
  }
  showSearch.value = false;
}
function menu(action: string) {
  switch (action) {
    case 'search':
      showSearch.value = true;
      break;
    case 'back':
      void store.goBack();
      break;
    case 'forward':
      void store.goForward();
      break;
    case 'new-course':
    case 'create-course':
      editCourse();
      break;
    case 'import':
    case 'import-files':
      showImport.value = true;
      break;
    case 'settings':
      store.navigate('settings');
      break;
    case 'all':
      store.navigate('all');
      break;
    case 'plans':
      store.navigate('plans');
      break;
    case 'ai':
      store.navigate('assistant');
      break;
    case 'new-task':
    case 'new-plan':
      showTask.value = true;
      break;
    case 'open-library':
      void store.chooseLibrary(false);
      break;
    case 'import-library':
      void store.chooseLibrary(true);
      break;
    case 'sync':
      void store.change(() => api.sync(), '资料库已同步');
      break;
  }
}
function key(e: KeyboardEvent) {
  if (
    !document.querySelector('[role=dialog]') &&
    ((e.altKey && e.key === 'ArrowLeft') || ((e.metaKey || e.ctrlKey) && e.key === '['))
  ) {
    e.preventDefault();
    void store.goBack();
    return;
  }
  if (
    !document.querySelector('[role=dialog]') &&
    ((e.altKey && e.key === 'ArrowRight') || ((e.metaKey || e.ctrlKey) && e.key === ']'))
  ) {
    e.preventDefault();
    void store.goForward();
    return;
  }
  if (!(e.metaKey || e.ctrlKey)) return;
  if (e.key.toLowerCase() === 'k') {
    e.preventDefault();
    if (!document.querySelector('[role=dialog]')) showSearch.value = true;
    return;
  }
  if (e.key.toLowerCase() === 'o') {
    e.preventDefault();
    showImport.value = true;
  }
  if (e.key.toLowerCase() === 'n') {
    e.preventDefault();
    if (e.shiftKey) showTask.value = true;
    else editCourse();
  }
  if (e.key === ',') {
    e.preventDefault();
    store.navigate('settings');
  }
}
onMounted(async () => {
  if (!api) {
    store.error = '此界面需要从 Electron 桌面应用启动，请运行 npm run dev 或安装应用。';
    loaded.value = true;
    return;
  }
  releases.push(api.onChanged(store.accept), api.onMenu(menu));
  window.addEventListener('keydown', key);
  await store.refresh();
  const settings = await store.run(() => api.settings(), '本地资料库已就绪');
  if (settings) store.settings = settings;
  loaded.value = true;
});
onUnmounted(() => {
  releases.forEach((fn) => fn());
  window.removeEventListener('keydown', key);
});
</script>
<template>
  <div class="app-shell">
    <div class="titlebar">
      <span class="titlebar-brand">Teachshell</span><span class="titlebar-caption">课程与资料</span>
      <div class="titlebar-actions">
        <button
          class="icon-button"
          aria-label="后退"
          title="后退 · ⌘ / Ctrl ["
          :disabled="!store.canGoBack"
          @click="store.goBack()"
        >
          <ChevronLeft :size="17" />
        </button>
        <button
          class="icon-button"
          aria-label="前进"
          title="前进 · ⌘ / Ctrl ]"
          :disabled="!store.canGoForward"
          @click="store.goForward()"
        >
          <ChevronRight :size="17" />
        </button>
        <button
          class="icon-button"
          aria-label="全局搜索"
          title="全局搜索 · ⌘ / Ctrl K"
          :disabled="!store.snapshot"
          @click="showSearch = true"
        >
          <Search :size="17" />
        </button>
        <button
          class="icon-button"
          aria-label="同步文件"
          title="同步文件"
          :disabled="!!store.busy || !store.snapshot"
          @click="store.change(() => api.sync(), '资料库已同步')"
        >
          <RefreshCw :size="17" :class="{ spinning: store.busy }" /></button
        ><button
          class="icon-button"
          aria-label="打开设置"
          title="设置"
          @click="store.navigate('settings')"
        >
          <Settings :size="17" /></button
        ><button
          class="icon-button"
          aria-label="导入资料"
          title="导入资料 · ⌘ / Ctrl O"
          :disabled="!store.snapshot"
          @click="showImport = true"
        >
          <Upload :size="17" /></button
        ><button
          class="icon-button"
          aria-label="新建课程"
          title="新建课程 · ⌘ / Ctrl N"
          :disabled="!store.snapshot"
          @click="editCourse()"
        >
          <Plus :size="18" />
        </button>
      </div>
    </div>
    <div v-if="store.snapshot" class="app-body">
      <Sidebar @edit-course="editCourse" />
      <main class="main-pane">
        <LibraryView
          v-if="
            !['plans', 'pending', 'timetable', 'homework', 'assistant', 'settings'].includes(
              store.route,
            )
          "
          :key="store.route + ':' + store.searchNavigationID"
          @import="showImport = true"
          @edit-course="editCourse"
          @website="openWebsite()"
        /><PlansView
          v-else-if="store.route === 'plans' || store.route === 'pending'"
        /><TimetableView
          v-else-if="store.route === 'timetable'"
          @website="openWebsite('timetable')"
        /><HomeworkView v-else-if="store.route === 'homework'" /><SettingsView
          v-else-if="store.route === 'settings'"
          @website="openWebsite()"
        /><ChatView v-show="store.route === 'assistant'" />
        <footer class="statusbar">
          <LoaderCircle v-if="store.busy" :size="12" class="spinning" /><span
            v-else
            class="status-dot"
          /><span>{{ store.status }}</span
          ><span class="spacer" /><span
            >{{ store.state.courses.length }} 门课程 ·
            {{ store.state.materials.length }} 份资料</span
          ><span class="status-separator" /><span>本地资料库</span>
        </footer>
      </main>
    </div>
    <div v-else class="startup-state">
      <LoaderCircle v-if="!loaded" :size="30" class="spinning" /><AlertCircle v-else :size="30" />
      <h1>{{ loaded ? '资料库未能打开' : '正在打开课屿' }}</h1>
      <p>{{ loaded ? '请检查资料库路径和访问权限，再重新打开。' : '正在读取本地课程与资料…' }}</p>
      <button v-if="loaded && hasAPI" @click="store.chooseLibrary(false)">
        选择 Desktop 资料库
      </button>
    </div>
    <div v-if="store.error" class="error-toast" role="alert">
      <AlertCircle :size="18" />
      <div>
        <strong>操作未完成</strong>
        <p>{{ store.error }}</p>
      </div>
      <button class="icon-button" aria-label="关闭错误提示" @click="store.error = ''">
        <X :size="17" />
      </button>
    </div>
    <WorkspaceSearch
      v-if="showSearch"
      @close="showSearch = false"
      @activate="activateSearch"
    /><TaskEditor v-if="searchedTask" :task="searchedTask" @close="searchedTask = undefined" />
    <CourseEditor
      v-if="courseEditor !== undefined"
      :course="courseEditor ?? undefined"
      @close="courseEditor = undefined"
    /><ImportDialog v-if="showImport" @close="showImport = false" /><TaskEditor
      v-if="showTask"
      @close="showTask = false"
    /><WebsiteDialog
      v-if="showWebsite"
      :initial-kind="websiteKind"
      @close="showWebsite = false"
    /><Modal
      v-if="store.confirmRequest"
      :title="store.confirmRequest.title"
      @close="store.decide(false)"
      ><p class="confirm-detail">{{ store.confirmRequest.detail }}</p>
      <div class="dialog-actions">
        <span class="spacer" /><button @click="store.decide(false)">取消</button
        ><button class="primary" @click="store.decide(true)">
          {{ store.confirmRequest.action }}
        </button>
      </div></Modal
    >
  </div>
</template>
