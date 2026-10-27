<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import AppSymbol from './AppSymbol.vue';
import { toolbarSymbols } from './symbols';
import { readToolbarActions, toolbarTitles } from '../../shared/toolbar';
import type { ToolbarAction, ToolbarRequest } from '../../shared/toolbar';
import { useLibrary } from '../stores/library';
const store = useLibrary(),
  menu = ref(false),
  root = ref<HTMLElement>();
const props = defineProps<{ activate: (action: ToolbarRequest) => Promise<boolean> }>();
const actions = computed(() => readToolbarActions(store.state.toolbarSettings));
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const createRotation = ref(0),
  pendingUpdate = ref(false);
const animations = new Set<Animation>();

function artwork(action: ToolbarAction) {
  return root.value?.querySelector<HTMLElement>(`[data-toolbar-artwork="${action}"]`);
}
function animate(
  element: Element | null | undefined,
  frames: Keyframe[],
  duration: number,
  easing = 'ease-out',
) {
  if (!element || reduced.matches || document.hidden) return;
  const animation = element.animate(frames, { duration, easing });
  animations.add(animation);
  void animation.finished.then(
    () => animations.delete(animation),
    () => animations.delete(animation),
  );
  return animation;
}
function help(action: ToolbarAction) {
  if (action === 'update') return pendingUpdate.value ? '正在刷新当前页面…' : '刷新当前页面';
  if (action === 'settings') return store.route === 'settings' ? '关闭设置，返回上一页面' : '设置';
  if (action === 'create') return menu.value ? '关闭新建菜单' : '新建课程、计划或连接教学网站';
  if (action === 'import') return '导入文件或文件夹 · ⌘ / Ctrl O';
  return toolbarTitles[action];
}

async function activate(action: ToolbarAction) {
  if (!store.snapshot || store.busy) return;
  if (action === 'create') {
    menu.value = !menu.value;
    if (menu.value) {
      await nextTick();
      root.value?.querySelector<HTMLButtonElement>('[role=menuitem]')?.focus();
    }
    return;
  }
  menu.value = false;
  if (action === 'update') {
    if (pendingUpdate.value) return;
    pendingUpdate.value = true;
    const animation = animate(
      artwork(action),
      [{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }],
      400,
      'linear',
    );
    try {
      // Start the real refresh immediately; animation never schedules or cancels work.
      await Promise.all([props.activate(action), animation?.finished.catch(() => {})]);
    } finally {
      pendingUpdate.value = false;
    }
    return;
  }
  if (!(await props.activate(action))) return;
  if (action === 'settings') {
    animate(artwork(action), [{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], 420);
  } else if (action === 'import') {
    animate(
      artwork(action)?.querySelector('[data-icon-part="import-arrows"]'),
      [{ transform: 'translateY(0px)' }, { transform: 'translateY(16px)' }],
      400,
      'linear',
    );
  }
}
async function create(action: 'create-course' | 'create-plan' | 'connect-website') {
  menu.value = false;
  await props.activate(action);
}
function outside(e: PointerEvent) {
  if (!root.value?.contains(e.target as Node)) {
    menu.value = false;
  }
}
function key(e: KeyboardEvent) {
  if (!menu.value) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    menu.value = false;
    root.value?.querySelector<HTMLButtonElement>('[data-toolbar-action=create]')?.focus();
  }
}
function menuKey(e: KeyboardEvent) {
  if (e.key === 'Tab') {
    menu.value = false;
    return;
  }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
  e.preventDefault();
  e.stopPropagation();
  const items = Array.from(
    root.value?.querySelectorAll<HTMLButtonElement>('[role=menuitem]') || [],
  );
  const index = items.indexOf(document.activeElement as HTMLButtonElement);
  const next =
    e.key === 'Home'
      ? 0
      : e.key === 'End'
        ? items.length - 1
        : (index + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
  items[next]?.focus();
}
watch(
  menu,
  (expanded) => {
    createRotation.value += expanded ? 1125 : 315;
  },
  { flush: 'sync' },
);
watch([() => actions.value.join(','), () => store.route, () => store.workspaceID], () => {
  menu.value = false;
});
function motionChanged() {
  if (reduced.matches) for (const animation of animations) animation.finish();
}
function visibilityChanged() {
  if (document.hidden) {
    menu.value = false;
    for (const animation of animations) animation.finish();
  }
}
onMounted(() => {
  window.addEventListener('pointerdown', outside);
  window.addEventListener('keydown', key);
  reduced.addEventListener('change', motionChanged);
  document.addEventListener('visibilitychange', visibilityChanged);
});
onUnmounted(() => {
  for (const animation of animations) animation.cancel();
  window.removeEventListener('pointerdown', outside);
  window.removeEventListener('keydown', key);
  reduced.removeEventListener('change', motionChanged);
  document.removeEventListener('visibilitychange', visibilityChanged);
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
            ? menu
              ? '关闭新建菜单'
              : '快捷新建'
            : toolbarTitles[action]
      "
      :title="help(action)"
      :aria-haspopup="action === 'create' ? 'menu' : undefined"
      :aria-expanded="action === 'create' ? menu : undefined"
      :aria-pressed="action === 'settings' ? store.route === 'settings' : undefined"
      :aria-busy="action === 'update' ? pendingUpdate : undefined"
      :disabled="!store.snapshot || !!store.busy || (action === 'update' && pendingUpdate)"
      @click="activate(action)"
    >
      <span
        class="toolbar-artwork"
        :data-toolbar-artwork="action"
        :style="
          action === 'create'
            ? {
                transform: `rotate(${createRotation}deg)`,
                transitionDuration: menu ? '720ms' : '180ms',
              }
            : undefined
        "
      >
        <AppSymbol :name="toolbarSymbols[action]" :size="18" />
      </span>
    </button>
    <div v-if="menu" class="quick-create" role="menu" aria-label="快捷新建菜单" @keydown="menuKey">
      <button role="menuitem" @click="create('create-course')">
        <AppSymbol name="books" :size="16" />新建课程…</button
      ><button role="menuitem" @click="create('create-plan')">
        <AppSymbol name="calendar-plus" :size="16" />新建计划…
      </button>
      <button role="menuitem" @click="create('connect-website')">
        <AppSymbol name="globe" :size="16" />连接教学网站…
      </button>
    </div>
  </div>
</template>
<style scoped>
.workspace-shortcuts {
  display: flex;
  position: relative;
  align-items: center;
  flex: 0 0 auto;
  height: 36px;
  border-radius: 18px;
  box-shadow:
    inset 0 0 0 0.6px var(--border),
    0 1px 2px #0001;
  -webkit-app-region: no-drag;
}
.workspace-shortcuts > button {
  width: 36px;
  height: 36px;
  min-width: 36px;
  padding: 0;
  border-radius: 50%;
  -webkit-app-region: no-drag;
}
.workspace-shortcuts > button:active:not(:disabled) {
  transform: none;
  background: var(--selection);
}
.toolbar-artwork {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  pointer-events: none;
}
.toolbar-artwork[data-toolbar-artwork='create'] {
  transition-property: transform;
  transition-timing-function: ease-out;
}
.toolbar-artwork[data-toolbar-artwork='create'] :deep(svg) {
  stroke-width: 2.2;
}
.toolbar-artwork[data-toolbar-artwork='import'] :deep(svg) {
  stroke-width: 1.65;
}
@media (prefers-reduced-motion: reduce) {
  .toolbar-artwork {
    transition: none !important;
  }
}
@media (prefers-contrast: more) {
  .workspace-shortcuts {
    box-shadow: inset 0 0 0 1px var(--text);
  }
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
  -webkit-app-region: no-drag;
}
.quick-create button {
  display: flex;
  justify-content: flex-start;
  width: 100%;
  text-align: left;
  border: 0;
  background: transparent;
}
.quick-create button:hover {
  background: var(--accent-soft);
}
.quick-create button {
  min-height: 34px;
  padding: 8px 10px;
}
.quick-create button:last-child {
  margin-top: 5px;
  border-top: 1px solid var(--border);
  border-radius: 0 0 5px 5px;
}
</style>
