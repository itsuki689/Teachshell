<script setup lang="ts">
const api = window.teachshelf;
import { computed, ref } from 'vue';
import Modal from './Modal.vue';
import { useLibrary } from '../stores/library';
const emit = defineEmits<{ close: [] }>(),
  store = useLibrary();
const courseID = ref(store.courseID ?? ''),
  folderID = ref(store.folderID ?? ''),
  category = ref('课件'),
  copy = ref(true);
const folders = computed(() =>
  store.state.materialFolders.filter(
    (f) => f.courseID === (courseID.value || undefined) && !f.isMissing,
  ),
);
async function submit() {
  const result = await store.run(() =>
    api.importFiles({
      courseID: courseID.value || undefined,
      folderID: folderID.value || undefined,
      category: category.value,
      copy: copy.value,
    }),
  );
  if (result) {
    await store.refresh();
    store.status = `已导入 ${result.imported} 份，跳过 ${result.skipped} 份`;
    if (result.errors.length) store.error = result.errors.join('\n');
    emit('close');
  }
}
</script>
<template>
  <Modal :width="490" title="导入资料" @close="emit('close')"
    ><form class="form-stack" @submit.prevent="submit">
      <p class="muted">选择文件或文件夹，批量加入本地资料库。</p>
      <label
        >课程<select v-choice aria-label="课程" v-model="courseID" @change="folderID = ''">
          <option value="">未分类</option>
          <option v-for="c in store.state.courses" :key="c.id" :value="c.id">{{ c.name }}</option>
        </select></label
      ><label
        >文件夹<select v-choice aria-label="文件夹" v-model="folderID">
          <option value="">资料根目录</option>
          <option v-for="f in folders" :key="f.id" :value="f.id">{{ f.name }}</option>
        </select></label
      ><label
        >类别<input v-model="category" list="import-categories" required /><datalist
          id="import-categories"
        >
          <option
            v-for="c in ['课件', '教材', '参考资料', ...store.state.customCategories]"
            :key="c"
            :value="c"
          /></datalist></label
      ><label class="check-label"><input type="checkbox" v-model="copy" />将文件复制到资料库</label>
      <p class="field-note">
        {{
          copy
            ? '保留原文件，资料库内的副本可移动、重命名和随库迁移。'
            : '仅保存外部文件引用。原文件移动或更换设备后需要重新定位。'
        }}
      </p>
      <div class="dialog-actions">
        <span class="spacer" /><button type="button" @click="emit('close')">取消</button
        ><button class="primary" :disabled="!!store.busy || !category.trim()">选择文件…</button>
      </div>
    </form></Modal
  >
</template>
