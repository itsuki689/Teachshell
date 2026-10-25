<script setup lang="ts">
const api = window.teachshelf;
import { onMounted, reactive, ref } from 'vue';
import {
  Archive,
  PanelTop,
  Copy,
  Database,
  Download,
  FolderOpen,
  Globe,
  KeyRound,
  Monitor,
  Save,
  Server,
  Sparkles,
} from 'lucide-vue-next';
import { useLibrary } from '../stores/library';
import type { AppInfo } from '../../shared/api';
import { useWorkspaceUI } from '../stores/workspace-ui';
const ui = useWorkspaceUI();
const tabs = [
  { id: 'appearance', label: '外观', icon: Monitor },
  { id: 'toolbar', label: '顶栏', icon: PanelTop },
  { id: 'library', label: '资料库', icon: Database },
  { id: 'backup', label: '备份', icon: Archive },
  { id: 'assistant', label: 'AI 助手', icon: Sparkles },
  { id: 'mcp', label: 'MCP', icon: Server },
  { id: 'about', label: '关于', icon: Globe },
];
import ToolbarSettings from '../components/ToolbarSettings.vue';
import AppearanceSettings from '../components/AppearanceSettings.vue';
const application = ref<AppInfo>();
const emit = defineEmits<{ website: [] }>(),
  store = useLibrary();
const form = reactive({
    baseURL: '',
    model: '',
    apiKey: '',
    mcpEnabled: false,
    mcpPort: 53142,
  }),
  showToken = ref(false),
  loaded = ref(false);
function fill() {
  const s = store.settings;
  if (s)
    Object.assign(form, {
      baseURL: s.ai.baseURL,
      model: s.ai.model,
      mcpEnabled: s.mcp.enabled,
      mcpPort: s.mcp.port,
    });
  loaded.value = true;
}
onMounted(async () => {
  const result = await store.run(() => api.settings(), '设置已加载');
  if (result) {
    store.settings = result;
    fill();
  }
  application.value = await store.run(() => api.appInfo(), '设置已加载');
});
async function saveAI() {
  const result = await store.run(
    () =>
      api.saveSettings({
        baseURL: form.baseURL,
        model: form.model,
        ...(form.apiKey ? { apiKey: form.apiKey } : {}),
      }),
    '模型设置已保存',
  );
  if (result) {
    store.settings = result;
    form.apiKey = '';
  }
}
async function clearKey() {
  if (
    !(await store.confirm(
      '移除已保存的 API 密钥？',
      '模型连接信息会保留，密钥将从本机安全存储中移除。',
      '移除密钥',
    ))
  )
    return;
  const result = await store.run(() => api.saveSettings({ apiKey: '' }), '密钥已移除');
  if (result) store.settings = result;
}
async function saveMCP() {
  const result = await store.run(
    () => api.saveSettings({ mcpEnabled: form.mcpEnabled, mcpPort: Number(form.mcpPort) }),
    'MCP 设置已保存',
  );
  if (result) store.settings = result;
}
async function backup() {
  const result = await store.run(() => api.backupLibrary(), '资料库备份完成');
  if (result) store.status = '备份已保存到 ' + result;
}
async function copyMCP(mode: 'http' | 'stdio' = 'http') {
  await store.run(() => api.copyMCPConfiguration(mode), 'MCP 配置已复制');
}
</script>
<template>
  <section class="workspace settings-workspace">
    <header class="settings-header">
      <div class="heading-block">
        <h1>设置</h1>
      </div>
      <nav class="settings-tabs" role="tablist" aria-label="设置分类">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          role="tab"
          :id="'settings-tab-' + tab.id"
          :aria-selected="ui.settingsTab === tab.id"
          :aria-controls="'settings-panel-' + tab.id"
          :class="{ active: ui.settingsTab === tab.id }"
          @click="ui.settingsTab = tab.id"
        >
          <component :is="tab.icon" :size="17" /><span>{{ tab.label }}</span>
        </button>
      </nav>
    </header>
    <div class="settings-scroll">
      <div
        class="settings-content"
        role="tabpanel"
        :id="'settings-panel-' + ui.settingsTab"
        :aria-labelledby="'settings-tab-' + ui.settingsTab"
      >
        <ToolbarSettings v-show="ui.settingsTab === 'toolbar'" />
        <section v-if="application" v-show="ui.settingsTab === 'about'" class="settings-section">
          <h2><Monitor :size="19" />关于 {{ application.name }}</h2>
          <div class="settings-card">
            <div class="setting-row">
              <div>
                <strong>{{ application.name }} {{ application.version }}</strong>
                <p>
                  构建 {{ application.commit || '开发工作区' }} ·
                  {{
                    application.builtAt
                      ? new Date(application.builtAt).toLocaleString('zh-CN')
                      : '本地开发'
                  }}
                </p>
                <p class="path-text">{{ application.executable }}</p>
              </div>
              <span class="tag">{{ application.packaged ? '发行版' : '开发版' }}</span>
            </div>
          </div>
        </section>
        <section v-show="ui.settingsTab === 'library'" class="settings-section">
          <h2><Database :size="19" />本地资料库</h2>
          <div class="settings-card">
            <div class="setting-row">
              <div>
                <strong>当前资料库</strong>
                <p class="path-text">{{ store.snapshot?.root }}</p>
                <p>JSON 索引与真实文件目录，可离线管理。</p>
              </div>
              <span class="tag">schema {{ store.state.schemaVersion }}</span>
            </div>
            <div v-if="store.snapshot?.warnings.length" class="warning-banner">
              <p v-for="warning in store.snapshot.warnings" :key="warning">{{ warning }}</p>
            </div>
            <div class="setting-actions">
              <button @click="store.chooseLibrary(true)" :disabled="!!store.busy">
                <Download :size="16" />复制导入旧资料库…</button
              ><button @click="store.chooseLibrary(false)" :disabled="!!store.busy">
                <FolderOpen :size="16" />打开 Desktop 资料库…
              </button>
            </div>
            <p class="field-note">
              导入会创建独立副本，原 Swift 资料库和课件保持不变。外部引用文件不会随资料库自动复制。
            </p>
          </div>
        </section>
        <section v-show="ui.settingsTab === 'backup'" class="settings-section">
          <h2><Archive :size="19" />资料库备份</h2>
          <div class="settings-card">
            <div class="setting-row">
              <div>
                <strong>保存完整资料库副本</strong>
                <p>备份课程、计划、索引和库内文件，可在需要时重新打开。</p>
              </div>
              <button @click="backup" :disabled="!!store.busy">
                <Archive :size="16" />备份完整资料库…
              </button>
            </div>
            <p class="field-note">外部引用与挂载目录保留在原位置，请另外备份这些文件。</p>
          </div>
        </section>
        <section v-show="ui.settingsTab === 'assistant'" class="settings-section">
          <h2><Sparkles :size="19" />AI 助手</h2>
          <form class="settings-card form-stack" @submit.prevent="saveAI">
            <label
              >API 基础地址<input
                type="url"
                v-model="form.baseURL"
                placeholder="https://api.example.com/v1"
                autocomplete="off"
                required /></label
            ><label
              >模型名称<input
                v-model="form.model"
                placeholder="输入服务提供的模型 ID"
                autocomplete="off"
                required /></label
            ><label
              >API 密钥<input
                type="password"
                v-model="form.apiKey"
                :placeholder="
                  store.settings?.ai.hasKey ? '已保存；更换地址后需重新填写' : '本地服务可留空'
                "
                autocomplete="new-password"
            /></label>
            <p class="field-note">
              <KeyRound :size="13" />密钥通过操作系统安全存储保护，不写入资料库 JSON。
            </p>
            <div class="setting-actions">
              <button
                class="primary"
                :disabled="!loaded || !!store.busy || !form.baseURL || !form.model"
              >
                <Save :size="15" />保存模型设置</button
              ><button v-if="store.settings?.ai.hasKey" type="button" @click="clearKey">
                移除密钥
              </button>
            </div>
            <p class="field-note">
              发送消息后，对话与工具查询到的课程、计划、资料元数据会发送到此服务。聊天记录保存在本机。
            </p>
          </form>
        </section>
        <section v-show="ui.settingsTab === 'mcp'" class="settings-section">
          <h2><Server :size="19" />MCP 连接</h2>
          <form class="settings-card form-stack" @submit.prevent="saveMCP">
            <div class="setting-row">
              <div>
                <strong>允许本机 MCP 客户端访问资料库</strong>
                <p>绑定 127.0.0.1，使用 Bearer 令牌鉴权。</p>
              </div>
              <label class="switch"
                ><input
                  v-model="form.mcpEnabled"
                  type="checkbox"
                  aria-label="启用 MCP Server" /><span
              /></label>
            </div>
            <label
              >服务端口<input type="number" min="1024" max="65535" v-model="form.mcpPort" required
            /></label>
            <div class="setting-actions">
              <button class="primary" :disabled="!loaded || !!store.busy">保存 MCP 设置</button
              ><span class="service-state" :class="{ enabled: store.settings?.mcp.enabled }"
                ><span class="inline-dot" />{{
                  store.settings?.mcp.enabled ? '服务已启用' : '服务未启用'
                }}</span
              >
            </div>
            <template v-if="store.settings?.mcp.enabled && store.settings.mcp.token"
              ><div class="token-row">
                <code>{{ showToken ? store.settings.mcp.token : '••••••••••••••••••••••••' }}</code
                ><button type="button" @click="showToken = !showToken">
                  {{ showToken ? '隐藏' : '显示令牌' }}</button
                ><button type="button" @click="copyMCP('http')"><Copy :size="14" />复制 HTTP</button
                ><button type="button" @click="copyMCP('stdio')">复制 stdio</button>
              </div>
              <p class="field-note">
                持有令牌的本机客户端可调用已启用工具，请只配置到信任的客户端。
              </p></template
            >
          </form>
        </section>
        <AppearanceSettings v-show="ui.settingsTab === 'appearance'" />
        <section v-show="ui.settingsTab === 'library'" class="settings-section">
          <h2><Globe :size="19" />教学网站</h2>
          <div class="settings-card setting-row">
            <div>
              <strong>南京大学教学平台与课表</strong>
              <p>在隔离的 Chromium 窗口登录并读取当前页面。</p>
            </div>
            <button @click="emit('website')">打开教学网站工具</button>
          </div>
        </section>
      </div>
    </div>
  </section>
</template>
