<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import { Monitor, Palette, Sun, Moon, Sparkles } from 'lucide-vue-next';
import { defaultTransition, normalizeHex } from '../../shared/appearance';
import type { Appearance } from '../../shared/appearance';
import { useAppearance } from '../stores/appearance';
import { useLibrary } from '../stores/library';
import AccentColorEditor from './AccentColorEditor.vue';
const appearance = useAppearance(),
  library = useLibrary(),
  editingColor = ref(false);
const transition = ref({ ...appearance.transition }),
  color = ref(transition.value.colorHex);
const options: { value: Appearance; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: '浅色', icon: Sun },
  { value: 'dark', label: '深色', icon: Moon },
  { value: 'system', label: '跟随系统', icon: Monitor },
];
const reduced = ref(matchMedia('(prefers-reduced-motion: reduce)').matches);
const media = matchMedia('(prefers-reduced-motion: reduce)');
const changed = () => {
  reduced.value = media.matches;
};
media.addEventListener('change', changed);
onUnmounted(() => {
  media.removeEventListener('change', changed);
});
const validColor = computed(() => normalizeHex(color.value));
watch(
  () => JSON.stringify(appearance.transition),
  () => {
    transition.value = { ...appearance.transition };
    color.value = appearance.transition.colorHex;
  },
);
async function saveTransition() {
  await appearance.save({
    appearanceTransition: {
      ...transition.value,
      colorHex: validColor.value ?? appearance.transition.colorHex,
    },
  });
}
async function reset() {
  transition.value = { ...defaultTransition };
  color.value = defaultTransition.colorHex;
  await saveTransition();
}
</script>
<template>
  <section class="settings-section appearance-settings">
    <h2><Monitor :size="19" />外观</h2>
    <p class="settings-intro">选择舒适的显示模式，让课屿更合你的习惯。</p>
    <h3 class="settings-group-title">显示模式</h3>
    <div class="settings-card">
      <div class="appearance-options" role="group" aria-label="显示模式">
        <button
          v-for="option in options"
          :key="option.value"
          :class="{ selected: appearance.mode === option.value }"
          :aria-label="option.label + '显示模式'"
          :aria-pressed="appearance.mode === option.value"
          @click="appearance.save({ appearance: option.value })"
        >
          <span class="appearance-preview" :class="option.value" aria-hidden="true"
            ><span class="preview-sidebar"><i /><i /><i /></span
            ><span class="preview-content"><i /><i /><i /></span
          ></span>
          <span class="appearance-label"
            ><component :is="option.icon" :size="16" />{{ option.label
            }}<span class="spacer" /><span class="appearance-check">{{
              appearance.mode === option.value ? '✓' : ''
            }}</span></span
          >
        </button>
      </div>
      <p class="field-note">跟随系统会自动匹配操作系统的外观。</p>
    </div>
    <h3 class="settings-group-title">个性配色</h3>
    <div class="settings-card">
      <div class="setting-row">
        <div>
          <strong><Palette :size="16" /> 强调色</strong>
          <p>用于按钮、选中状态和界面重点。</p>
        </div>
        <span class="accent-swatch" :style="{ background: library.state.accentColor }" /><button
          @click="editingColor = true"
        >
          调整颜色…
        </button>
      </div>
      <div class="setting-row">
        <div>
          <strong>课程色边框</strong>
          <p>在侧栏使用课程颜色区分课程，各课程颜色独立保留。</p>
        </div>
        <label class="switch"
          ><input
            type="checkbox"
            aria-label="课程色边框"
            :checked="library.state.showCourseBorders !== false"
            :disabled="!!appearance.pending"
            @change="
              appearance.save({ showCourseBorders: ($event.target as HTMLInputElement).checked })
            " /><span
        /></label>
      </div>
    </div>
    <h3 class="settings-group-title">切换动效</h3>
    <div class="settings-card transition-settings">
      <div class="setting-row">
        <div>
          <strong><Sparkles :size="16" /> 明暗切换动效</strong>
          <p>切换外观时，用十条色带覆盖并揭开界面。</p>
        </div>
        <label class="switch"
          ><input
            v-model="transition.isEnabled"
            type="checkbox"
            aria-label="启用切换动效"
            :disabled="!!appearance.pending"
            @change="saveTransition" /><span
        /></label>
      </div>
      <template v-if="transition.isEnabled">
        <label>覆盖方向</label>
        <div class="transition-directions" role="group" aria-label="覆盖方向">
          <button
            v-for="[value, label, symbol] in [
              ['top', '从上方', '↓'],
              ['bottom', '从下方', '↑'],
              ['left', '从左侧', '→'],
              ['right', '从右侧', '←'],
            ]"
            :key="value"
            :aria-label="label"
            :class="{ active: transition.direction === value }"
            :aria-pressed="transition.direction === value"
            :disabled="!!appearance.pending"
            @click="
              transition.direction = value as typeof transition.direction;
              saveTransition();
            "
          >
            <span>{{ symbol }}</span
            >{{ label }}
          </button>
        </div>
        <label class="speed-control"
          >速度<input
            v-model.number="transition.speed"
            type="range"
            min="0.5"
            max="2"
            step="0.1"
            aria-label="动效速度"
            @change="saveTransition"
          /><output
            >{{ transition.speed.toFixed(1) }}× ·
            {{ (0.74 / transition.speed).toFixed(2) }} 秒</output
          ></label
        >
        <div class="segmented" role="group" aria-label="动效配色">
          <button
            v-for="[value, label] in [
              ['solid', '单色'],
              ['rainbow', '彩虹十色'],
            ]"
            :key="value"
            :class="{ active: transition.colorMode === value }"
            :aria-pressed="transition.colorMode === value"
            :disabled="!!appearance.pending"
            @click="
              transition.colorMode = value as typeof transition.colorMode;
              saveTransition();
            "
          >
            {{ label }}
          </button>
        </div>
        <div v-if="transition.colorMode === 'solid'" class="transition-color">
          <input
            type="color"
            :value="validColor ?? '#808080'"
            aria-label="动效颜色"
            @input="color = ($event.target as HTMLInputElement).value"
            @change="saveTransition"
          /><label
            >HEX<input
              v-model="color"
              aria-label="动效颜色 HEX"
              :aria-invalid="!validColor"
              @change="validColor && saveTransition()"
          /></label>
        </div>
        <p v-if="!validColor" class="field-error">请输入六位 HEX 颜色。</p>
      </template>
      <p v-if="reduced" class="field-note">系统已开启减少动态效果，切换将立即完成。</p>
      <div class="setting-actions">
        <button
          :disabled="!transition.isEnabled || reduced || !validColor || !!appearance.pending"
          @click="appearance.previewSequence++"
        >
          预览动效</button
        ><span class="spacer" /><button :disabled="!!appearance.pending" @click="reset">
          恢复默认动效
        </button>
      </div>
    </div>
    <AccentColorEditor v-if="editingColor" @close="editingColor = false" />
  </section>
</template>
<style scoped>
.accent-swatch {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  margin-left: auto;
  flex-shrink: 0;
}
.transition-settings {
  display: grid;
  gap: 16px;
}
.transition-settings .setting-row {
  padding: 0;
}
.transition-directions {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
}
.transition-directions button {
  height: 58px;
  flex-direction: column;
  gap: 2px;
}
.transition-directions span {
  font-size: 20px;
}
.transition-directions .active {
  background: var(--selection);
  border-color: var(--accent);
  color: var(--accent);
}
.speed-control {
  display: flex;
  align-items: center;
  gap: 14px;
}
.speed-control input {
  flex: 1;
  min-width: 80px;
  padding: 0;
}
.speed-control output {
  min-width: 100px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.transition-color,
.transition-color label {
  display: flex;
  align-items: center;
  gap: 12px;
}
.transition-color input[type='color'] {
  width: 46px;
  padding: 3px;
}
.transition-color input:not([type='color']) {
  width: 130px;
}
</style>
