<script setup lang="ts">
import { useId } from 'vue';
withDefaults(defineProps<{ name: string; size?: number }>(), { size: 18 });
const importClip = useId();
// Original SVG drawings on a common optical grid, following the Swift symbol
// meanings. No platform font or proprietary SF Symbols asset is required.
const paths: Record<string, string[]> = {
  books: [
    'M2 3.7h1.6q.7 0 .7.7v13q0 .7-.7.7H2q-.7 0-.7-.7v-13q0-.7.7-.7Z',
    'M6.1 6.3h2.8q.7 0 .7.7v10.4q0 .7-.7.7H6.1q-.7 0-.7-.7V7q0-.7.7-.7ZM6.8 8.6h1.4M6.8 15.8h1.4',
    'M11.5 1.8h2q.7 0 .7.7v14.9q0 .7-.7.7h-2q-.7 0-.7-.7V2.5q0-.7.7-.7Z',
    'm14.7 4.4 1.8-.2q.7-.1.8.6l1.4 12.3q.1.7-.6.8l-1.8.2q-.7.1-.8-.6L14.1 5.2q-.1-.7.6-.8Z',
  ],
  'books-filled': [
    'M2 3.7h1.6q.7 0 .7.7v13q0 .7-.7.7H2q-.7 0-.7-.7v-13q0-.7.7-.7Z',
    'M6.1 6.3h2.8q.7 0 .7.7v10.4q0 .7-.7.7H6.1q-.7 0-.7-.7V7q0-.7.7-.7ZM6.7 8.2a.4.4 0 0 0 0 .8h1.6a.4.4 0 0 0 0-.8ZM6.7 15.4a.4.4 0 0 0 0 .8h1.6a.4.4 0 0 0 0-.8Z',
    'M11.5 1.8h2q.7 0 .7.7v14.9q0 .7-.7.7h-2q-.7 0-.7-.7V2.5q0-.7.7-.7Z',
    'm14.7 4.4 1.8-.2q.7-.1.8.6l1.4 12.3q.1.7-.6.8l-1.8.2q-.7.1-.8-.6L14.1 5.2q-.1-.7.6-.8Z',
  ],
  'tray-full': [
    'M3 9 1.8 13v3.5h16.4V13L17 9',
    'M2 13h4.5l1 2h5l1-2H18',
    'M5 10V3.5h10V10',
    'M7.5 6h5M7.5 8.5h5',
  ],
  tray: ['M4 6h12l2.2 7v3.5H1.8V13z', 'M2 13h4.5l1 2h5l1-2H18'],
  checklist: ['m2.5 4 1 1 2-2M8 4h9', 'm2.5 10 1 1 2-2M8 10h9', 'M3.5 15.5h1v1h-1zM8 16h9'],
  calendar: [
    'M3 4.5h14v13H3z',
    'M3 8h14M6 2.5v4M14 2.5v4',
    'M6 11h1M10 11h1M14 11h.1M6 14h1M10 14h1M14 14h.1',
  ],
  'calendar-plus': [
    'M16 9V4.5H3v13h6',
    'M3 8h13M6 2.5v4M13 2.5v4',
    'M6 11h1M10 11h1M6 14h1',
    'M14.5 10.5a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z',
    'M14.5 12.5v4M12.5 14.5h4',
  ],
  folder: ['M2 5h6l2 2h8v9.5H2z', 'M2 8.5h16'],
  star: ['m10 2 2.4 5.1 5.6.7-4.1 4 1 5.6-4.9-2.7-4.9 2.7 1-5.6-4.1-4 5.6-.7z'],
  clock: ['M10 2.3a7.7 7.7 0 1 0 0 15.4 7.7 7.7 0 0 0 0-15.4Z', 'M10 5.5V10l3.2 2'],
  sparkles: [
    'm12 5 1.7 4.3L18 11l-4.3 1.7L12 17l-1.7-4.3L6 11l4.3-1.7Z',
    'm5 1.5.9 2.6 2.6.9-2.6.9L5 8.5l-.9-2.6L1.5 5l2.6-.9Z',
  ],
  plus: ['M10 3v14M3 10h14'],
  import: ['M10 2v10m-3-3 3 3 3-3', 'M5 6H2.5v11h15V6H15'],
  refresh: [
    'M4.5 4.9A7.2 7.2 0 0 1 17.2 9',
    'M15.5 15.1A7.2 7.2 0 0 1 2.8 11',
    'm14.9 8.5 2.1 2.8 2.1-2.8Z',
    'm.9 11.5 2.1-2.8 2.1 2.8Z',
  ],
  gear: [
    'm8.5 1.6 3 0 .4 2.2 1.2.5 1.9-1.2 2.1 2.1-1.2 1.9.5 1.2 2.2.4v3l-2.2.4-.5 1.2 1.2 1.9-2.1 2.1-1.9-1.2-1.2.5-.4 2.2h-3l-.4-2.2-1.2-.5-1.9 1.2-2.1-2.1 1.2-1.9-.5-1.2-2.2-.4v-3l2.2-.4.5-1.2-1.2-1.9L5 3.1 6.9 4.3l1.2-.5Z',
    'M10 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z',
  ],
  globe: ['M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Z', 'M2 10h16M10 2c-4 4-4 12 0 16 4-4 4-12 0-16Z'],
};
</script>
<template>
  <svg
    class="app-symbol"
    :data-symbol="name"
    :width="size"
    :height="size"
    viewBox="0 0 20 20"
    fill="none"
    stroke="currentColor"
    stroke-width="1.35"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <template v-if="name === 'import'">
      <defs>
        <clipPath :id="importClip"><rect x="3" y="0" width="14" height="14" /></clipPath>
      </defs>
      <path d="M2 6v10q0 2 2 2h12q2 0 2-2V6" />
      <g :clip-path="`url(#${importClip})`">
        <g data-icon-part="import-arrows">
          <path d="M10 1v10m-3.5-3.5L10 11l3.5-3.5" />
          <path d="M10 1v10m-3.5-3.5L10 11l3.5-3.5" transform="translate(0 -16)" />
        </g>
      </g>
    </template>
    <path
      v-else
      v-for="(d, i) in paths[name] || paths.folder"
      :key="i"
      :d="d"
      fill-rule="evenodd"
      :fill="name === 'books-filled' || (name === 'refresh' && i > 1) ? 'currentColor' : 'none'"
      :stroke-width="name === 'books-filled' ? 0 : undefined"
    />
  </svg>
</template>
