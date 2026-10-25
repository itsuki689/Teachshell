<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { X } from 'lucide-vue-next';
defineProps<{ title: string; wide?: boolean }>();
const emit = defineEmits<{ close: [] }>();
const panel = ref<HTMLElement>();
let previous: Element | null = null;
function key(e: KeyboardEvent) {
  const overlays = document.querySelectorAll('.modal-backdrop');
  if (panel.value && !overlays[overlays.length - 1]?.contains(panel.value)) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    emit('close');
  }
  if (e.key === 'Tab' && panel.value) {
    const nodes = Array.from(
      panel.value.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex="0"]',
      ),
    );
    const first = nodes[0],
      last = nodes.at(-1);
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last?.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first?.focus();
    }
  }
}
onMounted(() => {
  previous = document.activeElement;
  document.addEventListener('keydown', key);
  panel.value?.querySelector<HTMLElement>('input, textarea, button')?.focus();
});
onUnmounted(() => {
  document.removeEventListener('keydown', key);
  if (previous instanceof HTMLElement) previous.focus();
});
</script>
<template>
  <div class="modal-backdrop" @mousedown.self="emit('close')">
    <section
      ref="panel"
      class="modal"
      :class="{ wide }"
      role="dialog"
      aria-modal="true"
      :aria-label="title"
    >
      <header>
        <h2>{{ title }}</h2>
        <button type="button" class="icon-button" aria-label="关闭" @click="emit('close')">
          <X :size="18" />
        </button>
      </header>
      <div class="modal-body"><slot /></div>
    </section>
  </div>
</template>
