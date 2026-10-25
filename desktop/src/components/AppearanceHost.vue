<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch, watchEffect } from 'vue';
import DayNightArtwork from './DayNightArtwork.vue';
import { AppearanceCurtain, contrastColor, cssColor, rainbow } from '../../shared/appearance';
import { useAppearance } from '../stores/appearance';
import { useLibrary } from '../stores/library';
const appearance = useAppearance(),
  library = useLibrary();
const scheme = matchMedia('(prefers-color-scheme: dark)'),
  reduced = matchMedia('(prefers-reduced-motion: reduce)'),
  contrast = matchMedia('(prefers-contrast: more)');
const systemDark = ref(scheme.matches),
  applied = ref(appearance.mode),
  active = ref(false),
  opacity = ref<number[]>([]),
  direction = ref('top'),
  colors = ref<string[]>([]),
  moreContrast = ref(contrast.matches);
const dark = computed(
  () => applied.value === 'dark' || (applied.value === 'system' && systemDark.value),
);
const requestedDark = computed(
  () => appearance.mode === 'dark' || (appearance.mode === 'system' && systemDark.value),
);
const curtain = new AppearanceCurtain((mode) => {
  applied.value = mode;
});
const toggleRoot = ref<HTMLElement>(),
  showMenu = ref(false);
async function openMenu() {
  showMenu.value = true;
  await nextTick();
  toggleRoot.value?.querySelector<HTMLElement>('[role=menuitemradio]')?.focus();
}
function outside(event: Event) {
  if (!toggleRoot.value?.contains(event.target as Node)) showMenu.value = false;
}
function menuKey(event: KeyboardEvent) {
  if (!showMenu.value) return;
  if (event.key === 'Escape') {
    showMenu.value = false;
    toggleRoot.value?.querySelector('button')?.focus();
    event.stopPropagation();
  }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const items = [
      ...(toggleRoot.value?.querySelectorAll<HTMLElement>('[role=menuitemradio]') ?? []),
    ];
    items[
      (items.indexOf(document.activeElement as HTMLElement) + (event.key === 'ArrowDown' ? 1 : 2)) %
        3
    ]?.focus();
  }
}
let frame = 0;
function render() {
  opacity.value = [...curtain.opacity];
  active.value = curtain.phase !== 'idle';
  direction.value = curtain.settings.direction;
  colors.value =
    curtain.settings.colorMode === 'rainbow'
      ? [...rainbow]
      : Array(10).fill(curtain.settings.colorHex);
}
function tick(now: number) {
  curtain.tick(now);
  render();
  frame = active.value ? requestAnimationFrame(tick) : 0;
}
function request(preview = false) {
  curtain.request(
    appearance.mode,
    appearance.transition,
    performance.now(),
    !reduced.matches && !document.hidden,
    preview,
  );
  render();
  if (active.value && !frame) frame = requestAnimationFrame(tick);
}
function finish() {
  curtain.finish();
  render();
  cancelAnimationFrame(frame);
  frame = 0;
}
function mediaChanged() {
  systemDark.value = scheme.matches;
  moreContrast.value = contrast.matches;
  if (reduced.matches || document.hidden) finish();
}
watch(
  () => appearance.mode,
  () => request(),
);
watch(
  () => appearance.previewSequence,
  () => request(true),
);
watch(
  () => library.workspaceID,
  () => {
    curtain.request(appearance.mode, appearance.transition, performance.now(), false);
    finish();
  },
  { flush: 'post' },
);
watchEffect(() => {
  const root = document.documentElement,
    source = appearance.previewColor ?? library.state.accentColor;
  root.dataset.theme = applied.value;
  root.dataset.courseBorders = String(library.state.showCourseBorders !== false);
  const ink = cssColor(
    contrastColor(source, dark.value ? '#242628' : '#FFFFFF', moreContrast.value ? 7 : 4.5),
  );
  root.style.setProperty('--accent', ink);
  root.style.setProperty('--accent-source', source);
  root.style.setProperty(
    '--accent-control',
    cssColor(contrastColor(source, '#FFFFFF', moreContrast.value ? 7 : 4.5)),
  );
  root.style.setProperty(
    '--selection',
    `color-mix(in srgb, ${ink} ${dark.value ? 22 : 12}%, var(--bg))`,
  );
});
onMounted(() => {
  window.addEventListener('pointerdown', outside);
  window.addEventListener('focusin', outside);
  scheme.addEventListener('change', mediaChanged);
  reduced.addEventListener('change', mediaChanged);
  contrast.addEventListener('change', mediaChanged);
  document.addEventListener('visibilitychange', mediaChanged);
});
onUnmounted(() => {
  window.removeEventListener('pointerdown', outside);
  window.removeEventListener('focusin', outside);
  finish();
  scheme.removeEventListener('change', mediaChanged);
  reduced.removeEventListener('change', mediaChanged);
  contrast.removeEventListener('change', mediaChanged);
  document.removeEventListener('visibilitychange', mediaChanged);
});
</script>
<template>
  <div ref="toggleRoot" class="day-night-control" @keydown="menuKey">
    <button
      class="day-night-toggle"
      :class="{ dark: requestedDark }"
      :style="{ zIndex: active ? 10001 : undefined }"
      :disabled="!library.snapshot"
      :aria-label="requestedDark ? '切换浅色外观' : '切换深色外观'"
      :title="requestedDark ? '切换浅色外观' : '切换深色外观'"
      @contextmenu.prevent="openMenu"
      @click="appearance.save({ appearance: requestedDark ? 'light' : 'dark' })"
    >
      <DayNightArtwork :dark="requestedDark" />
    </button>
    <div v-if="showMenu" class="appearance-menu" role="menu" aria-label="外观模式菜单">
      <button
        v-for="[mode, label] in [
          ['system', '跟随系统'],
          ['light', '浅色'],
          ['dark', '深色'],
        ] as const"
        :key="mode"
        role="menuitemradio"
        :aria-label="label"
        :aria-checked="appearance.mode === mode"
        @click="
          showMenu = false;
          appearance.save({ appearance: mode });
        "
      >
        {{ label }}<span>{{ appearance.mode === mode ? '✓' : '' }}</span>
      </button>
    </div>
  </div>
  <Teleport to="body">
    <div v-if="active" class="appearance-curtain" :data-direction="direction" aria-hidden="true">
      <div
        v-for="(alpha, i) in opacity"
        :key="i"
        :style="{
          opacity: alpha,
          background: colors[i],
          order: direction === 'bottom' || direction === 'right' ? 9 - i : i,
        }"
      />
    </div>
  </Teleport>
</template>
<style>
.day-night-control {
  position: relative;
  display: flex;
  -webkit-app-region: no-drag;
}
.appearance-menu {
  position: absolute;
  right: 0;
  top: 36px;
  z-index: 10002;
  width: 150px;
  padding: 5px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg);
  box-shadow: var(--shadow);
}
.appearance-menu button {
  display: flex;
  width: 100%;
  justify-content: space-between;
  border: 0;
  background: transparent;
}
.appearance-menu button:hover {
  background: var(--selection);
}

.day-night-toggle {
  position: relative;
  width: 72px;
  height: 29px;
  min-height: 29px;
  flex-shrink: 0;
  border: 0;
  border-radius: 20px;
  padding: 0;
  background: transparent;
  -webkit-app-region: no-drag;
}
.appearance-curtain {
  position: fixed;
  inset: 0;
  z-index: 10000;
  display: flex;
  flex-direction: column;
  pointer-events: none;
}
.appearance-curtain[data-direction='left'],
.appearance-curtain[data-direction='right'] {
  flex-direction: row;
}
.appearance-curtain > div {
  flex: 1;
  min-height: 0;
  min-width: 0;
}
.course-marker {
  width: 12px;
  height: 12px;
  border-radius: 3px;
}
:root[data-course-borders='true'] .course-row {
  border-color: color-mix(in srgb, var(--course-color) 50%, transparent);
}
:root[data-course-borders='false'] .course-row {
  border-color: transparent;
}
:root[data-course-borders='false'] .course-row.active {
  border-color: transparent;
}
button.primary:hover:not(:disabled) {
  background: color-mix(in srgb, var(--accent-control) 88%, #000);
}
button.primary {
  background: var(--accent-control);
  border-color: var(--accent-control);
}
</style>
