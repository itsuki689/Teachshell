<script setup lang="ts">
import { Check, Flag, RotateCcw, XCircle } from 'lucide-vue-next';
import type { ScheduleEvent } from '../../shared/schedule';
defineProps<{ events: ScheduleEvent[]; compact?: boolean; month?: boolean; busy?: boolean }>();
const emit = defineEmits<{
  open: [event: ScheduleEvent];
  status: [event: ScheduleEvent, action: 'complete' | 'reopen' | 'cancel'];
}>();
</script>
<template>
  <div
    v-for="event in events"
    :key="event.id"
    class="schedule-event-row"
    :class="{ compact, completed: event.completed, 'plan-row': !compact && event.plan }"
    :style="{ '--event-color': event.color }"
  >
    <button
      class="schedule-event-content"
      :aria-label="
        (compact
          ? month
            ? event.plan
              ? '编辑月历计划 '
              : '查看月历课程 '
            : '查看安排 '
          : event.plan
            ? '编辑计划 '
            : '查看课程 ') + event.title
      "
      @click="emit('open', event)"
    >
      <span class="event-color"><Flag v-if="event.deadline" :size="14" /></span>
      <span class="event-description"
        ><strong>{{ event.title }}</strong
        ><small
          >{{ event.time }}<template v-if="event.location"> · {{ event.location }}</template></small
        >
        <small
          >{{ event.deadline ? '截止 DDL' : (event.plan?.task.kind ?? '课程')
          }}{{ event.meeting?.rescheduleID ? ' · 已调课' : ''
          }}{{ event.completed ? ' · 已完成' : '' }}</small
        ></span
      >
    </button>
    <div v-if="event.plan" class="schedule-event-actions">
      <button
        v-if="event.plan.task.completionRequired !== false"
        class="icon-button"
        :aria-label="
          (compact
            ? event.completed
              ? '恢复此项 '
              : '完成此项 '
            : event.completed
              ? '恢复待完成 '
              : '完成计划 ') + event.title
        "
        :title="event.completed ? '恢复待完成' : '完成计划'"
        :disabled="busy"
        @click="emit('status', event, event.completed ? 'reopen' : 'complete')"
      >
        <RotateCcw v-if="event.completed" :size="15" /><Check v-else :size="15" />
      </button>
      <button
        v-if="!compact"
        class="icon-button"
        :aria-label="'取消计划 ' + event.title"
        title="取消计划"
        :disabled="busy"
        @click="emit('status', event, 'cancel')"
      >
        <XCircle :size="15" />
      </button>
    </div>
  </div>
</template>
<style scoped>
.schedule-event-row {
  display: flex;
  align-items: center;
  padding: 0;
  gap: 0;
  min-width: 0;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: var(--bg);
}
.schedule-event-content {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  min-width: 0;
  flex: 1;
  border: 0;
  padding: 12px;
  gap: 10px;
  text-align: left;
  white-space: normal;
  background: transparent;
}
.event-color {
  width: 4px;
  min-height: 34px;
  border-radius: 3px;
  flex-shrink: 0;
  color: var(--event-color);
  background: var(--event-color);
}
.event-color:has(svg) {
  width: 16px;
  background: transparent;
  display: flex;
  align-items: center;
}
.event-description {
  display: grid;
  text-align: left;
  min-width: 0;
  gap: 5px;
}
.event-description strong {
  font-size: 13px;
  overflow-wrap: anywhere;
}
.event-description small {
  font-size: 11px;
  color: var(--muted);
  line-height: 1.5;
}
.completed strong {
  text-decoration: line-through;
  color: var(--muted);
}
.schedule-event-actions {
  display: flex;
  align-items: center;
  padding: 6px;
}
.compact .schedule-event-content {
  padding: 9px;
  gap: 7px;
}
.compact .event-description strong {
  font-size: 12px;
}
</style>
