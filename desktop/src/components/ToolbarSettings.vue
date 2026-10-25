<script setup lang="ts">
import { computed } from 'vue';
import { ArrowUp, ArrowDown, Minus, Plus } from 'lucide-vue-next';
import { useLibrary } from '../stores/library';
import {
  defaultToolbarActions,
  readToolbarActions,
  toolbarActions,
  toolbarTitles,
} from '../../shared/toolbar';
import type { ToolbarAction } from '../../shared/toolbar';
const store = useLibrary();
const actions = computed(() => readToolbarActions(store.state.toolbarSettings));
const available = computed(() =>
  toolbarActions.filter((action) => !actions.value.includes(action)),
);
function save(next: ToolbarAction[]) {
  const snapshot = store.snapshot;
  if (!snapshot || store.busy) return;
  return store.change(
    () =>
      window.teachshelf.saveToolbarSettings(next, {
        root: snapshot.root,
        revision: snapshot.revision,
      }),
    '顶栏已更新',
  );
}
function move(index: number, offset: number) {
  const next = [...actions.value];
  if (!next[index + offset]) return;
  [next[index], next[index + offset]] = [next[index + offset], next[index]];
  void save(next);
}
</script>
<template>
  <section class="settings-section toolbar-settings">
    <h2>自定义顶栏</h2>
    <div class="settings-card">
      <div class="setting-row">
        <div>
          <strong>{{ actions.length }} / 6 个操作</strong>
          <p>按下方顺序排列，随资料库保存。移除全部操作会隐藏快捷操作区域。</p>
        </div>
        <button
          :disabled="
            !!store.busy || JSON.stringify(actions) === JSON.stringify(defaultToolbarActions)
          "
          @click="save(defaultToolbarActions)"
        >
          恢复默认顶栏
        </button>
      </div>
      <ol class="toolbar-selected" aria-label="已选顶栏操作">
        <li v-for="(action, index) in actions" :key="action" :data-action="action">
          <span>{{ index + 1 }}. {{ toolbarTitles[action] }}</span
          ><button
            :aria-label="'上移' + toolbarTitles[action]"
            :disabled="!!store.busy || index === 0"
            @click="move(index, -1)"
          >
            <ArrowUp :size="15" /></button
          ><button
            :aria-label="'下移' + toolbarTitles[action]"
            :disabled="!!store.busy || index === actions.length - 1"
            @click="move(index, 1)"
          >
            <ArrowDown :size="15" /></button
          ><button
            :aria-label="'移除' + toolbarTitles[action]"
            :disabled="!!store.busy"
            @click="save(actions.filter((value) => value !== action))"
          >
            <Minus :size="15" />
          </button>
        </li>
      </ol>
      <p v-if="!actions.length" class="muted">快捷操作区域已隐藏；导航、搜索和系统菜单仍可使用。</p>
      <div class="toolbar-available">
        <button
          v-for="action in available"
          :key="action"
          :disabled="!!store.busy || actions.length >= 6"
          :aria-label="'添加' + toolbarTitles[action]"
          @click="save([...actions, action])"
        >
          <Plus :size="14" />{{ toolbarTitles[action] }}
        </button>
      </div>
      <p class="field-note">即使移除设置图标，也可通过侧栏或 ⌘ / Ctrl , 打开设置。</p>
    </div>
  </section>
</template>
<style scoped>
.toolbar-selected {
  list-style: none;
  padding: 0;
  margin: 0;
}
.toolbar-selected li {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 0;
  border-top: 1px solid var(--border);
}
.toolbar-selected span {
  flex: 1;
}
.toolbar-selected button {
  padding: 6px;
}
.toolbar-available {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 14px 0;
}
</style>
