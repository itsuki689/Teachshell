<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { History, RefreshCw } from 'lucide-vue-next';
import type { MaterialVersions } from '../../shared/api';
import { dateMs } from '../../shared/model';
import { useLibrary } from '../stores/library';
import Modal from './Modal.vue';
import PreviewDialog from './PreviewDialog.vue';
const props = defineProps<{ materialId: string }>(),
  emit = defineEmits<{ close: [] }>(),
  store = useLibrary(),
  api = window.teachshelf;
const listing = ref<(MaterialVersions & { revision: string; proposalID: string }) | null>(null),
  selected = ref(''),
  preview = ref<{ id: string; url: string; mime: string; name: string } | null>(null);
const version = computed(() => listing.value?.versions.find((item) => item.id === selected.value)),
  stale = computed(() => listing.value?.revision !== store.snapshot?.revision);
async function load() {
  const value = await store.run(() => api.listMaterialVersions(props.materialId), '资料版本已读取');
  if (value) {
    listing.value = value;
    selected.value = value.versions.find((item) => !item.isCurrent)?.id ?? value.currentID ?? '';
  }
}
onMounted(load);
async function restore() {
  const value = listing.value,
    item = version.value,
    root = store.snapshot?.root;
  if (!value?.currentID || !item || item.isCurrent || item.isMissing || stale.value) return;
  if (
    !(await store.confirm(
      '恢复这个资料版本？',
      '将使用所选内容创建新的当前版本。现有当前文件和所有历史版本都会保留。',
      '创建恢复版本',
    ))
  )
    return;
  if (root !== store.snapshot?.root || listing.value !== value || stale.value) {
    store.error = '资料库或版本记录已变化，请重新打开版本历史。';
    return;
  }
  const result = await store.run(
    () => api.restoreMaterialVersion(value.currentID!, item.id, value.revision, value.proposalID),
    '历史内容已恢复为新版本',
  );
  if (result) {
    store.accept(result.snapshot);
    await store.revealMaterial(result.materialID);
    store.status = result.message;
    emit('close');
  }
}
async function showPreview() {
  if (!version.value) return;
  const id = version.value.id;
  const value = await store.run(() => api.previewMaterial(id), '版本预览已打开');
  if (value) preview.value = { id, ...value };
}
function size(bytes: number) {
  return bytes < 1024 ? bytes + ' B' : (bytes / 1024).toFixed(1) + ' KB';
}
</script>
<template>
  <Modal title="资料版本历史" wide @close="emit('close')"
    ><div class="form-stack">
      <p class="muted">
        每次网站正文更新都会保留之前的文件。恢复会创建新的当前版本，已有文件均保留。
      </p>
      <div class="setting-actions">
        <button :disabled="!!store.busy" @click="load"><RefreshCw :size="15" />刷新版本记录</button
        ><span class="small muted">{{ listing?.versions.length ?? 0 }} 个版本</span>
      </div>
      <p v-if="listing && stale" class="warning-banner">资料库已变化，请刷新版本记录后再恢复。</p>
      <div v-if="listing" class="version-list">
        <label
          v-for="item in listing.versions"
          :key="item.id"
          class="version-row"
          :class="{ selected: selected === item.id }"
          :data-version-id="item.id"
          ><input
            type="radio"
            v-model="selected"
            :value="item.id"
            name="material-version"
            :aria-label="'选择版本 ' + item.title"
          /><History :size="19" /><span
            ><strong>{{ item.title }}</strong
            ><small
              >{{ item.originalName }} · {{ size(item.size) }} ·
              {{ new Date(dateMs(item.addedAt)).toLocaleString('zh-CN') }}</small
            ><code v-if="item.digest">SHA-256 {{ item.digest.slice(0, 16) }}…</code></span
          ><span class="tag">{{ item.isCurrent ? '当前版本' : '历史版本' }}</span
          ><span v-if="item.isMissing" class="tag">文件缺失</span></label
        >
      </div>
      <p v-if="listing" class="field-note wrap">来源：{{ listing.sourcePath }}</p>
      <div class="dialog-actions">
        <button :disabled="!version || version.isMissing || !!store.busy" @click="showPreview">
          预览所选版本</button
        ><span class="spacer" /><button @click="emit('close')">关闭</button
        ><button
          class="primary"
          :disabled="!version || version.isCurrent || version.isMissing || stale || !!store.busy"
          @click="restore"
        >
          恢复为新版本
        </button>
      </div>
    </div></Modal
  ><PreviewDialog v-if="preview" :id="preview.id" :preview="preview" @close="preview = null" />
</template>
<style scoped>
.version-list {
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
}
.version-list .version-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 10px;
  padding: 14px;
  border-bottom: 1px solid var(--border);
  cursor: pointer;
}
.version-row input[type='radio'] {
  width: 15px;
  height: 15px;
  min-height: 0;
  padding: 0;
  flex: 0 0 15px;
  accent-color: var(--accent);
}
.version-row:last-child {
  border: 0;
}
.version-row.selected {
  background: var(--accent-soft);
}
.version-row > span:first-of-type {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  gap: 7px;
}
.version-row strong {
  font-size: 13px;
  overflow-wrap: anywhere;
}
.version-row small,
.version-row code {
  font-size: 10px;
  color: var(--muted);
  overflow-wrap: anywhere;
}
.version-row svg {
  color: var(--accent);
  flex-shrink: 0;
}
</style>
