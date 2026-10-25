<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, useId, watch } from 'vue';
import { BookOpen, CalendarDays, FileText, Search, X } from 'lucide-vue-next';
import { workspaceSearch } from '../composables/workspace-search';
import type { WorkspaceSearchResult } from '../composables/workspace-search';
import { useLibrary } from '../stores/library';
const props = defineProps<{ activate: (result: WorkspaceSearchResult) => Promise<boolean> }>();
const store = useLibrary(),
  query = ref(''),
  active = ref(0),
  opened = ref(false),
  selecting = ref(false),
  root = ref<HTMLElement>(),
  input = ref<HTMLInputElement>();
const listID = `workspace-search-${useId()}`;
const results = computed(() => workspaceSearch(query.value, store.state));
const expanded = computed(() => opened.value && !!query.value.trim() && !!store.snapshot);
const labels = { course: '课程', material: '资料', plan: '计划' },
  icons = { course: BookOpen, material: FileText, plan: CalendarDays };
const optionID = (index: number) => `${listID}-${index}`;
watch(results, () => {
  active.value = 0;
});
watch(() => store.workspaceID, reset);
watch(
  () => store.route,
  () => {
    opened.value = false;
  },
);
function reset() {
  query.value = '';
  opened.value = false;
  active.value = 0;
}
function focus() {
  if (!store.snapshot || store.busy || selecting.value) return;
  input.value?.focus();
  input.value?.select();
  opened.value = true;
}
defineExpose({ focus });
function outside(event: Event) {
  if (!root.value?.contains(event.target as Node)) opened.value = false;
}
async function choose(result: WorkspaceSearchResult) {
  if (store.busy || selecting.value) return;
  const workspace = store.workspaceID;
  selecting.value = true;
  opened.value = false;
  try {
    if (await props.activate(result)) {
      if (workspace === store.workspaceID) {
        reset();
        input.value?.blur();
      }
    }
  } finally {
    selecting.value = false;
  }
}
async function key(event: KeyboardEvent) {
  // Enter confirms an IME candidate before it can activate a search result.
  if (event.isComposing || event.keyCode === 229) return;
  if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
    event.preventDefault();
    if (results.value.length) {
      active.value = !expanded.value
        ? event.key === 'ArrowDown'
          ? 0
          : results.value.length - 1
        : (active.value + (event.key === 'ArrowDown' ? 1 : -1) + results.value.length) %
          results.value.length;
      opened.value = true;
      await nextTick();
      document.getElementById(optionID(active.value))?.scrollIntoView({ block: 'nearest' });
    }
  } else if (event.key === 'Enter') {
    event.preventDefault();
    if (results.value[active.value]) await choose(results.value[active.value]);
  } else if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    reset();
  } else if (event.key === 'Tab') {
    opened.value = false;
  }
}
onMounted(() => {
  window.addEventListener('pointerdown', outside);
  window.addEventListener('focusin', outside);
});
onUnmounted(() => {
  window.removeEventListener('pointerdown', outside);
  window.removeEventListener('focusin', outside);
});
</script>
<template>
  <div ref="root" class="workspace-search" role="search" aria-label="全局搜索">
    <div class="workspace-search-field">
      <Search :size="17" aria-hidden="true" />
      <input
        ref="input"
        v-model="query"
        role="combobox"
        aria-label="搜索课程、资料和计划"
        aria-autocomplete="list"
        :aria-expanded="expanded"
        :aria-controls="listID"
        :aria-activedescendant="expanded && results[active] ? optionID(active) : undefined"
        :aria-busy="selecting"
        :disabled="!store.snapshot"
        placeholder="搜索课程、资料与计划"
        title="全局搜索 · ⌘ / Ctrl K"
        autocomplete="off"
        spellcheck="false"
        @focus="opened = !selecting"
        @input="opened = true"
        @keydown="key"
      />
      <button
        v-if="query"
        class="clear-search"
        aria-label="清除全局搜索"
        title="清除搜索"
        @click="
          reset();
          focus();
        "
      >
        <X :size="14" />
      </button>
    </div>
    <div v-if="expanded" class="workspace-search-results">
      <p class="search-hint">每类最多 6 条 · ↑ ↓ 选择，Enter 打开</p>
      <p v-if="!results.length" class="search-empty" role="status">没有匹配的课程、资料或计划。</p>
      <div :id="listID" role="listbox" aria-label="全局搜索结果">
        <div
          v-for="kind in ['course', 'material', 'plan'] as const"
          v-show="results.some((r) => r.kind === kind)"
          :key="kind"
          class="search-result-group"
          role="group"
          :aria-label="labels[kind]"
        >
          <h3 aria-hidden="true">{{ labels[kind] }}</h3>
          <button
            v-for="result in results.filter((r) => r.kind === kind)"
            :id="optionID(results.indexOf(result))"
            :key="result.kind + result.id"
            role="option"
            tabindex="-1"
            class="search-result"
            :class="{ active: results.indexOf(result) === active }"
            :aria-selected="results.indexOf(result) === active"
            :aria-label="'打开' + labels[kind] + ' ' + result.title"
            :disabled="selecting || !!store.busy"
            @mouseenter="active = results.indexOf(result)"
            @pointerdown.prevent
            @click="choose(result)"
          >
            <component :is="icons[result.kind]" :size="18" :style="{ color: result.color }" />
            <span
              ><strong>{{ result.title }}</strong
              ><small>{{ result.detail }}</small></span
            >
            <span class="search-result-kind">{{ labels[result.kind] }}</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
<style scoped>
.workspace-search {
  position: relative;
  flex: 1;
  min-width: 120px;
  max-width: 520px;
  margin: 0 auto;
  -webkit-app-region: no-drag;
}
.workspace-search-field {
  display: flex;
  align-items: center;
  height: 34px;
  padding: 0 12px;
  gap: 8px;
  border-radius: 18px;
  background: var(--surface);
  color: var(--muted);
}
.workspace-search-field:focus-within {
  box-shadow: inset 0 0 0 1.5px var(--accent);
}
.workspace-search-field input {
  width: 100%;
  min-width: 0;
  min-height: 0;
  height: 100%;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
  font-size: 12px;
  color: var(--text);
  text-overflow: ellipsis;
}
.workspace-search-field input::placeholder {
  color: var(--muted);
}
.clear-search {
  flex: 0 0 22px;
  width: 22px;
  height: 22px;
  min-height: 0;
  padding: 0;
  border: 0;
  border-radius: 50%;
  color: var(--muted);
  background: transparent;
}
.workspace-search-results {
  position: absolute;
  z-index: 120;
  top: calc(100% + 8px);
  left: 0;
  width: 100%;
  max-height: min(430px, calc(100vh - 76px));
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: var(--shadow);
  background: var(--bg);
}
.search-hint {
  padding: 3px 5px;
  font-size: 11px;
  color: var(--muted);
}
.search-empty {
  padding: 22px 8px;
  color: var(--muted);
  font-size: 12px;
  text-align: center;
}
.search-result-group h3 {
  font-size: 11px;
  color: var(--muted);
  margin: 10px 5px 4px;
}
.search-result {
  display: flex;
  align-items: center;
  width: 100%;
  text-align: left;
  gap: 9px;
  padding: 8px;
  border: 0;
  background: transparent;
  margin: 2px 0;
}
.search-result.active {
  background: var(--accent-soft);
}
.search-result > span:first-of-type {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  gap: 3px;
}
.search-result strong,
.search-result small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.search-result strong {
  font-size: 12px;
}
.search-result small {
  color: var(--muted);
  font-size: 11px;
  line-height: 1.5;
}
.search-result-kind {
  color: var(--muted);
  font-size: 10px;
  flex-shrink: 0;
}
</style>
