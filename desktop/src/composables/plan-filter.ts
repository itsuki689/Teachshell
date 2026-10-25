import type { StudyTask } from '../../shared/model';
import { planSnapshot, readPlan } from '../../shared/plans';
export type PlanFilter =
  'active' | 'unscheduled' | 'pending' | 'completed' | 'cancelled' | 'archived' | 'all';
export function matchesPlanStatus(task: StudyTask, filter: PlanFilter): boolean {
  const archived = task.archivedAt != null,
    cancelled = task.cancelledAt != null,
    completed = task.completedAt != null,
    required = task.completionRequired !== false;
  switch (filter) {
    case 'all':
      return true;
    case 'active':
      return !archived;
    case 'archived':
      return archived;
    case 'unscheduled':
      return !archived && !cancelled && !(task.hasExecutionTime ?? task.deadline == null);
    case 'pending':
      return !archived && !cancelled && required && !completed;
    case 'completed':
      return !archived && !cancelled && required && completed;
    case 'cancelled':
      return !archived && cancelled;
  }
}
export function planVariants(task: StudyTask) {
  const plan = readPlan(task);
  return [plan, ...plan.exceptions.map((change) => planSnapshot(plan, change.originalDate))];
}
