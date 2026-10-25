<script setup lang="ts">
withDefaults(defineProps<{ name: string; size?: number }>(), { size: 18 });
// Original SVG drawings on a common optical grid, following the Swift symbol
// meanings. No platform font or proprietary SF Symbols asset is required.
const paths: Record<string, string[]> = {
  books: ['M2.5 3.5h3v13h-3z', 'M7.5 2.5h3v14h-3z', 'm12 4 3-.8 3.3 12.5-3 .8z'],
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
  folder: ['M2 5h6l2 2h8v9.5H2z', 'M2 8.5h16'],
  star: ['m10 2 2.4 5.1 5.6.7-4.1 4 1 5.6-4.9-2.7-4.9 2.7 1-5.6-4.1-4 5.6-.7z'],
  clock: ['M10 2.3a7.7 7.7 0 1 0 0 15.4 7.7 7.7 0 0 0 0-15.4Z', 'M10 5.5V10l3.2 2'],
  sparkles: [
    'm12 5 1.7 4.3L18 11l-4.3 1.7L12 17l-1.7-4.3L6 11l4.3-1.7Z',
    'm5 1.5.9 2.6 2.6.9-2.6.9L5 8.5l-.9-2.6L1.5 5l2.6-.9Z',
  ],
  plus: ['M10 3v14M3 10h14'],
  import: ['M10 2v10m-3-3 3 3 3-3', 'M5 6H2.5v11h15V6H15'],
  refresh: ['M16.7 7A7 7 0 0 0 4.4 4.7L2 7m0-4v4h4', 'M3.3 13a7 7 0 0 0 12.3 2.3L18 13m-4 0h4v4'],
  gear: [
    'm8 2-.5 2-1.2.7-2-.5L2.3 7.6l1.5 1.5v1.8l-1.5 1.5 2 3.4 2-.5 1.2.7.5 2h4l.5-2 1.2-.7 2 .5 2-3.4-1.5-1.5V9.1l1.5-1.5-2-3.4-2 .5-1.2-.7-.5-2Z',
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
    <path
      v-for="(d, i) in paths[name] || paths.folder"
      :key="i"
      :d="d"
      :fill="name === 'books' ? 'currentColor' : 'none'"
      :stroke-width="name === 'books' ? 0.5 : undefined"
    />
  </svg>
</template>
