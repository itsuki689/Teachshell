<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import {
  RefreshCw,
  Settings,
  Upload,
  Plus,
  CalendarDays,
  Library,
  Star,
  Clock,
  FolderOpen,
  ListTodo,
} from 'lucide-vue-next';
import { readToolbarActions, toolbarTitles } from '../../shared/toolbar';
import type { ToolbarAction } from '../../shared/toolbar';
import { useLibrary } from '../stores/library';
const store = useLibrary(),
  menu = ref(false),
  root = ref<HTMLElement>();
const emit = defineEmits<{
  action: [action: ToolbarAction | 'create-course' | 'create-plan' | 'connect-website'];
}>();
const actions = computed(() => readToolbarActions(store.state.toolbarSettings));
const icons = {
  update: RefreshCw,
  settings: Settings,
  import: Upload,
  create: Plus,
  schedule: CalendarDays,
  allMaterials: Library,
  favorites: Star,
  recent: Clock,
  homework: FolderOpen,
  pendingTasks: ListTodo,
};
function activate(action: ToolbarAction) {
  if (action === 'create') menu.value = !menu.value;
  else {
    menu.value = false;
    emit('action', action);
  }
}
function create(action: 'create-course' | 'create-plan' | 'connect-website') {
  menu.value = false;
  emit('action', action);
}
function outside(e: PointerEvent) {
  if (!root.value?.contains(e.target as Node)) menu.value = false;
}
function key(e: KeyboardEvent) {
  if (e.key === 'Escape') menu.value = false;
}
watch([actions, () => store.route, () => store.snapshot?.root], () => {
  menu.value = false;
});
onMounted(() => {
  window.addEventListener('pointerdown', outside);
  window.addEventListener('keydown', key);
});
onUnmounted(() => {
  window.removeEventListener('pointerdown', outside);
  window.removeEventListener('keydown', key);
});
</script>
<template>
  <div v-if="actions.length" ref="root" class="workspace-shortcuts" aria-label="自定义顶栏">
    <button
      v-for="action in actions"
      :key="action"
      class="icon-button"
      :data-toolbar-action="action"
      :aria-label="
        action === 'settings'
          ? store.route === 'settings'
            ? '关闭设置'
            : '打开设置'
          : action === 'create'
            ? '快捷新建'
            : toolbarTitles[action]
      "
      :title="toolbarTitles[action]"
      :aria-expanded="action === 'create' ? menu : undefined"
      :disabled="!!store.busy || (action === 'update' && !store.state.teachingConnections.length)"
      @click="activate(action)"
    >
      <component :is="icons[action]" :size="18" />
    </button>
    <div v-if="menu" class="quick-create" role="menu" aria-label="快捷新建菜单">
      <button role="menuitem" @click="create('create-course')">新建课程…</button
      ><button role="menuitem" @click="create('create-plan')">新建计划…</button
      ><button role="menuitem" @click="create('connect-website')">连接教学网站…</button>
    </div>
  </div>
</template>
<style scoped>
.workspace-shortcuts {
  display: flex;
  position: relative;
  align-items: center;
}
.quick-create {
  position: absolute;
  z-index: 100;
  right: 0;
  top: 44px;
  padding: 6px;
  width: 210px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 8px 24px #0002;
}
.quick-create button {
  display: block;
  width: 100%;
  text-align: left;
  border: 0;
  background: transparent;
}
.quick-create button:hover {
  background: var(--accent-soft);
}
</style>
