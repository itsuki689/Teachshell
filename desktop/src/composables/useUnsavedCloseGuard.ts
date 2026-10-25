import { onMounted, onUnmounted } from 'vue';
/** Electron's main process presents the native leave-or-keep-editing decision. */
export function useUnsavedCloseGuard(isDirty: () => boolean) {
  function preventClose(event: BeforeUnloadEvent) {
    let dirty = true;
    try {
      dirty = isDirty();
    } catch {
      /* Incomplete form values are still unsaved. */
    }
    if (!dirty) return;
    event.preventDefault();
    event.returnValue = '';
  }
  onMounted(() => window.addEventListener('beforeunload', preventClose));
  onUnmounted(() => window.removeEventListener('beforeunload', preventClose));
}
