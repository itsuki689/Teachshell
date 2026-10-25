<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { BookOpen, CalendarDays, FileText, Search } from 'lucide-vue-next';
import { workspaceSearch } from '../composables/workspace-search';
import type { WorkspaceSearchResult } from '../composables/workspace-search';
import { useLibrary } from '../stores/library';
import Modal from './Modal.vue';
const emit = defineEmits<{ close: []; activate: [result: WorkspaceSearchResult] }>(),
  store = useLibrary(),
  query = ref(''),
  active = ref(0),
  input = ref<HTMLInputElement>();
const results = computed(() => workspaceSearch(query.value, store.state));
const labels = { course: '课程', material: '资料', plan: '计划' },
  icons = { course: BookOpen, material: FileText, plan: CalendarDays };
watch(results, () => {
  active.value = 0;
});
onMounted(async () => {
  await nextTick();
  input.value?.focus();
});
function key(event: KeyboardEvent) {
  if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
    event.preventDefault();
    if (results.value.length)
      active.value =
        (active.value + (event.key === 'ArrowDown' ? 1 : -1) + results.value.length) %
        results.value.length;
  } else if (event.key === 'Enter' && results.value[active.value]) {
    event.preventDefault();
    emit('activate', results.value[active.value]);
  }
}
</script>
<template>
  <Modal title="全局搜索" @close="emit('close')"
    ><div class="workspace-search">
      <label class="search-field"
        ><Search :size="18" /><input
          ref="input"
          v-model="query"
          aria-label="搜索课程、资料和计划"
          placeholder="搜索课程、资料、计划；空格分隔多个关键词"
          @keydown="key"
      /></label>
      <p class="field-note">每类最多显示 6 条结果。↑ ↓ 选择，Enter 打开。</p>
      <p v-if="!query.trim()" class="search-empty">
        搜索课程名称、教师、资料备注、标签或计划内容。
      </p>
      <p v-else-if="!results.length" class="search-empty">没有匹配的课程、资料或计划。</p>
      <div
        v-for="kind in ['course', 'material', 'plan'] as const"
        :key="kind"
        class="search-result-group"
      >
        <template v-if="results.some((r) => r.kind === kind)"
          ><h3>{{ labels[kind] }}</h3>
          <button
            v-for="result in results.filter((r) => r.kind === kind)"
            :key="result.kind + result.id"
            class="search-result"
            :class="{ active: results.indexOf(result) === active }"
            :aria-label="'打开' + labels[kind] + ' ' + result.title"
            @mouseenter="active = results.indexOf(result)"
            @click="emit('activate', result)"
          >
            <component :is="icons[result.kind]" :size="20" :style="{ color: result.color }" /><span
              ><strong>{{ result.title }}</strong
              ><small>{{ result.detail }}</small></span
            ><span class="search-result-kind">{{ labels[result.kind] }}</span>
          </button></template
        >
      </div>
    </div></Modal
  >
</template>
<style scoped>
.workspace-search .search-field {
  width: 100%;
}
.search-empty {
  padding: 28px 8px;
  color: var(--muted);
  font-size: 13px;
  text-align: center;
}
.search-result-group h3 {
  font-size: 11px;
  color: var(--muted);
  margin: 18px 0 7px;
}
.search-result {
  display: flex;
  align-items: center;
  width: 100%;
  text-align: left;
  gap: 12px;
  padding: 11px 10px;
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
  gap: 5px;
}
.search-result strong {
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.search-result small {
  color: var(--muted);
  font-size: 11px;
  line-height: 1.5;
}
.search-result-kind {
  color: var(--muted);
  font-size: 10px;
}
.search-result svg {
  flex-shrink: 0;
}
</style>
