<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import { Flag } from 'lucide-vue-next';
import { swiftNow } from '../../shared/model';
import { shanghaiDayKey } from '../../shared/timetable';
import { scheduleMonthDays, shiftScheduleDay } from '../../shared/schedule';
import type { ScheduleEvent } from '../../shared/schedule';
const props = defineProps<{ day: string; events: Record<string, ScheduleEvent[]> }>();
const emit = defineEmits<{ 'update:day': [day: string]; openDay: [day: string] }>();
const days = computed(() => scheduleMonthDays(props.day));
const today = computed(() => shanghaiDayKey(swiftNow()));
const board = ref<HTMLElement>();
async function key(event: KeyboardEvent, day: string) {
  const offset = (
    { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 } as Record<string, number>
  )[event.key];
  if (offset == null) return;
  event.preventDefault();
  const next = shiftScheduleDay(day, 'agenda', offset);
  emit('update:day', next);
  await nextTick();
  board.value?.querySelector<HTMLButtonElement>(`[data-date="${next}"]`)?.focus();
}
</script>
<template>
  <div ref="board" class="month-board">
    <div class="month-weekdays">
      <span v-for="weekday in ['一', '二', '三', '四', '五', '六', '日']" :key="weekday">{{
        weekday
      }}</span>
    </div>
    <div class="month-grid" aria-label="计划月历">
      <button
        v-for="keyDay in days"
        :key="keyDay"
        class="month-day"
        :class="{
          outside: keyDay.slice(0, 7) !== day.slice(0, 7),
          selected: keyDay === day,
          today: keyDay === today,
        }"
        :data-date="keyDay"
        :aria-label="'选择日期 ' + keyDay"
        :aria-pressed="keyDay === day"
        :title="`${keyDay} · ${(events[keyDay] ?? []).length} 项安排`"
        @click="emit('update:day', keyDay)"
        @dblclick="emit('openDay', keyDay)"
        @keydown="key($event, keyDay)"
      >
        <span class="month-day-number">{{ Number(keyDay.slice(8)) }}</span>
        <span
          v-for="entry in (events[keyDay] ?? []).slice(0, 2)"
          :key="entry.id"
          class="month-event"
          :class="{ completed: entry.completed }"
          :data-source="entry.plan ? 'plan' : 'course'"
        >
          <Flag v-if="entry.deadline" :size="10" :style="{ color: entry.color }" /><span
            v-else
            class="month-event-dot"
            :style="{ background: entry.color }"
          />
          <span>{{ entry.title }}</span>
        </span>
        <span v-if="(events[keyDay] ?? []).length > 2" class="month-more"
          >+{{ events[keyDay].length - 2 }} 项</span
        >
        <span v-if="events[keyDay]?.some((e) => e.deadline)" class="month-compact"
          >{{ events[keyDay].filter((e) => e.deadline).length }} DDL</span
        >
        <span v-if="events[keyDay]?.some((e) => !e.deadline)" class="month-compact"
          >{{ events[keyDay].filter((e) => !e.deadline).length }} 项安排</span
        >
      </button>
    </div>
  </div>
</template>
<style scoped>
.month-board {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  container-type: size;
}
.month-weekdays {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  height: 42px;
  flex-shrink: 0;
  align-items: center;
  text-align: center;
  font-size: 12px;
  color: var(--muted);
  border-bottom: 1px solid var(--border);
}
.month-grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  grid-template-rows: repeat(6, minmax(0, 1fr));
  flex: 1;
  min-height: 0;
}
.month-day {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: flex-start;
  gap: 5px;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  padding: 8px;
  border: 0;
  border-right: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  border-radius: 0;
  background: var(--bg);
  text-align: left;
  box-shadow: none;
}
.month-day:nth-child(7n) {
  border-right: 0;
}
.month-day.selected {
  background: var(--selection);
  box-shadow: inset 0 0 0 1px var(--accent);
}
.month-day.outside {
  opacity: 0.55;
}
.month-day-number {
  width: 25px;
  height: 25px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  flex-shrink: 0;
}
.month-day.today .month-day-number {
  background: var(--accent-control);
  color: white;
  border-radius: 50%;
}
.month-event {
  display: flex;
  gap: 4px;
  align-items: center;
  width: 100%;
  font-size: 11px;
  line-height: 1.3;
  flex-shrink: 0;
}
.month-event > span:last-child {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.month-event-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  flex-shrink: 0;
}
.month-more,
.month-compact {
  font-size: 10px;
  color: var(--muted);
}
.month-compact {
  display: none;
}
.month-event.completed > span:last-child {
  text-decoration: line-through;
  color: var(--muted);
}
@container (max-width: 588px) or (max-height: 546px) {
  .month-event,
  .month-more {
    display: none;
  }
  .month-compact {
    display: block;
  }
}
</style>
