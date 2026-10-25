<script setup lang="ts">
const api = window.teachshelf;
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import {
  ChevronRight,
  Download,
  File,
  Folder,
  FolderPlus,
  Globe,
  Grid2X2,
  Info,
  List,
  MoreHorizontal,
  MoveRight,
  Search,
  Star,
  Trash2,
  Upload,
  X,
} from 'lucide-vue-next';
import { dateMs } from '../../shared/model';
import { compareMaterials, compareNames } from '../../shared/ordering';
import type { Course, Material, MaterialFolder } from '../../shared/model';
import { useLibrary } from '../stores/library';
import FolderEditor from '../components/FolderEditor.vue';
import MaterialInspector from '../components/MaterialInspector.vue';
import PreviewDialog from '../components/PreviewDialog.vue';
import Modal from '../components/Modal.vue';
const emit = defineEmits<{ import: []; editCourse: [course?: Course]; website: [] }>(),
  store = useLibrary();
const query = ref(''),
  category = ref(''),
  format = ref(''),
  sort = ref<string>(store.course?.materialSort ?? 'time'),
  layout = ref('list'),
  showInspector = ref(true),
  dropActive = ref(false),
  folderEditor = ref<MaterialFolder | null | undefined>(undefined),
  moving = ref(false),
  moveCourseID = ref(''),
  moveFolderID = ref(''),
  preview = ref<{ id: string; url: string; mime: string; name: string } | null>(null);
const isScoped = computed(() => !!store.courseID || store.route === 'unassigned');
const currentFolder = computed(() =>
  store.state.materialFolders.find((f) => f.id === store.folderID),
);
const breadcrumbs = computed(() => {
  const result: MaterialFolder[] = [];
  let id = store.folderID;
  const seen = new Set<string>();
  while (id && !seen.has(id)) {
    seen.add(id);
    const f = store.state.materialFolders.find((v) => v.id === id);
    if (!f) break;
    result.unshift(f);
    id = f.parentID;
  }
  return result;
});
const categories = computed(() => [...new Set(store.state.materials.map((m) => m.category))]);
const formats = computed(() =>
  [...new Set(store.state.materials.map((m) => extension(m.originalName)))].sort(),
);
const visible = computed(() => {
  let items = store.state.materials.filter((m) => {
    if (
      isScoped.value &&
      (m.courseID !== store.courseID || (!query.value && m.folderID !== store.folderID))
    )
      return false;
    if (store.route === 'favorites' && !m.isFavorite) return false;
    if (store.route === 'recent' && !m.lastOpenedAt) return false;
    const text = [
      m.title,
      m.originalName,
      m.tags,
      m.notes,
      store.state.courses.find((c) => c.id === m.courseID)?.name,
    ]
      .join(' ')
      .toLocaleLowerCase();
    return (
      (!query.value || text.includes(query.value.toLocaleLowerCase())) &&
      (!category.value || m.category === category.value) &&
      (!format.value || extension(m.originalName) === format.value)
    );
  });
  const mode = store.route === 'recent' ? 'recent' : sort.value;
  return items.sort((a, b) => compareMaterials(a, b, mode));
});
watch(sort, async (value) => {
  const id = store.courseID;
  if (id && ['name', 'time', 'custom'].includes(value))
    await store.change(
      () => api.updateCourse(id, { materialSort: value as 'name' | 'time' | 'custom' }),
      '课程排序已保存',
    );
});
const folders = computed(() =>
  !isScoped.value || query.value || category.value || format.value
    ? []
    : store.state.materialFolders
        .filter((f) => f.courseID === store.courseID && f.parentID === store.folderID)
        .sort((a, b) => compareNames(a.name, b.name) || a.id.localeCompare(b.id)),
);
const selectedMaterial = computed(() =>
  store.selected.length === 1
    ? store.state.materials.find((m) => m.id === store.selected[0])
    : undefined,
);
const moveFolders = computed(() =>
  store.state.materialFolders.filter(
    (f) => f.courseID === (moveCourseID.value || undefined) && !f.isMissing,
  ),
);
const hasFilters = computed(() => query.value || category.value || format.value);
function extension(name: string) {
  return name.includes('.') ? name.split('.').at(-1)!.toUpperCase() : '文件';
}
function size(n: number) {
  return n < 1024
    ? n + ' B'
    : n < 1024 * 1024
      ? (n / 1024).toFixed(1) + ' KB'
      : (n / 1048576).toFixed(1) + ' MB';
}
function date(value: number | string) {
  return new Date(dateMs(value)).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
}
async function select(e: MouseEvent, m: Material) {
  if (!(await store.requestLeave())) return;
  if (e.shiftKey && store.selected.length) {
    const start = visible.value.findIndex((v) => v.id === store.selected.at(-1)),
      end = visible.value.findIndex((v) => v.id === m.id);
    if (start >= 0) {
      store.selected = [
        ...new Set([
          ...store.selected,
          ...visible.value.slice(Math.min(start, end), Math.max(start, end) + 1).map((v) => v.id),
        ]),
      ];
      return;
    }
  }
  if (e.ctrlKey || e.metaKey) toggle(m.id);
  else store.selected = [m.id];
  showInspector.value = true;
}
async function toggle(id: string) {
  if (!(await store.requestLeave())) return;
  store.selected = store.selected.includes(id)
    ? store.selected.filter((v) => v !== id)
    : [...store.selected, id];
}
async function selectAll() {
  if (!(await store.requestLeave())) return;
  store.selected = visible.value.every((m) => store.selected.includes(m.id))
    ? []
    : visible.value.map((m) => m.id);
}
function openFolder(f?: MaterialFolder) {
  void store.navigate(store.route, f?.id);
}
function beginMove() {
  moveCourseID.value = store.courseID ?? '';
  moveFolderID.value = '';
  moving.value = true;
}
async function move() {
  const result = await store.change(
    () =>
      api.moveMaterials(
        [...store.selected],
        moveCourseID.value || undefined,
        moveFolderID.value || undefined,
      ),
    '资料已移动',
  );
  if (result) {
    moving.value = false;
    store.selected = [];
  }
}
async function remove() {
  if (
    !store.selected.length ||
    !(await store.confirm(
      `移除 ${store.selected.length} 份资料记录？`,
      '只移除资料库记录和计划关联，实际文件会保留。',
      '移除记录',
    ))
  )
    return;
  await store.change(
    () => api.removeMaterials([...store.selected]),
    '资料记录已移除，实际文件已保留',
  );
}
async function exportCopies() {
  const ids = [...store.selected];
  if (!ids.length) return;
  const result = await store.run(() => api.exportMaterials(ids), '导出操作已结束');
  if (result) store.status = `已导出 ${result.exported} 份副本到 ${result.destination}`;
  else if (result === null) store.status = '已取消导出';
}
async function showPreview(id: string) {
  const result = await store.run(() => api.previewMaterial(id), '预览已打开');
  if (result) preview.value = { id, ...result };
}
function drag(e: DragEvent, m: Material) {
  if (!store.selected.includes(m.id)) store.selected = [m.id];
  e.dataTransfer?.setData('application/x-teachshelf-ids', JSON.stringify(store.selected));
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copyMove';
}
async function drop(e: DragEvent, folderID = store.folderID) {
  e.preventDefault();
  e.stopPropagation();
  dropActive.value = false;
  const raw = e.dataTransfer?.getData('application/x-teachshelf-ids');
  if (raw) {
    try {
      const ids: unknown = JSON.parse(raw);
      if (Array.isArray(ids) && ids.every((v) => typeof v === 'string'))
        await store.change(() => api.moveMaterials(ids, store.courseID, folderID), '资料已移动');
    } catch {
      store.error = '无法读取拖拽的资料';
    }
    return;
  }
  if (e.dataTransfer?.files.length) {
    const files = Array.from(e.dataTransfer.files);
    const r = await store.run(() =>
      api.importDropped(files, {
        courseID: store.courseID,
        folderID,
        copy: true,
        category: '课件',
      }),
    );
    if (r) {
      await store.refresh();
      store.status = `已导入 ${r.imported} 份，跳过 ${r.skipped} 份`;
      if (r.errors.length) store.error = r.errors.join('\n');
    }
  }
}
function leaveDrop(e: DragEvent) {
  if (
    !(e.relatedTarget instanceof Node) ||
    (e.currentTarget instanceof HTMLElement && !e.currentTarget.contains(e.relatedTarget))
  )
    dropActive.value = false;
}
function key(e: KeyboardEvent) {
  if ((e.target as HTMLElement)?.closest('input,textarea,select,[role="dialog"]')) return;
  if (e.code === 'Space' && selectedMaterial.value) {
    e.preventDefault();
    void showPreview(selectedMaterial.value.id);
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
    e.preventDefault();
    selectAll();
  }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();
    void remove();
  }
}
onMounted(() => window.addEventListener('keydown', key));
onUnmounted(() => window.removeEventListener('keydown', key));
</script>
<template>
  <section
    class="workspace library-workspace"
    :class="{ 'drop-active': dropActive }"
    @dragover.prevent="dropActive = true"
    @dragleave="leaveDrop"
    @drop="drop($event)"
  >
    <header class="workspace-header">
      <div class="heading-block">
        <div class="heading-line">
          <h1>{{ store.title }}</h1>
          <span class="subtle-count">{{ visible.length }} 份</span>
        </div>
        <p>
          {{
            store.course
              ? [
                  store.course.semester,
                  store.course.teacher,
                  store.course.isArchived ? '已归档' : '',
                ]
                  .filter(Boolean)
                  .join(' · ')
              : '课件、教材与灵感，井然有序。'
          }}
        </p>
      </div>
      <div class="toolbar-controls">
        <button v-if="store.course" @click="emit('website')"><Globe :size="15" />教学网站</button
        ><button
          v-if="store.course"
          class="icon-button"
          aria-label="编辑当前课程"
          @click="emit('editCourse', store.course)"
        >
          <MoreHorizontal :size="19" />
        </button>
        <div class="segmented">
          <button
            :class="{ active: layout === 'list' }"
            aria-label="列表视图"
            @click="layout = 'list'"
          >
            <List :size="17" /></button
          ><button
            :class="{ active: layout === 'grid' }"
            aria-label="封面视图"
            @click="layout = 'grid'"
          >
            <Grid2X2 :size="17" />
          </button>
        </div>
        <button
          class="icon-button"
          :class="{ active: showInspector }"
          aria-label="资料信息"
          :disabled="!selectedMaterial"
          @click="showInspector = !showInspector"
        >
          <Info :size="18" />
        </button>
      </div>
    </header>
    <div class="filter-bar">
      <label class="search-field"
        ><Search :size="16" /><input
          v-model="query"
          aria-label="搜索资料"
          placeholder="搜索名称、课程、标签和备注" /><button
          v-if="query"
          class="icon-button"
          aria-label="清除搜索"
          @click="query = ''"
        >
          <X :size="13" /></button></label
      ><select v-model="format" aria-label="格式筛选">
        <option value="">全部格式</option>
        <option v-for="f in formats" :key="f">{{ f }}</option></select
      ><select v-model="category" aria-label="类别筛选">
        <option value="">全部类别</option>
        <option v-for="c in categories" :key="c">{{ c }}</option></select
      ><select v-model="sort" aria-label="排序">
        <option value="time">最近添加</option>
        <option value="name">名称</option>
        <option value="recent">最近打开</option>
        <option value="size">文件大小</option>
        <option value="custom">旧版自定义顺序</option>
      </select>
    </div>
    <div v-if="isScoped" class="breadcrumb-bar">
      <button class="text-button" @click="openFolder()"><Folder :size="15" />资料</button
      ><template v-for="f in breadcrumbs" :key="f.id"
        ><ChevronRight :size="13" /><button class="text-button" @click="openFolder(f)">
          {{ f.name }}
        </button></template
      ><span class="spacer" /><button
        v-if="currentFolder"
        class="text-button"
        @click="folderEditor = currentFolder"
      >
        编辑文件夹</button
      ><button class="text-button" @click="folderEditor = null">
        <FolderPlus :size="15" />新建文件夹
      </button>
    </div>
    <div v-if="store.selected.length" class="selection-bar">
      <span>已选择 {{ store.selected.length }} 份</span
      ><button @click="beginMove"><MoveRight :size="14" />移动到…</button
      ><button :disabled="!!store.busy" @click="exportCopies">
        <Download :size="14" />导出副本…</button
      ><button @click="remove"><Trash2 :size="14" />移除记录</button><span class="spacer" /><button
        class="text-button"
        @click="store.selected = []"
      >
        取消选择
      </button>
    </div>
    <div class="library-body">
      <div class="material-canvas">
        <div v-if="!visible.length && !folders.length" class="empty-state">
          <Search v-if="hasFilters" :size="43" /><Folder v-else :size="43" />
          <h2>{{ hasFilters ? '没有匹配的资料' : '这里还没有资料' }}</h2>
          <p>
            {{
              hasFilters ? '尝试其他关键词，或清除类别与格式筛选。' : '导入资料，或将文件拖到这里。'
            }}
          </p>
          <button
            v-if="hasFilters"
            @click="
              query = '';
              category = '';
              format = '';
            "
          >
            清除筛选</button
          ><button v-else class="primary" @click="emit('import')">
            <Upload :size="15" />导入资料
          </button>
        </div>
        <template v-else
          ><table v-if="layout === 'list'" class="materials-table" aria-label="资料列表">
            <thead>
              <tr>
                <th class="check-cell">
                  <input
                    type="checkbox"
                    aria-label="选择全部资料"
                    :checked="
                      visible.length > 0 && visible.every((m) => store.selected.includes(m.id))
                    "
                    @change="selectAll"
                  />
                </th>
                <th>名称</th>
                <th>类别</th>
                <th>大小</th>
                <th>添加日期</th>
                <th class="star-cell">收藏</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="f in folders"
                :key="f.id"
                class="folder-row"
                @dblclick="openFolder(f)"
                @dragover.prevent
                @drop="drop($event, f.id)"
              >
                <td />
                <td>
                  <button class="folder-open" @click="openFolder(f)">
                    <Folder
                      :size="25"
                      :style="{ color: f.colorHex || store.course?.colorHex || 'var(--accent)' }"
                    /><span>{{ f.name }}<small v-if="f.isMissing">文件夹缺失</small></span
                    ><ChevronRight :size="14" />
                  </button>
                </td>
                <td>文件夹</td>
                <td />
                <td />
                <td>
                  <button
                    class="icon-button"
                    :aria-label="'编辑文件夹 ' + f.name"
                    @click="folderEditor = f"
                  >
                    <MoreHorizontal :size="16" />
                  </button>
                </td>
              </tr>
              <tr
                v-for="m in visible"
                :key="m.id"
                :class="{ selected: store.selected.includes(m.id), missing: m.isMissing }"
                :aria-selected="store.selected.includes(m.id)"
                tabindex="0"
                draggable="true"
                @click="select($event, m)"
                @dblclick="store.run(() => api.openMaterial(m.id), '已打开资料')"
                @keydown.enter="store.run(() => api.openMaterial(m.id), '已打开资料')"
                @dragstart="drag($event, m)"
              >
                <td class="check-cell" @click.stop>
                  <input
                    type="checkbox"
                    :checked="store.selected.includes(m.id)"
                    :aria-label="'选择 ' + m.title"
                    @change="toggle(m.id)"
                  />
                </td>
                <td>
                  <div class="material-name">
                    <div class="file-badge" :data-extension="extension(m.originalName)">
                      {{ extension(m.originalName).slice(0, 5) }}
                    </div>
                    <span
                      ><strong>{{ m.title }}</strong
                      ><small
                        >{{ m.isMissing ? '文件缺失 · ' : ''
                        }}{{ store.state.courses.find((c) => c.id === m.courseID)?.name ?? '未分类'
                        }}{{ m.tags ? ' · ' + m.tags : '' }}</small
                      ></span
                    >
                  </div>
                </td>
                <td>{{ m.category }}</td>
                <td>{{ size(m.size) }}</td>
                <td>{{ date(m.addedAt) }}</td>
                <td class="star-cell" @click.stop>
                  <button
                    class="icon-button"
                    :class="{ favorite: m.isFavorite }"
                    :aria-label="(m.isFavorite ? '取消收藏 ' : '收藏 ') + m.title"
                    @click="
                      store.change(
                        () => api.updateMaterial(m.id, { isFavorite: !m.isFavorite }),
                        '收藏已更新',
                      )
                    "
                  >
                    <Star :size="16" :fill="m.isFavorite ? 'currentColor' : 'none'" />
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
          <div v-else class="material-grid">
            <button
              v-for="f in folders"
              :key="f.id"
              class="material-cover folder-cover"
              @click="openFolder(f)"
              @dragover.prevent
              @drop="drop($event, f.id)"
            >
              <Folder :size="56" /><strong>{{ f.name }}</strong
              ><span>文件夹</span></button
            ><button
              v-for="m in visible"
              :key="m.id"
              class="material-cover"
              :class="{ selected: store.selected.includes(m.id) }"
              draggable="true"
              @click="select($event, m)"
              @dblclick="showPreview(m.id)"
              @dragstart="drag($event, m)"
            >
              <div class="cover-sheet">
                <File :size="46" /><span>{{ extension(m.originalName) }}</span>
              </div>
              <strong>{{ m.title }}</strong
              ><span>{{ m.isMissing ? '文件缺失' : m.category + ' · ' + size(m.size) }}</span
              ><Star v-if="m.isFavorite" class="cover-star" :size="14" fill="currentColor" />
            </button></div
        ></template>
      </div>
      <MaterialInspector
        v-if="showInspector && selectedMaterial"
        :key="selectedMaterial.id"
        :material="selectedMaterial"
        @close="showInspector = false"
        @preview="showPreview"
      />
    </div>
    <div v-if="dropActive" class="drop-label"><Upload :size="25" />松开以导入或移动资料</div>
    <FolderEditor
      v-if="folderEditor !== undefined"
      :folder="folderEditor ?? undefined"
      @close="folderEditor = undefined"
    /><PreviewDialog
      v-if="preview"
      :id="preview.id"
      :preview="preview"
      @close="preview = null"
    /><Modal v-if="moving" title="移动资料" @close="moving = false"
      ><form class="form-stack" @submit.prevent="move">
        <p class="muted">
          移动 {{ store.selected.length }} 份资料。外部引用的原文件仍保留在原位置。
        </p>
        <label
          >目标课程<select aria-label="目标课程" v-model="moveCourseID" @change="moveFolderID = ''">
            <option value="">未分类</option>
            <option v-for="c in store.state.courses" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select></label
        ><label
          >目标文件夹<select aria-label="目标文件夹" v-model="moveFolderID">
            <option value="">资料根目录</option>
            <option v-for="f in moveFolders" :key="f.id" :value="f.id">{{ f.name }}</option>
          </select></label
        >
        <div class="dialog-actions">
          <span class="spacer" /><button type="button" @click="moving = false">取消</button
          ><button class="primary" :disabled="!!store.busy">移动</button>
        </div>
      </form></Modal
    >
  </section>
</template>
