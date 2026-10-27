<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import type { LoginStatus } from '../../shared/api';
import { useLibrary } from '../stores/library';
const api = window.teachshelf,
  store = useLibrary();
const status = ref<LoginStatus>(),
  busy = ref(false);
let unsubscribe: (() => void) | undefined;
let active = true,
  eventSequence = 0;
const workspace = store.workspaceID;
const current = () => active && workspace === store.workspaceID;
onMounted(async () => {
  unsubscribe = api.onWebsiteLogin((value) => {
    eventSequence++;
    if (current()) status.value = value;
  });
  const before = eventSequence;
  try {
    const value = await api.websiteLoginStatus();
    if (current() && before === eventSequence) status.value = value;
  } catch (error) {
    if (current() && before === eventSequence) store.error = String(error);
  }
});
onUnmounted(() => {
  active = false;
  unsubscribe?.();
});
async function change(enabled?: boolean) {
  if (busy.value || store.busy || !current()) return;
  busy.value = true;
  try {
    const value = await store.run(
      () => (enabled === undefined ? api.retryWebsiteLogin() : api.rememberWebsiteLogin(enabled)),
      '登录记忆状态已更新',
    );
    if (value && current()) status.value = value;
  } finally {
    busy.value = false;
  }
}
async function toggle(event: Event) {
  const checkbox = event.target as HTMLInputElement;
  await change(checkbox.checked);
  // A rejected IPC leaves the reactive value unchanged, but the browser has already toggled it.
  if (current()) checkbox.checked = status.value?.enabled ?? false;
}
</script>
<template>
  <section class="website-login" aria-label="教学网站登录记忆">
    <label class="remember-login">
      <input
        type="checkbox"
        :checked="status?.enabled ?? false"
        :disabled="!status || busy || !!store.busy"
        @change="toggle"
      />
      记住此资料库的教学网站登录
    </label>
    <p class="field-note">
      仅通过系统安全存储保留教学平台会话，最长 7
      天。关闭记忆不会退出当前登录；课表与统一身份认证会话不保留。
    </p>
    <div class="login-status" role="status">
      <span :class="{ 'login-issue': status?.hasIssue }">{{
        status?.status ?? '正在读取登录状态…'
      }}</span>
      <button v-if="status?.hasIssue" :disabled="busy || !!store.busy" @click="change()">
        重试安全存储
      </button>
    </div>
  </section>
</template>
<style scoped>
.website-login {
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 12px;
}
.remember-login,
.login-status {
  display: flex;
  gap: 10px;
  align-items: center;
}
.remember-login input {
  width: auto;
}
.login-status {
  justify-content: space-between;
  font-size: 12px;
}
.login-issue {
  color: var(--danger);
}
</style>
