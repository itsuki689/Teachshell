<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import type { BackgroundStatus, BackgroundPreferences } from '../../shared/api';
import { useLibrary } from '../stores/library';
const api = window.teachshelf,
  store = useLibrary();
const emit = defineEmits<{ review: [] }>();
const status = ref<BackgroundStatus>(),
  interval = ref(30),
  busy = ref(false);
let unsubscribe: (() => void) | undefined,
  active = true;
function accept(value: BackgroundStatus) {
  if (!active) return;
  const previous = status.value?.preferences.intervalMinutes;
  status.value = value;
  if (previous === undefined || previous !== value.preferences.intervalMinutes)
    interval.value = value.preferences.intervalMinutes;
}
onMounted(async () => {
  unsubscribe = api.onWebsiteBackground(accept);
  try {
    accept(await api.websiteBackgroundStatus());
  } catch (error) {
    if (active) store.error = String(error);
  }
});
onUnmounted(() => {
  active = false;
  unsubscribe?.();
});
async function save(patch: Partial<BackgroundPreferences>) {
  busy.value = true;
  try {
    accept(await api.saveWebsiteBackground(patch));
  } catch (error) {
    if (active) store.error = String(error);
  } finally {
    busy.value = false;
  }
}
function time(value?: number) {
  return value === undefined ? '尚未检查' : new Date(value).toLocaleString('zh-CN');
}
</script>
<template>
  <section class="website-sync" aria-label="教学网站后台巡检">
    <label class="check-label"
      ><input
        type="checkbox"
        :checked="status?.preferences.enabled ?? false"
        :disabled="!status || busy"
        @change="save({ enabled: ($event.target as HTMLInputElement).checked })"
      />启用后台定时巡检</label
    >
    <p class="field-note">
      应用运行时检查当前登录账号的已连接课程，只生成审核清单。开启后约 30 秒首查，不自动应用更新。
    </p>
    <div class="sync-options">
      <label
        >巡检间隔（分钟）<input
          type="number"
          min="5"
          max="1440"
          step="1"
          v-model.number="interval"
          :disabled="!status || busy"
      /></label>
      <button
        :disabled="
          !status ||
          busy ||
          !Number.isInteger(interval) ||
          interval < 5 ||
          interval > 1440 ||
          interval === status.preferences.intervalMinutes
        "
        @click="save({ intervalMinutes: interval })"
      >
        保存巡检间隔
      </button>
    </div>
    <p class="sync-status" role="status">{{ status?.reason ?? '正在读取巡检状态…' }}</p>
    <p v-if="status?.preferences.enabled || status?.lastCheckedAt" class="field-note">
      上次检查：{{ time(status?.lastCheckedAt)
      }}<template v-if="status?.nextCheckAt"> · 下次：{{ time(status.nextCheckAt) }}</template>
    </p>
    <button v-if="status?.review?.rows.length" class="primary" @click="emit('review')">
      审核发现的更新 <span>{{ status.review.rows.length }}</span>
    </button>
  </section>
</template>
<style scoped>
.website-sync {
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
}
.sync-options {
  display: flex;
  align-items: end;
  gap: 12px;
}
.sync-options input {
  max-width: 150px;
}
.sync-status {
  font-size: 12px;
  margin-bottom: 6px;
}
</style>
