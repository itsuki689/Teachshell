import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { DesktopAPI } from '../../shared/api';
const invoke = (method: string, ...args: unknown[]) =>
  ipcRenderer.invoke('teachshelf:' + method, ...args);
const subscribe = (channel: string, callback: (value: any) => void) => {
  const handler = (_event: Electron.IpcRendererEvent, value: unknown) => callback(value);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};
const api: DesktopAPI = {
  appInfo: () => invoke('appInfo'),
  listHomework: (cid, relative) => invoke('listHomework', cid, relative),
  createHomeworkFolder: (cid, relative, name) =>
    invoke('createHomeworkFolder', cid, relative, name),
  renameHomework: (cid, relative, name) => invoke('renameHomework', cid, relative, name),
  importHomework: (cid, relative) => invoke('importHomework', cid, relative),
  openHomework: (cid, relative) => invoke('openHomework', cid, relative),
  revealHomework: (cid, relative) => invoke('revealHomework', cid, relative),
  mountHomework: (cid, reset) => invoke('mountHomework', cid, reset),
  exportMaterials: (ids) => invoke('exportMaterials', ids),
  snapshot: () => invoke('snapshot'),
  createCourse: (input) => invoke('createCourse', input),
  updateCourse: (id, patch) => invoke('updateCourse', id, patch),
  deleteCourse: (id) => invoke('deleteCourse', id),
  importFiles: (input) => invoke('importFiles', input),
  importDropped: (files, input) =>
    invoke(
      'importDropped',
      files.map((file) => webUtils.getPathForFile(file)).filter(Boolean),
      input,
    ),
  updateMaterial: (id, patch, expected) => invoke('updateMaterial', id, patch, expected),
  moveMaterials: (ids, courseID, folderID) => invoke('moveMaterials', ids, courseID, folderID),
  removeMaterials: (ids) => invoke('removeMaterials', ids),
  createFolder: (input) => invoke('createFolder', input),
  updateFolder: (id, patch) => invoke('updateFolder', id, patch),
  dissolveFolder: (id) => invoke('dissolveFolder', id),
  openMaterial: (id) => invoke('openMaterial', id),
  revealMaterial: (id) => invoke('revealMaterial', id),
  previewMaterial: (id) => invoke('previewMaterial', id),
  sync: () => invoke('sync'),
  importLibrary: () => invoke('importLibrary'),
  openLibrary: () => invoke('openLibrary'),
  backupLibrary: () => invoke('backupLibrary'),
  importTimetable: (proposalID) => invoke('importTimetable', proposalID),
  saveTimetableSettings: (id, input) => invoke('saveTimetableSettings', id, input),
  cancelTimetableClass: (id, mid, date, reason) =>
    invoke('cancelTimetableClass', id, mid, date, reason),
  restoreTimetableClass: (id, cid) => invoke('restoreTimetableClass', id, cid),
  rescheduleTimetableClass: (id, mid, date, input) =>
    invoke('rescheduleTimetableClass', id, mid, date, input),
  restoreTimetableMove: (id, rid) => invoke('restoreTimetableMove', id, rid),
  setTimetableMeetingMonthVisible: (id, mid, visible) =>
    invoke('setTimetableMeetingMonthVisible', id, mid, visible),
  savePlan: (input, scope, originalDate, expectedRevision) =>
    invoke('savePlan', input, scope, originalDate, expectedRevision),
  setPlanStatus: (id, action, scope, date) => invoke('setPlanStatus', id, action, scope, date),
  deletePlan: (id, scope, date) => invoke('deletePlan', id, scope, date),
  saveTask: (task) => invoke('saveTask', task),
  deleteTasks: (ids) => invoke('deleteTasks', ids),
  copyMCPConfiguration: (mode) => invoke('copyMCPConfiguration', mode),
  settings: () => invoke('settings'),
  saveSettings: (input) => invoke('saveSettings', input),
  chatHistory: () => invoke('chatHistory'),
  sendChat: (text) => invoke('sendChat', text),
  cancelChat: () => invoke('cancelChat'),
  confirmTool: (id, approved) => invoke('confirmTool', id, approved),
  clearChat: () => invoke('clearChat'),
  connectWebsite: (pid, cid, history) => invoke('connectWebsite', pid, cid, history),
  previewWebsiteAssignment: (pid, cid) => invoke('previewWebsiteAssignment', pid, cid),
  applyWebsiteAssignment: (pid) => invoke('applyWebsiteAssignment', pid),
  disconnectWebsite: (cid) => invoke('disconnectWebsite', cid),
  updateWebsiteOptions: (cid, input) => invoke('updateWebsiteOptions', cid, input),
  resolveWebsiteDeadline: (cid, key, use, revision) =>
    invoke('resolveWebsiteDeadline', cid, key, use, revision),
  openWebsite: (url, kind) => invoke('openWebsite', url, kind),
  importWebsite: (input) => invoke('importWebsite', input),
  inspectWebsite: (kind) => invoke('inspectWebsite', kind),
  onChanged: (callback) => subscribe('teachshelf:changed', callback),
  onChat: (callback) => subscribe('teachshelf:chat', callback),
  onMenu: (callback) => subscribe('teachshelf:menu', callback),
};
contextBridge.exposeInMainWorld('teachshelf', api);
