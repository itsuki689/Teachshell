import type { ToolbarAction } from '../../shared/toolbar';
/** Mirrors ToolbarSettings.swift's semantic symbol choices. */
export const toolbarSymbols: Record<ToolbarAction, string> = {
  update: 'refresh',
  settings: 'gear',
  import: 'import',
  create: 'plus',
  schedule: 'calendar',
  allMaterials: 'tray-full',
  favorites: 'star',
  recent: 'clock',
  homework: 'folder',
  pendingTasks: 'checklist',
};
