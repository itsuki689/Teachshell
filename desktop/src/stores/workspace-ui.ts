import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import { swiftNow } from '../../shared/model';
import { shanghaiDayKey } from '../../shared/timetable';
import { readDisplayPreferences } from '../../shared/workspace-ui';
import { validScheduleDay } from '../../shared/schedule';
import type { ScheduleFilter, ScheduleMode } from '../../shared/schedule';
import { useLibrary } from './library';

const preferenceKey = 'teachshell.display-preferences.v1';
function loadPreferences() {
  try {
    return readDisplayPreferences(JSON.parse(localStorage.getItem(preferenceKey) ?? 'null'));
  } catch {
    return readDisplayPreferences(null);
  }
}
function freshWorkspace() {
  return {
    semester: '',
    day: shanghaiDayKey(swiftNow()),
    timetableTermID: '',
    timetableWeeks: {} as Record<string, number>,
    scheduleFilters: {
      courseID: '',
      filter: 'active' as ScheduleFilter,
      showsFixed: true,
      showsActivities: true,
      query: '',
    },
  };
}

/** Only display enums persist. Course names, library paths and dates stay in memory. */
export const useWorkspaceUI = defineStore('workspace-ui', () => {
  const library = useLibrary(),
    preferences = ref(loadPreferences()),
    settingsTab = ref('appearance'),
    workspace = ref(freshWorkspace()),
    identity = computed(() => library.snapshot?.workspaceID ?? library.snapshot?.root ?? '');
  watch(
    identity,
    () => {
      workspace.value = freshWorkspace();
    },
    { flush: 'sync' },
  );
  watch(
    preferences,
    (value) => {
      try {
        localStorage.setItem(preferenceKey, JSON.stringify(value));
      } catch {
        /* Display choices remain usable when local storage is unavailable. */
      }
    },
    { deep: true, flush: 'sync' },
  );
  const semester = computed({
    get: () => workspace.value.semester,
    set: (value: string) => {
      workspace.value.semester = value;
    },
  });
  const day = computed({
    get: () => workspace.value.day,
    set: (value: string) => {
      if (validScheduleDay(value)) workspace.value.day = value;
    },
  });
  const timetableTermID = computed({
    get: () => workspace.value.timetableTermID,
    set: (value: string) => {
      workspace.value.timetableTermID = value;
    },
  });
  const libraryLayout = computed({
    get: () => preferences.value.libraryLayout,
    set: (value: 'list' | 'grid') => {
      preferences.value.libraryLayout = value;
    },
  });
  const planMode = computed({
    get: () => preferences.value.planMode,
    set: (value: 'list' | 'agenda' | 'month') => {
      preferences.value.planMode = value;
    },
  });
  const timetableMode = computed({
    get: () => preferences.value.timetableMode,
    set: (value: 'list' | 'timeline') => {
      preferences.value.timetableMode = value;
    },
  });
  const scheduleMode = computed(() => preferences.value.scheduleMode);
  const scheduleFilters = computed(() => workspace.value.scheduleFilters);
  async function openSchedule(mode: ScheduleMode = preferences.value.scheduleMode) {
    if (!(await library.navigate('timetable'))) return false;
    preferences.value.scheduleMode = mode;
    // Keep the previous display preference readable for older app versions.
    if (mode !== 'week') preferences.value.planMode = mode;
    if (mode === 'week') preferences.value.timetableMode = 'timeline';
    return true;
  }
  function weekFor(termID: string) {
    return workspace.value.timetableWeeks[termID];
  }
  function rememberWeek(termID: string, week: number) {
    workspace.value.timetableWeeks[termID] = week;
  }
  return {
    openSchedule,
    scheduleMode,
    scheduleFilters,
    identity,
    settingsTab,
    semester,
    day,
    timetableTermID,
    libraryLayout,
    planMode,
    timetableMode,
    weekFor,
    rememberWeek,
  };
});
