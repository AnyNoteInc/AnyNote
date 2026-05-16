import type { BoardData } from './types'

export function visibleSprintFilterOptions(
  sprints: BoardData['sprints'],
  showCompleted: boolean,
  selectedSprintIds: readonly string[],
): BoardData['sprints'] {
  const selected = new Set(selectedSprintIds)
  return sprints.filter(
    (sprint) => sprint.status !== 'COMPLETED' || showCompleted || selected.has(sprint.id),
  )
}
