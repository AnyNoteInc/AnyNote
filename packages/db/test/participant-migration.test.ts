import { describe, it, expect } from 'vitest'
import { prisma } from '../src'

// Assumes the migration has run against the test DB.
describe('participant migration integrity', () => {
  it('every task_assignee points at a participant whose user matches its task workspace', async () => {
    const rows = await prisma.taskAssignee.findMany({
      include: { participant: true, task: { include: { page: true } } },
    })
    for (const row of rows) {
      expect(row.participant.workspaceId).toBe(row.task.page.workspaceId)
    }
  })
})
