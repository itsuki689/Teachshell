import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { emptyLibrary } from '../../shared/model.ts';
import type { Snapshot, Settings } from '../../shared/api';
interface WorkspaceLocation {
  route: string;
  folderID?: string;
}
export const useLibrary = defineStore('library', () => {
  const snapshot = ref<Snapshot | null>(null),
    settings = ref<Settings | null>(null),
    error = ref(''),
    status = ref('正在打开资料库…'),
    busy = ref(0),
    route = ref('all'),
    folderID = ref<string | undefined>(),
    selected = ref<string[]>([]);
  const backHistory = ref<WorkspaceLocation[]>([]),
    forwardHistory = ref<WorkspaceLocation[]>([]),
    searchNavigationID = ref(0);
  let leaveGuard: (() => Promise<boolean>) | undefined;
  const confirmRequest = ref<{ title: string; detail: string; action: string } | null>(null);
  let confirmResolve: ((v: boolean) => void) | undefined;
  const state = computed(() => snapshot.value?.state ?? emptyLibrary());
  const workspaceID = computed(() => snapshot.value?.workspaceID ?? snapshot.value?.root);
  const courseID = computed(() =>
    route.value.startsWith('course:') ? route.value.slice(7) : undefined,
  );
  const course = computed(() => state.value.courses.find((c) => c.id === courseID.value));
  const title = computed(
    () =>
      course.value?.name ??
      {
        all: '全部资料',
        favorites: '我的收藏',
        recent: '最近打开',
        unassigned: '未分类',
        plans: '计划',
        timetable: '课表',
        homework: '作业文件夹',
        pending: '待完成计划',
        assistant: 'AI 助手',
        settings: '设置',
      }[route.value] ??
      '资料库',
  );
  const canGoBack = computed(() => backHistory.value.length > 0),
    canGoForward = computed(() => forwardHistory.value.length > 0);
  const location = () => ({ route: route.value, folderID: folderID.value });
  const sameLocation = (a: WorkspaceLocation, b: WorkspaceLocation) =>
    a.route === b.route && a.folderID === b.folderID;
  function validLocation(value: WorkspaceLocation) {
    const id = value.route.startsWith('course:') ? value.route.slice(7) : undefined;
    if (id && !state.value.courses.some((c) => c.id === id)) return false;
    if (value.folderID)
      return (
        (id || value.route === 'unassigned') &&
        state.value.materialFolders.some((f) => f.id === value.folderID && f.courseID === id)
      );
    return true;
  }
  function applyLocation(value: WorkspaceLocation) {
    route.value = value.route;
    folderID.value = value.folderID;
    selected.value = [];
  }
  function registerLeaveGuard(guard: () => Promise<boolean>) {
    leaveGuard = guard;
    return () => {
      if (leaveGuard === guard) leaveGuard = undefined;
    };
  }
  async function requestLeave() {
    const context = workspaceID.value;
    const approved = leaveGuard ? await leaveGuard() : true;
    return approved && context === workspaceID.value;
  }
  async function navigate(to: string, folder?: string) {
    const destination = { route: to, folderID: folder };
    if (!validLocation(destination) || !(await requestLeave()) || !validLocation(destination))
      return false;
    const previous = location();
    if (!sameLocation(previous, destination)) {
      if (!backHistory.value.length || !sameLocation(backHistory.value.at(-1)!, previous))
        backHistory.value.push(previous);
      if (backHistory.value.length > 60) backHistory.value.splice(0, backHistory.value.length - 60);
      forwardHistory.value = [];
    }
    applyLocation(destination);
    return true;
  }
  async function stepHistory(backwards: boolean) {
    if (!(await requestLeave())) return;
    const source = backwards ? backHistory : forwardHistory,
      target = backwards ? forwardHistory : backHistory;
    let destination: WorkspaceLocation | undefined;
    while (source.value.length && !destination) {
      const next = source.value.pop()!;
      if (validLocation(next)) destination = next;
    }
    if (!destination) return;
    target.value.push(location());
    if (target.value.length > 60) target.value.shift();
    applyLocation(destination);
  }
  async function revealMaterial(id: string) {
    const item = state.value.materials.find((m) => m.id === id);
    if (!item) return false;
    if (!(await navigate(item.courseID ? 'course:' + item.courseID : 'unassigned', item.folderID)))
      return false;
    searchNavigationID.value++;
    selected.value = [item.id];
    return true;
  }
  function resetNavigation() {
    backHistory.value = [];
    forwardHistory.value = [];
    applyLocation({ route: 'all' });
    selected.value = [];
  }
  function accept(value: Snapshot) {
    // An older IPC reply can arrive after a newer filesystem/MCP change event.
    if (snapshot.value && value.sequence <= snapshot.value.sequence) return false;
    const switched = !!snapshot.value && workspaceID.value !== (value.workspaceID ?? value.root);
    snapshot.value = value;
    if (switched) {
      decide(false);
      leaveGuard = undefined;
      error.value = '';
      resetNavigation();
    }
    backHistory.value = backHistory.value.filter(validLocation);
    forwardHistory.value = forwardHistory.value.filter(validLocation);
    if (courseID.value && !value.state.courses.some((c) => c.id === courseID.value))
      applyLocation({ route: 'all' });
    else if (!validLocation(location())) folderID.value = undefined;
    selected.value = selected.value.filter((id) => value.state.materials.some((m) => m.id === id));
    return true;
  }
  async function run<T>(
    fn: () => Promise<T>,
    label = '已保存',
    workspaceScoped = true,
  ): Promise<T | undefined> {
    const context = workspaceID.value;
    const current = () => !workspaceScoped || !context || context === workspaceID.value;
    busy.value++;
    try {
      const value = await fn();
      if (!current()) return undefined;
      status.value = label;
      return value;
    } catch (e) {
      if (!current()) return undefined;
      error.value = e instanceof Error ? e.message : String(e);
      status.value = '操作未完成';
      return undefined;
    } finally {
      busy.value--;
    }
  }
  async function change(fn: () => Promise<Snapshot>, label = '已保存') {
    const result = await run(fn, label);
    if (!result) return;
    accept(result);
    // Callers need their own committed result (created IDs/edit baselines), even
    // when a more recent observation already supplies the visible UI state.
    return result;
  }
  async function refresh() {
    return change(() => window.teachshelf.snapshot(), '资料库已加载');
  }
  async function chooseLibrary(copy: boolean) {
    if (busy.value || !(await requestLeave())) return;
    await run(
      async () => {
        const result = await (copy
          ? window.teachshelf.importLibrary()
          : window.teachshelf.openLibrary());
        if (result) {
          accept(result);
          resetNavigation();
        }
      },
      copy ? '资料库复制导入完成' : '资料库已打开',
      false,
    );
  }
  function confirm(title: string, detail: string, action = '确认'): Promise<boolean> {
    if (confirmResolve) confirmResolve(false);
    confirmRequest.value = { title, detail, action };
    return new Promise((resolve) => {
      confirmResolve = resolve;
    });
  }
  function decide(approved: boolean) {
    confirmRequest.value = null;
    confirmResolve?.(approved);
    confirmResolve = undefined;
  }
  return {
    snapshot,
    settings,
    error,
    status,
    busy,
    route,
    folderID,
    selected,
    state,
    workspaceID,
    courseID,
    course,
    title,
    confirmRequest,
    navigate,
    accept,
    run,
    change,
    refresh,
    chooseLibrary,
    confirm,
    decide,
    canGoBack,
    canGoForward,
    searchNavigationID,
    registerLeaveGuard,
    requestLeave,
    revealMaterial,
    goBack: () => stepHistory(true),
    goForward: () => stepHistory(false),
  };
});
