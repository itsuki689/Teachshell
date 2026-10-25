<script setup lang="ts">
const api = window.teachshelf;
import { computed, ref, watch } from 'vue';
import { Archive } from 'lucide-vue-next';
import AppSymbol from './AppSymbol.vue';
import appIcon from '../../build-assets/icon.png';
import type { Course } from '../../shared/model';
import { useLibrary } from '../stores/library';
import { useWorkspaceUI } from '../stores/workspace-ui';
import { storeToRefs } from 'pinia';
const store = useLibrary();
const emit = defineEmits<{ editCourse: [course?: Course] }>();
const ui = useWorkspaceUI();
const { semester } = storeToRefs(ui);
const archive = ref('active');
watch(
  () => ui.identity,
  () => {
    archive.value = 'active';
  },
);
watch(
  () => [store.courseID, store.searchNavigationID] as const,
  ([id]) => {
    const course = store.state.courses.find((c) => c.id === id);
    if (!course) return;
    if (semester.value && course.semester !== semester.value) semester.value = course.semester;
    if (
      (course.isArchived && archive.value === 'active') ||
      (!course.isArchived && archive.value === 'archived')
    )
      archive.value = 'all';
  },
);
const semesters = computed(() => [
  ...new Set(store.state.courses.map((c) => c.semester).filter(Boolean)),
]);
const courses = computed(() =>
  store.state.courses.filter(
    (c) =>
      (!semester.value || c.semester === semester.value) &&
      (archive.value === 'all' || c.isArchived === (archive.value === 'archived')),
  ),
);
const nav = [
  { id: 'all', title: '全部资料', icon: 'tray-full' },
  { id: 'favorites', title: '我的收藏', icon: 'star' },
  { id: 'recent', title: '最近打开', icon: 'clock' },
  { id: 'unassigned', title: '未分类', icon: 'tray' },
  { id: 'homework', title: '作业文件夹', icon: 'folder' },
  { id: 'pending', title: '待完成计划', icon: 'checklist' },
];
async function drop(e: DragEvent, courseID?: string) {
  e.preventDefault();
  const raw = e.dataTransfer?.getData('application/x-teachshelf-ids');
  if (raw) {
    try {
      const ids = JSON.parse(raw);
      if (Array.isArray(ids) && ids.every((v) => typeof v === 'string'))
        await store.change(() => api.moveMaterials(ids, courseID), '资料已移动');
    } catch {
      store.error = '无法读取拖拽的资料';
    }
  } else if (e.dataTransfer?.files.length) {
    const files = Array.from(e.dataTransfer.files);
    await store.run(async () => {
      const r = await api.importDropped(files, { courseID, copy: true });
      await store.refresh();
      if (r.errors.length) store.error = r.errors.join('\n');
      store.status = `已导入 ${r.imported} 份，跳过 ${r.skipped} 份`;
    }, '文件导入完成');
  }
}
</script>
<template>
  <aside class="sidebar">
    <div class="brand">
      <img
        class="brand-app-icon"
        :src="appIcon"
        alt="Teachshell 应用图标"
        width="40"
        height="40"
        draggable="false"
      />
      <div><strong>Teachshell</strong><span>每一份知识，都有位置</span></div>
    </div>
    <select v-choice v-model="semester" aria-label="学期" class="semester">
      <option value="">全部学期</option>
      <option v-for="s in semesters" :key="s">{{ s }}</option>
    </select>
    <nav class="shortcuts" aria-label="快捷入口">
      <button
        v-for="n in nav"
        :key="n.id"
        :title="n.title"
        :aria-label="n.title"
        :aria-current="store.route === n.id ? 'page' : undefined"
        :class="{ active: store.route === n.id }"
        @click="store.navigate(n.id)"
        @dragover.prevent
        @drop="n.id === 'unassigned' && drop($event)"
      >
        <AppSymbol :name="n.icon" :size="18" />
      </button>
    </nav>
    <nav class="paired-nav">
      <button
        :class="{ active: store.route === 'plans' || store.route === 'timetable' }"
        @click="ui.openSchedule()"
      >
        <AppSymbol name="calendar" :size="17" />计划</button
      ><button
        :class="{ active: store.route === 'assistant' }"
        @click="store.navigate('assistant')"
      >
        <AppSymbol name="sparkles" :size="17" />AI 助手
      </button>
    </nav>
    <div class="sidebar-section">
      <select v-choice v-model="archive" aria-label="课程状态">
        <option value="active">当前课程</option>
        <option value="archived">已归档课程</option>
        <option value="all">全部课程</option></select
      ><button
        class="icon-button"
        title="新建课程"
        aria-label="新建课程"
        @click="emit('editCourse')"
      >
        <AppSymbol name="plus" :size="16" />
      </button>
    </div>
    <nav class="course-list" aria-label="课程">
      <button
        v-for="c in courses"
        :key="c.id"
        class="course-row"
        :class="{ active: store.courseID === c.id }"
        :style="{ '--course-color': c.colorHex }"
        :title="[c.name, c.teacher, c.semester].filter(Boolean).join(' · ')"
        @click="store.navigate('course:' + c.id)"
        @dblclick="emit('editCourse', c)"
        @contextmenu.prevent="emit('editCourse', c)"
        @dragover.prevent
        @drop="drop($event, c.id)"
      >
        <span class="course-marker" /><span class="course-label"
          ><span>{{ c.name }}</span
          ><small v-if="c.teacher">{{ c.teacher }}</small></span
        ><Archive v-if="c.isArchived" :size="12" /><span class="count">{{
          store.state.materials.filter((m) => m.courseID === c.id).length
        }}</span>
      </button>
      <p v-if="!courses.length" class="sidebar-empty">添加课程，开始整理资料</p>
    </nav>
  </aside>
</template>
