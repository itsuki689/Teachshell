<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import Modal from './Modal.vue';
import { accentPresets, normalizeHex } from '../../shared/appearance';
import { useAppearance } from '../stores/appearance';
import { useLibrary } from '../stores/library';
const appearance = useAppearance(),
  library = useLibrary(),
  emit = defineEmits<{ close: [] }>();
const hex = ref(library.state.accentColor),
  valid = computed(() => normalizeHex(hex.value));
const baseline = { root: library.snapshot!.root, revision: library.snapshot!.revision };
watch(
  valid,
  (value) => {
    if (value) appearance.previewColor = value;
  },
  { immediate: true },
);
onUnmounted(() => {
  appearance.previewColor = undefined;
});
async function save() {
  if (valid.value && (await appearance.save({ accentColor: valid.value }, baseline))) emit('close');
}
</script>
<template>
  <Modal title="强调色" :width="500" @close="emit('close')">
    <form class="accent-editor" @submit.prevent="save">
      <p class="muted">选择一种颜色，用于按钮、选中状态与界面重点。</p>
      <strong>预设颜色</strong>
      <div class="accent-presets">
        <button
          v-for="[name, color] in accentPresets"
          :key="color"
          type="button"
          :title="name"
          :aria-label="name"
          :aria-pressed="valid === color"
          :style="{ background: color }"
          @click="hex = color"
        >
          {{ valid === color ? '✓' : '' }}
        </button>
      </div>
      <div class="accent-custom">
        <label
          >自定义颜色<input
            type="color"
            :value="valid ?? '#39786B'"
            aria-label="自定义强调色"
            @input="hex = ($event.target as HTMLInputElement).value"
        /></label>
        <label
          >HEX<input
            v-model="hex"
            aria-label="强调色 HEX"
            maxlength="20"
            :aria-invalid="!valid"
            autocomplete="off"
            spellcheck="false"
        /></label>
      </div>
      <p v-if="!valid" class="field-error" role="alert">请输入六位 HEX 颜色，例如 #39786B。</p>
      <div class="accent-sample">
        <strong>效果预览</strong>
        <div>
          <span class="sample-primary">主要操作</span
          ><span class="sample-selection">✓ 选中项目</span><span class="sample-check">✓</span>
        </div>
      </div>
      <footer class="dialog-actions">
        <button type="button" @click="hex = '#39786B'">恢复默认</button
        ><span class="spacer" /><button type="button" @click="emit('close')">取消</button
        ><button class="primary" :disabled="!valid || !!appearance.pending">保存</button>
      </footer>
    </form>
  </Modal>
</template>
<style scoped>
.accent-editor {
  display: grid;
  gap: 18px;
}
.accent-editor p {
  margin: 0;
  line-height: 1.6;
}
.accent-presets {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 10px;
}
.accent-presets button {
  height: 38px;
  color: white;
  font-size: 19px;
  border: 0;
  box-shadow: inset 0 0 0 1px #0001;
}
.accent-presets button[aria-pressed='true'] {
  outline: 2px solid var(--accent);
  outline-offset: 3px;
}
.accent-custom {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
}
.accent-custom label {
  display: flex;
  gap: 10px;
  align-items: center;
}
.accent-custom input[type='color'] {
  width: 44px;
  padding: 3px;
}
.accent-custom input:not([type='color']) {
  width: 118px;
}
.accent-sample {
  padding: 16px;
  border-radius: 12px;
  background: var(--surface);
}
.accent-sample > div {
  display: flex;
  gap: 14px;
  align-items: center;
  margin-top: 16px;
}
.sample-primary,
.sample-selection {
  padding: 7px 12px;
  border-radius: 6px;
}
.sample-primary {
  background: var(--accent-control);
  color: white;
}
.sample-selection {
  background: var(--selection);
  color: var(--accent);
}
.sample-check {
  color: var(--accent);
}
</style>
