<script setup lang="ts">
/** Geometry/colors ported from DayNightToggle.swift; drawn as resolution-independent SVG. */
defineProps<{ dark: boolean }>();
const back = [
  [247, 37, 90],
  [202, 59, 50],
  [177, 77, 70],
  [147, 105, 90],
  [107, 101, 90],
  [67, 117, 90],
  [37, 124, 90],
];
const front = [
  [252, 59, 90],
  [225, 84, 70],
  [187, 117, 90],
  [152, 116, 70],
  [117, 109, 66],
  [72, 114, 70],
  [42, 134, 90],
];
const stars = [
  [45, 15, 13.5],
  [127, 30, 13.5],
  [115, 73, 10],
  [32, 34, 6],
  [59, 46, 6],
  [111, 29, 6],
  [133, 61, 6],
  [59, 86, 6],
  [34, 80, 4],
  [40, 72, 4],
  [101, 52, 4],
];
</script>
<template>
  <svg class="day-night-art" :class="{ night: dark }" viewBox="0 0 250 100" aria-hidden="true">
    <defs>
      <clipPath id="day-night-orb-clip"><circle cx="50" cy="50" r="40" /></clipPath>
      <radialGradient id="day-night-sun" cx="35%" cy="30%">
        <stop stop-color="#FFE88F" />
        <stop offset="0.75" stop-color="#F2C426" />
        <stop offset="1" stop-color="#C39A1C" />
      </radialGradient>
      <radialGradient id="day-night-moon" cx="35%" cy="30%">
        <stop stop-color="#F0F1F3" />
        <stop offset="0.75" stop-color="#C5C8CF" />
        <stop offset="1" stop-color="#9C9FA8" />
      </radialGradient>
    </defs>
    <rect width="250" height="100" rx="50" class="sky" />
    <g class="clouds cloud-back">
      <circle
        v-for="([x, y, size], i) in back"
        :key="i"
        :cx="x"
        :cy="y"
        :r="size / 2"
        fill="#A5C5DC"
      />
    </g>
    <g class="stars">
      <path
        v-for="([x, y, size], i) in stars"
        :key="i"
        :transform="`translate(${x - size / 2} ${y - size / 2}) scale(${size / 10})`"
        d="M5 0 Q5 5 10 5 Q5 5 5 10 Q5 5 0 5 Q5 5 5 0Z"
        fill="white"
      />
    </g>
    <g class="orb">
      <circle
        v-for="diameter in [280, 210, 140]"
        :key="diameter"
        cx="50"
        cy="50"
        :r="diameter / 2"
        fill="white"
        opacity="0.07"
      />
      <circle cx="50" cy="50" r="40" fill="url(#day-night-sun)" />
      <g clip-path="url(#day-night-orb-clip)">
        <g class="moon">
          <circle cx="50" cy="50" r="40" fill="url(#day-night-moon)" />
          <circle cx="38" cy="57" r="14" fill="#969DB0" />
          <circle cx="50" cy="30" r="8" fill="#969DB0" />
          <circle cx="70" cy="64" r="8" fill="#969DB0" />
        </g>
      </g>
    </g>
    <g class="clouds cloud-front">
      <circle
        v-for="([x, y, size], i) in front"
        :key="i"
        :cx="x"
        :cy="y"
        :r="size / 2"
        fill="white"
      />
    </g>
  </svg>
</template>
<style scoped>
.day-night-art {
  width: 72px;
  height: 28.8px;
  display: block;
  border-radius: 30px;
  overflow: hidden;
  box-shadow:
    inset 0 2px 4px #0005,
    0 1px 2px #0003;
}
.sky {
  fill: #397ab0;
  transition: fill 0.65s;
}
.night .sky {
  fill: #1c202c;
}
.orb,
.clouds,
.stars,
.moon {
  transition:
    transform 0.65s cubic-bezier(0.25, 0.8, 0.35, 1.08),
    opacity 0.65s;
}
.night .orb {
  transform: translateX(150px);
}
.moon {
  transform: translateX(84px);
}
.night .moon {
  transform: translateX(0);
}
.stars {
  transform: translateY(-150px);
  opacity: 0;
}
.night .stars {
  transform: translateY(0);
  opacity: 1;
}
.night .cloud-back {
  transform: translateY(130px);
  opacity: 0;
}
.night .cloud-front {
  transform: translateY(100px);
  opacity: 0;
}
@media (prefers-reduced-motion: reduce) {
  .sky,
  .orb,
  .clouds,
  .stars,
  .moon {
    transition: none;
  }
}
</style>
