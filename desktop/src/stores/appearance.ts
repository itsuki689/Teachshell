import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import type { Appearance, AppearancePatch } from '../../shared/appearance';
import type { WorkspaceGuard } from '../../shared/api';
import { transitionSettings } from '../../shared/appearance';
import { useLibrary } from './library';

export const useAppearance = defineStore('appearance', () => {
  const library = useLibrary(),
    previewColor = ref<string>(),
    requestedMode = ref<Appearance>(),
    pending = ref(0),
    previewSequence = ref(0);
  let generation = 0;
  const mode = computed(() => requestedMode.value ?? (library.state.appearance as Appearance));
  const transition = computed(() => transitionSettings(library.state.appearanceTransition));
  watch(
    () => library.workspaceID,
    () => {
      generation++;
      requestedMode.value = undefined;
      previewColor.value = undefined;
    },
    { flush: 'sync' },
  );
  function save(input: AppearancePatch, baseline?: WorkspaceGuard): Promise<boolean> {
    const context = library.workspaceID,
      version = generation,
      patch = structuredClone(input);
    if (input.appearance) requestedMode.value = input.appearance;
    pending.value++;
    // Dispatch theme writes immediately. The main process serializes and flushes
    // them on quit, so closing the renderer cannot discard a queued choice.
    const snapshot = library.snapshot!;
    const guard = baseline ?? { root: snapshot.root, revision: snapshot.revision };
    const job = library
      .change(() => window.teachshelf.saveAppearance(patch, guard), '外观已保存')
      .then((result) => !!result && context === library.workspaceID && version === generation)
      .finally(() => {
        pending.value--;
        if (pending.value === 0) requestedMode.value = undefined;
      });
    return job;
  }
  return { mode, transition, pending, previewColor, previewSequence, save };
});
