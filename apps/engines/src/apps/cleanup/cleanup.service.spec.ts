import { jest } from '@jest/globals'
import type { Pool } from 'pg'

import { CleanupService } from './cleanup.service.js'

describe('CleanupService.purgeOrphanedInterrupts', () => {
  it('returns the deleted count from the cleanup CTE', async () => {
    const query = jest.fn<Pool['query']>().mockResolvedValue({
      rows: [{ deleted: 7 }],
      rowCount: 1,
      command: 'SELECT',
      oid: 0,
      fields: [],
    } as never)
    const fakeDb = { query } as unknown as Pool

    const svc = new CleanupService(fakeDb)
    const deleted = await svc.purgeOrphanedInterrupts()

    expect(deleted).toBe(7)
    expect(query).toHaveBeenCalledTimes(1)
    const sql = (query.mock.calls[0]![0] as string).toUpperCase()
    expect(sql).toContain('CHECKPOINTS')
    expect(sql).toContain('CHECKPOINT_WRITES')
    expect(sql).toContain('__INTERRUPT__')
    expect(sql).toContain('24 HOURS')
  })

  it('returns 0 when no rows match', async () => {
    const query = jest.fn<Pool['query']>().mockResolvedValue({
      rows: [{ deleted: 0 }],
      rowCount: 1,
      command: 'SELECT',
      oid: 0,
      fields: [],
    } as never)
    const fakeDb = { query } as unknown as Pool

    const svc = new CleanupService(fakeDb)
    expect(await svc.purgeOrphanedInterrupts()).toBe(0)
  })
})
