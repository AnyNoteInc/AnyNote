import type { KanbanFilters } from '../filters/apply-filters'

export function resolveAddSprintId(
  sprintFilter: KanbanFilters['sprint'],
  sprints: ReadonlyArray<{ id: string; status: string }>,
): string | undefined {
  if (sprintFilter === 'all') return undefined
  if (sprintFilter === 'current') {
    return sprints.find((s) => s.status === 'ACTIVE')?.id ?? undefined
  }
  // array form: only unambiguous when exactly one sprint is selected
  if (Array.isArray(sprintFilter) && sprintFilter.length === 1) {
    const id = sprintFilter[0]!
    return sprints.some((s) => s.id === id) ? id : undefined
  }
  return undefined
}
