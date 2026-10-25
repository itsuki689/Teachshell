export const toolbarActions = [
  'update',
  'settings',
  'import',
  'create',
  'schedule',
  'allMaterials',
  'favorites',
  'recent',
  'homework',
  'pendingTasks',
] as const;
export type ToolbarAction = (typeof toolbarActions)[number];
export type ToolbarRequest = ToolbarAction | 'create-course' | 'create-plan' | 'connect-website';
export const defaultToolbarActions: ToolbarAction[] = ['update', 'settings', 'import', 'create'];
export const toolbarTitles: Record<ToolbarAction, string> = {
  update: '全局更新',
  settings: '设置',
  import: '导入资料',
  create: '新建',
  schedule: '计划',
  allMaterials: '全部资料',
  favorites: '收藏',
  recent: '最近打开',
  homework: '作业文件夹',
  pendingTasks: '待完成计划',
};
export function readToolbarActions(input: unknown): ToolbarAction[] {
  if (input === undefined) return [...defaultToolbarActions];
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('顶栏设置无效');
  const actions = (input as { actions?: unknown }).actions;
  if (
    !Array.isArray(actions) ||
    actions.length > 6 ||
    new Set(actions).size !== actions.length ||
    actions.some((action) => !toolbarActions.includes(action))
  )
    throw new Error('顶栏最多选择六个不同的有效操作');
  return [...actions];
}
