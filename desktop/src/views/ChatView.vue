<script setup lang="ts">
import { useWorkspaceUI } from '../stores/workspace-ui';
function modelSettings() {
  useWorkspaceUI().settingsTab = 'assistant';
  void store.navigate('settings');
}
const api = window.teachshelf;
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';
import {
  ArrowUp,
  ArrowUpLeft,
  MessageSquare,
  Plus,
  Settings2,
  Sparkles,
  Square,
  Wrench,
} from 'lucide-vue-next';
import type { ChatEvent, ChatMessage } from '../../shared/api';
import { useLibrary } from '../stores/library';
const store = useLibrary(),
  messages = ref<ChatMessage[]>([]),
  input = ref(''),
  streaming = ref(false),
  resetting = ref(false),
  delta = ref(''),
  pending = ref<ChatEvent | null>(null),
  scroll = ref<HTMLElement>();
let unsubscribe: (() => void) | undefined;
let active = true,
  historySequence = 0,
  sendSequence = 0;
const current = (workspace: string | undefined) => active && workspace === store.workspaceID;
const configured = computed(() => !!store.settings?.ai.baseURL && !!store.settings.ai.model);
const examples = [
  '今天有哪些待完成的计划？',
  '每门课程各有多少份资料？',
  '帮我整理当前课程的资料分类',
];
async function bottom() {
  await nextTick();
  scroll.value?.scrollTo({ top: scroll.value.scrollHeight, behavior: 'smooth' });
}
async function history() {
  const request = ++historySequence,
    workspace = store.workspaceID;
  try {
    const value = await api.chatHistory();
    if (current(workspace) && request === historySequence) messages.value = value;
  } catch (error) {
    if (current(workspace) && request === historySequence)
      store.error = error instanceof Error ? error.message : String(error);
  }
}
async function send() {
  const text = input.value.trim();
  if (!text || !configured.value || streaming.value || resetting.value) return;
  const request = ++sendSequence,
    workspace = store.workspaceID;
  historySequence++;
  input.value = '';
  streaming.value = true;
  delta.value = '';
  messages.value.push({
    id: crypto.randomUUID(),
    role: 'user',
    content: text,
    createdAt: Date.now(),
  });
  await bottom();
  if (!current(workspace) || request !== sendSequence) return;
  try {
    await api.sendChat(text);
  } catch (e) {
    if (current(workspace) && request === sendSequence)
      store.error = e instanceof Error ? e.message : String(e);
  } finally {
    if (current(workspace) && request === sendSequence) {
      streaming.value = false;
      pending.value = null;
      delta.value = '';
      await history();
      await bottom();
    }
  }
}
async function decide(approved: boolean) {
  const confirmation = pending.value,
    workspace = store.workspaceID;
  const id = confirmation?.requestID;
  if (!id) return;
  const result = await store.run(
    async () => {
      await api.confirmTool(id, approved);
      return true;
    },
    approved ? '已确认操作' : '已拒绝操作',
  );
  if (result && current(workspace) && pending.value === confirmation) pending.value = null;
}
async function reset() {
  if (streaming.value || resetting.value) return;
  const workspace = store.workspaceID;
  if (
    messages.value.length &&
    !(await store.confirm(
      '开始新对话？',
      '当前本地聊天记录将被清除。课程和资料不受影响。',
      '清除并开始',
    ))
  )
    return;
  if (!current(workspace)) return;
  historySequence++;
  resetting.value = true;
  try {
    await store.run(() => api.clearChat(), '对话已清除');
    if (current(workspace)) await history();
  } finally {
    if (current(workspace)) resetting.value = false;
  }
}
// App keys the workspace body by workspaceID, so switching creates a fresh chat view.
onMounted(async () => {
  unsubscribe = api.onChat((e) => {
    if (!active) return;
    if (e.type === 'delta') {
      delta.value += e.text ?? '';
      void bottom();
    } else if (e.type === 'confirmation') {
      pending.value = e;
      void bottom();
    } else if (e.type === 'error') {
      store.error = e.text ?? 'AI 请求未完成';
      streaming.value = false;
      pending.value = null;
    } else if (e.type === 'done') {
      streaming.value = false;
      delta.value = '';
      pending.value = null;
      void history().then(bottom);
    }
  });
  await history();
  if (!store.settings && active) {
    const s = await store.run(() => api.settings());
    if (s && active) store.settings = s;
  }
});
onUnmounted(() => {
  active = false;
  historySequence++;
  sendSequence++;
  unsubscribe?.();
});
</script>
<template>
  <section class="workspace chat-workspace">
    <header class="workspace-header">
      <div class="heading-with-icon">
        <div class="settings-icon"><Sparkles :size="21" /></div>
        <div class="heading-block">
          <h1>AI 助手</h1>
          <p>{{ configured ? store.settings?.ai.model : '连接模型，用自然语言管理课屿' }}</p>
        </div>
      </div>
      <div class="toolbar-controls">
        <button :disabled="streaming || resetting" @click="reset"><Plus :size="16" />新对话</button
        ><button @click="modelSettings"><Settings2 :size="16" />模型设置</button>
      </div>
    </header>
    <div ref="scroll" class="chat-scroll">
      <div class="chat-messages">
        <div v-if="!messages.length && !streaming" class="chat-welcome">
          <h2>把想做的事告诉课屿</h2>
          <p>查询课程与资料、安排计划，或调整文件夹。修改前先确认，结果会同步到资料库。</p>
          <div v-if="!configured" class="connection-card">
            <div>
              <strong>先连接一个模型</strong>
              <p>支持 OpenAI 兼容 API 和本地模型服务。</p>
            </div>
            <button class="primary" @click="modelSettings">设置模型</button>
          </div>
          <div class="examples">
            <span class="small muted">可以这样开始</span
            ><button v-for="example in examples" :key="example" @click="input = example">
              {{ example }}<ArrowUpLeft :size="15" />
            </button>
          </div>
        </div>
        <article v-for="m in messages" :key="m.id" class="chat-message" :class="m.role">
          <div v-if="m.role !== 'user'" class="message-author">
            <Wrench v-if="m.role === 'tool'" :size="13" /><Sparkles v-else :size="13" />{{
              m.role === 'tool' ? (m.toolName ?? '工具结果') : '课屿助手'
            }}
          </div>
          <div class="message-text">{{ m.content }}</div>
        </article>
        <article v-if="streaming && delta" class="chat-message assistant">
          <div class="message-author"><Sparkles :size="13" />课屿助手</div>
          <div class="message-text">{{ delta }}<span class="stream-cursor" /></div>
        </article>
        <div v-if="pending" class="tool-confirmation">
          <h3><Wrench :size="17" />确认本地操作</h3>
          <strong>{{ pending.toolName }}</strong>
          <pre>{{ JSON.stringify(pending.arguments, null, 2) }}</pre>
          <p class="small muted">确认后才会修改本机资料库。请核对目标记录与参数。</p>
          <div class="dialog-actions">
            <button @click="decide(false)">拒绝</button
            ><button class="primary" @click="decide(true)">确认执行</button>
          </div>
        </div>
        <p v-if="streaming && !pending" class="stream-status">
          <span class="loading-dot" />{{ delta ? '正在输出…' : '正在等待模型…' }}
        </p>
      </div>
    </div>
    <form class="chat-composer" @submit.prevent="send">
      <div class="composer-note">
        <span>对话和工具查询所得的元数据会发送到所选模型；文件正文不会自动发送。</span
        ><span>⌘ / Ctrl Return 发送</span>
      </div>
      <div class="composer-input">
        <textarea
          v-model="input"
          placeholder="例如：把明天的复习计划改到晚上七点"
          aria-label="给 AI 助手的消息"
          rows="2"
          :disabled="streaming || resetting"
          @keydown.enter.meta.prevent="send"
          @keydown.enter.ctrl.prevent="send"
        /><button
          v-if="streaming"
          type="button"
          @click="store.run(() => api.cancelChat(), '已停止生成')"
        >
          <Square :size="14" />停止</button
        ><button v-else class="primary" :disabled="!configured || !input.trim() || resetting">
          <ArrowUp :size="17" />发送
        </button>
      </div>
      <p class="field-note">
        聊天记录保存在本机。操作以工具返回的实际结果为准，请核对名称、日期和作用范围。
      </p>
    </form>
  </section>
</template>
