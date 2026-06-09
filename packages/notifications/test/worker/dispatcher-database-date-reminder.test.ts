import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@repo/db'

import { isDatabaseDateReminderEventStillValid } from '../../src/worker/dispatcher.ts'

// Fire-time validity for a DATABASE_DATE_REMINDER delivery: the config must still
// exist (same date+offset, row/page not deleted) AND the target user must STILL
// have row access. The access re-check is a self-contained re-implementation over
// @repo/db (the notifications package cannot import the domain resolver).

const USER = 'user-1'
const REMINDER_ID = 'rem-1'
const ROW_ID = 'row-1'
const PROP_ID = 'prop-1'
const PAGE_ID = 'page-1'
const SOURCE_ID = 'src-1'
const WS_ID = 'ws-1'
const DUE = '2026-07-01T10:00:00.000Z'

function basePayload(overrides: Record<string, unknown> = {}) {
  return {
    databaseReminderId: REMINDER_ID,
    rowId: ROW_ID,
    propertyId: PROP_ID,
    pageId: PAGE_ID,
    dueAt: DUE,
    offsetMinutes: 60,
    ...overrides,
  }
}

/**
 * Build a mock prisma that returns the configured rows. `rules` defaults to none
 * (broad/no-rule access), `role` to a plain EDITOR, `sourceCreatorId` to someone
 * else. `personCell` maps (rowId,propertyId) → value for the PERSON-rule lookup.
 */
function mockPrisma(opts: {
  config?: Record<string, unknown> | null
  row?: Record<string, unknown> | null
  dateCellValue?: unknown
  role?: string | null
  sourceCreatorId?: string | null
  rules?: Array<{ propertyId: string; type: string }>
  personCellValue?: unknown
}) {
  const config =
    opts.config === undefined
      ? {
          userId: USER,
          propertyId: PROP_ID,
          rowId: ROW_ID,
          pageId: PAGE_ID,
          offsetMinutes: 60,
        }
      : opts.config
  const row =
    opts.row === undefined
      ? {
          deletedAt: null,
          sourceId: SOURCE_ID,
          createdById: null,
          source: { workspaceId: WS_ID, pageId: PAGE_ID },
          page: { deletedAt: null },
        }
      : opts.row

  return {
    databaseDateReminder: { findUnique: vi.fn().mockResolvedValue(config) },
    databaseRow: { findUnique: vi.fn().mockResolvedValue(row) },
    databaseCellValue: {
      findUnique: vi.fn().mockImplementation(async ({ where }: { where: { rowId_propertyId: { propertyId: string } } }) => {
        // The DATE cell read vs a PERSON-rule cell read.
        if (where.rowId_propertyId.propertyId === PROP_ID) {
          const v = opts.dateCellValue === undefined ? DUE : opts.dateCellValue
          return v === null ? null : { value: v }
        }
        return opts.personCellValue === undefined ? null : { value: opts.personCellValue }
      }),
    },
    workspaceMember: {
      findUnique: vi.fn().mockResolvedValue(
        opts.role === undefined ? { role: 'EDITOR' } : opts.role === null ? null : { role: opts.role },
      ),
    },
    databaseSource: {
      findUnique: vi.fn().mockResolvedValue({
        page: { createdById: opts.sourceCreatorId ?? 'someone-else' },
      }),
    },
    databasePageAccessRule: {
      findMany: vi.fn().mockResolvedValue(
        (opts.rules ?? []).map((r) => ({ propertyId: r.propertyId, property: { type: r.type } })),
      ),
    },
  } as unknown as PrismaClient
}

describe('isDatabaseDateReminderEventStillValid', () => {
  it('returns true for a non-database-date-reminder event', async () => {
    const prisma = mockPrisma({})
    const res = await isDatabaseDateReminderEventStillValid(prisma, {
      type: 'REMINDER_DUE',
      userId: USER,
      payload: {},
    })
    expect(res).toBe(true)
  })

  it('returns false when the config is missing', async () => {
    const prisma = mockPrisma({ config: null })
    const res = await isDatabaseDateReminderEventStillValid(prisma, {
      type: 'DATABASE_DATE_REMINDER',
      userId: USER,
      payload: basePayload(),
    })
    expect(res).toBe(false)
  })

  it('returns false when the delivery user is not the config owner (self-target invariant)', async () => {
    const prisma = mockPrisma({})
    const res = await isDatabaseDateReminderEventStillValid(prisma, {
      type: 'DATABASE_DATE_REMINDER',
      userId: 'someone-else',
      payload: basePayload(),
    })
    expect(res).toBe(false)
  })

  it('returns false when the row is soft-deleted', async () => {
    const prisma = mockPrisma({
      row: {
        deletedAt: new Date(),
        sourceId: SOURCE_ID,
        createdById: null,
        source: { workspaceId: WS_ID, pageId: PAGE_ID },
        page: { deletedAt: null },
      },
    })
    const res = await isDatabaseDateReminderEventStillValid(prisma, {
      type: 'DATABASE_DATE_REMINDER',
      userId: USER,
      payload: basePayload(),
    })
    expect(res).toBe(false)
  })

  it('returns false when the DATE cell value no longer matches the scheduled dueAt', async () => {
    const prisma = mockPrisma({ dateCellValue: '2026-08-01T10:00:00.000Z' })
    const res = await isDatabaseDateReminderEventStillValid(prisma, {
      type: 'DATABASE_DATE_REMINDER',
      userId: USER,
      payload: basePayload(),
    })
    expect(res).toBe(false)
  })

  it('returns false when the DATE cell was cleared', async () => {
    const prisma = mockPrisma({ dateCellValue: null })
    const res = await isDatabaseDateReminderEventStillValid(prisma, {
      type: 'DATABASE_DATE_REMINDER',
      userId: USER,
      payload: basePayload(),
    })
    expect(res).toBe(false)
  })

  it('returns true for a valid reminder when there are no access rules (broad access)', async () => {
    const prisma = mockPrisma({ rules: [] })
    const res = await isDatabaseDateReminderEventStillValid(prisma, {
      type: 'DATABASE_DATE_REMINDER',
      userId: USER,
      payload: basePayload(),
    })
    expect(res).toBe(true)
  })

  it('returns true for an OWNER even when restrictive rules exist', async () => {
    const prisma = mockPrisma({
      role: 'OWNER',
      rules: [{ propertyId: 'person-prop', type: 'PERSON' }],
    })
    const res = await isDatabaseDateReminderEventStillValid(prisma, {
      type: 'DATABASE_DATE_REMINDER',
      userId: USER,
      payload: basePayload(),
    })
    expect(res).toBe(true)
  })

  it('returns FALSE when a PERSON rule exists and the user is NOT the assignee (access lost)', async () => {
    const prisma = mockPrisma({
      role: 'EDITOR',
      rules: [{ propertyId: 'person-prop', type: 'PERSON' }],
      personCellValue: 'a-different-user',
    })
    const res = await isDatabaseDateReminderEventStillValid(prisma, {
      type: 'DATABASE_DATE_REMINDER',
      userId: USER,
      payload: basePayload(),
    })
    expect(res).toBe(false)
  })

  it('returns true when a PERSON rule matches the target user', async () => {
    const prisma = mockPrisma({
      role: 'EDITOR',
      rules: [{ propertyId: 'person-prop', type: 'PERSON' }],
      personCellValue: USER,
    })
    const res = await isDatabaseDateReminderEventStillValid(prisma, {
      type: 'DATABASE_DATE_REMINDER',
      userId: USER,
      payload: basePayload(),
    })
    expect(res).toBe(true)
  })

  it('returns true when a CREATED_BY rule matches (the user created the row)', async () => {
    const prisma = mockPrisma({
      role: 'EDITOR',
      row: {
        deletedAt: null,
        sourceId: SOURCE_ID,
        createdById: USER,
        source: { workspaceId: WS_ID, pageId: PAGE_ID },
        page: { deletedAt: null },
      },
      rules: [{ propertyId: 'created-by-prop', type: 'CREATED_BY' }],
    })
    const res = await isDatabaseDateReminderEventStillValid(prisma, {
      type: 'DATABASE_DATE_REMINDER',
      userId: USER,
      payload: basePayload(),
    })
    expect(res).toBe(true)
  })

  it('returns false when the user is not a workspace member', async () => {
    const prisma = mockPrisma({ role: null, rules: [{ propertyId: 'p', type: 'PERSON' }] })
    const res = await isDatabaseDateReminderEventStillValid(prisma, {
      type: 'DATABASE_DATE_REMINDER',
      userId: USER,
      payload: basePayload(),
    })
    expect(res).toBe(false)
  })
})
