<script setup lang="ts">
const api = window.teachshelf;
import { computed, nextTick, onUnmounted, reactive, ref, watch } from 'vue';
import { ExternalLink, FolderOpen, History, Save, Star, X } from 'lucide-vue-next';
import { dateMs } from '../../shared/model';
import type { Material } from '../../shared/model';
import { useLibrary } from '../stores/library';
import MaterialVersions from './MaterialVersions.vue';
const showVersions = ref(false);
async function openVersions() {
  if (await store.requestLeave()) showVersions.value = true;
}
import { useUnsavedCloseGuard } from '../composables/useUnsavedCloseGuard';
const props = defineProps<{ material: Material }>(),
  emit = defineEmits<{ close: []; preview: [id: string] }>(),
  store = useLibrary();
const form = reactive({ title: '', category: '', tags: '', notes: '', filename: '' }),
  initial = ref('');
const saving = ref(false);
let active = true;
function materialForm(material = props.material) {
  return {
    title: material.title,
    category: material.category,
    tags: material.tags,
    notes: material.notes,
    filename: material.originalName,
  };
}
function reset() {
  Object.assign(form, materialForm());
  initial.value = JSON.stringify(form);
}
watch(() => props.material.id, reset, { immediate: true });
const dirty = computed(() => JSON.stringify(form) !== initial.value);
useUnsavedCloseGuard(() => dirty.value);
const releaseLeaveGuard = store.registerLeaveGuard(async () => {
  if (!dirty.value) return true;
  const approved = await store.confirm(
    '丢弃未保存的资料修改？',
    '当前标题、标签或备注尚未保存。选择取消可继续编辑。',
    '丢弃修改',
  );
  if (approved) reset();
  return approved;
});
onUnmounted(releaseLeaveGuard);
onUnmounted(() => {
  active = false;
});
async function close() {
  if (await store.requestLeave()) emit('close');
}
watch(
  () => props.material,
  () => {
    if (!dirty.value) reset();
  },
  { deep: true },
);
async function save() {
  if (saving.value) return;
  const submitted = { ...form },
    targetID = props.material.id,
    workspace = store.workspaceID;
  const baseline = JSON.parse(initial.value) as typeof form;
  const patch: Partial<Material> & { filename?: string } = {},
    expected: Partial<Material> & { filename?: string } = {};
  for (const key of ['title', 'category', 'tags', 'notes', 'filename'] as const) {
    if (form[key] !== baseline[key]) {
      patch[key] = form[key];
      expected[key] = baseline[key];
    }
  }
  saving.value = true;
  try {
    const result = await store.change(
      () => api.updateMaterial(targetID, patch, expected),
      '资料信息已保存',
    );
    if (result) {
      await nextTick();
      if (!active || workspace !== store.workspaceID || props.material.id !== targetID) return;
      const saved = result.state.materials.find((material) => material.id === targetID);
      if (!saved) return;
      const current = materialForm(),
        committed = materialForm(saved),
        nextBaseline = { ...current },
        continued = { ...form };
      for (const key of ['title', 'category', 'tags', 'notes', 'filename'] as const) {
        if (continued[key] === submitted[key]) form[key] = current[key];
        else {
          // A later snapshot must not silently authorize overwriting another edit.
          nextBaseline[key] = key in patch ? committed[key] : baseline[key];
          form[key] = continued[key];
        }
      }
      initial.value = JSON.stringify(nextBaseline);
    }
  } finally {
    saving.value = false;
  }
}
const size = computed(() =>
  props.material.size < 1024
    ? props.material.size + ' B'
    : new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 }).format(
        props.material.size / 1024,
      ) + ' KB',
);
</script>
<template>
  <aside class="inspector">
    <header>
      <h3>资料信息</h3>
      <button class="icon-button" aria-label="关闭资料信息" @click="close">
        <X :size="17" />
      </button>
    </header>
    <div class="inspector-main">
      <div class="file-badge large">
        {{ material.originalName.split('.').at(-1)?.toUpperCase().slice(0, 6) || 'FILE' }}
      </div>
      <h3 class="wrap">{{ material.title }}</h3>
      <p class="muted small wrap">{{ material.originalName }}</p>
      <div v-if="material.isMissing" class="warning-banner">文件缺失；索引与备注已保留。</div>
      <div class="inspector-actions">
        <button @click="emit('preview', material.id)" :disabled="material.isMissing">预览</button
        ><button
          class="icon-button"
          title="使用系统应用打开"
          aria-label="使用系统应用打开"
          @click="store.run(() => api.openMaterial(material.id), '已打开资料')"
          :disabled="material.isMissing"
        >
          <ExternalLink :size="17" /></button
        ><button
          class="icon-button"
          title="在文件管理器中显示"
          aria-label="在文件管理器中显示"
          @click="store.run(() => api.revealMaterial(material.id), '已显示资料位置')"
          :disabled="material.isMissing"
        >
          <FolderOpen :size="17" /></button
        ><button
          class="icon-button"
          :class="{ favorite: material.isFavorite }"
          :aria-label="material.isFavorite ? '取消收藏' : '收藏'"
          @click="
            store.change(
              () => api.updateMaterial(material.id, { isFavorite: !material.isFavorite }),
              '收藏已更新',
            )
          "
        >
          <Star :size="17" :fill="material.isFavorite ? 'currentColor' : 'none'" />
        </button>
      </div>
      <form class="form-stack" @submit.prevent="save">
        <label>显示标题<input v-model="form.title" required /></label
        ><label
          >实际文件名<input
            v-model="form.filename"
            :disabled="!material.isManaged"
            required
          /><small class="field-note">{{
            material.isManaged ? '改名时须保留扩展名。' : '外部引用保留原文件名。'
          }}</small></label
        ><label>类别<input v-model="form.category" required /></label
        ><label>标签<input v-model="form.tags" placeholder="例如：重点、期末复习" /></label
        ><label>备注<textarea v-model="form.notes" rows="5" placeholder="记录阅读笔记…" /></label>
        <div v-if="dirty" class="dialog-actions">
          <button type="button" @click="reset">还原</button
          ><button
            class="primary"
            :disabled="!!store.busy || !form.title.trim() || !form.category.trim()"
          >
            <Save :size="14" />保存
          </button>
        </div>
      </form>
      <button
        v-if="material.sourcePath.startsWith('teaching://')"
        :disabled="!!store.busy"
        @click="openVersions"
      >
        <History :size="15" />版本历史
      </button>
      <dl class="metadata">
        <dt>存储方式</dt>
        <dd>{{ material.isManaged ? '库内副本' : '外部引用' }}</dd>
        <dt>大小</dt>
        <dd>{{ size }}</dd>
        <dt>添加日期</dt>
        <dd>{{ new Date(dateMs(material.addedAt)).toLocaleDateString('zh-CN') }}</dd>
        <dt>文件位置</dt>
        <dd class="wrap">{{ material.storedPath }}</dd>
      </dl>
    </div>
  </aside>
  <MaterialVersions v-if="showVersions" :material-id="material.id" @close="showVersions = false" />
</template>
