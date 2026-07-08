import { describe, expect, it } from 'vitest'

import { visibleSprintFilterOptions } from '@/components/kanban/sprint-filter-options'
import type { BoardData } from '@/components/kanban/types'

const ACTIVE = '00000000-0000-4000-8000-0000000000a1'
const PLANNED = '00000000-0000-4000-8000-0000000000a2'
const COMPLETED = '00000000-0000-4000-8000-0000000000a3'

const sprints: BoardData['sprints'] = [
  {
    id: ACTIVE,
    name: 'Active',
    status: 'ACTIVE',
    position: 1,
    description: null,
    startDate: null,
    endDate: null,
  },
  {
    id: PLANNED,
    name: 'Planned',
    status: 'PLANNED',
    position: 2,
    description: null,
    startDate: null,
    endDate: null,
  },
  {
    id: COMPLETED,
    name: 'Completed',
    status: 'COMPLETED',
    position: 3,
    description: null,
    startDate: null,
    endDate: null,
  },
]

describe('visibleSprintFilterOptions', () => {
  it('hides completed sprints by default', () => {
    expect(visibleSprintFilterOptions(sprints, false, []).map((sprint) => sprint.id)).toEqual([
      ACTIVE,
      PLANNED,
    ])
  })

  it('shows completed sprints when enabled', () => {
    expect(visibleSprintFilterOptions(sprints, true, []).map((sprint) => sprint.id)).toEqual([
      ACTIVE,
      PLANNED,
      COMPLETED,
    ])
  })

  it('keeps a selected completed sprint visible while completed sprints are hidden', () => {
    expect(visibleSprintFilterOptions(sprints, false, [COMPLETED]).map((sprint) => sprint.id)).toEqual([
      ACTIVE,
      PLANNED,
      COMPLETED,
    ])
  })
})
