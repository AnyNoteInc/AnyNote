import { describe, expect, expectTypeOf, it, vi } from 'vitest'

import type { DatabaseRepository } from '../../../src/database/repositories/database.repository.ts'
import {
  DatabaseFormRepository,
  type FormRepositoryContract,
  type FormSubmissionRecord,
} from '../../../src/database/forms/database-form.repository.ts'
import {
  FormSubmissionService,
  type PreparedFormSubmission,
} from '../../../src/database/forms/form-submission.service.ts'
import type { PageRepository } from '../../../src/pages/repositories/pages.repository.ts'
import type { ItemPageCreator } from '../../../src/shared/item-page-creator.ts'
import type { UnitOfWork } from '../../../src/shared/unit-of-work.ts'

const NOW = new Date('2026-07-16T08:00:00.000Z')
const FORM_ID = '00000000-0000-7000-8000-000000000001'
const VERSION_ID = '00000000-0000-7000-8000-000000000002'
const SOURCE_ID = '00000000-0000-7000-8000-000000000003'
const SOURCE_PAGE_ID = '00000000-0000-7000-8000-000000000004'
const WORKSPACE_ID = '00000000-0000-7000-8000-000000000005'
const ACTOR_ID = '00000000-0000-7000-8000-000000000006'
const ITEM_PAGE_ID = '00000000-0000-7000-8000-000000000007'
const ROW_ID = '00000000-0000-7000-8000-000000000008'
const SUBMISSION_ID = '00000000-0000-7000-8000-000000000009'
const IDEMPOTENCY_KEY = '00000000-0000-7000-8000-000000000010'
const PROPERTY_ID = '00000000-0000-7000-8000-000000000011'

const prepared = (overrides: Partial<PreparedFormSubmission> = {}): PreparedFormSubmission => ({
  formId: FORM_ID,
  versionId: VERSION_ID,
  versionNumber: 3,
  sourceId: SOURCE_ID,
  sourcePageId: SOURCE_PAGE_ID,
  workspaceId: WORKSPACE_ID,
  respondentUserId: ACTOR_ID,
  idempotencyKey: IDEMPOTENCY_KEY,
  endingId: 'server-ending',
  title: 'Server title',
  scalarValues: [{ propertyId: PROPERTY_ID, value: 'prepared value' }],
  submittedAt: NOW,
  ...overrides,
})

const submission = (overrides: Partial<FormSubmissionRecord> = {}): FormSubmissionRecord => ({
  id: SUBMISSION_ID,
  formId: FORM_ID,
  versionId: VERSION_ID,
  rowId: ROW_ID,
  respondentUserId: ACTOR_ID,
  endingId: 'server-ending',
  idempotencyKey: IDEMPOTENCY_KEY,
  submittedAt: NOW,
  row: { pageId: ITEM_PAGE_ID },
  ...overrides,
})

function makeHarness(
  options: {
    formRepo?: Partial<FormRepositoryContract>
    databaseRepo?: Partial<DatabaseRepository>
    pageRepo?: Partial<ItemPageCreator>
    uow?: UnitOfWork
  } = {},
) {
  let transactionDepth = 0
  const uow =
    options.uow ??
    ({
      transaction: vi.fn(async (run: () => Promise<unknown>) => {
        transactionDepth += 1
        try {
          return await run()
        } finally {
          transactionDepth -= 1
        }
      }),
      client: vi.fn() as unknown as UnitOfWork['client'],
    } satisfies UnitOfWork)
  const assertInTransaction = () => expect(transactionDepth).toBeGreaterThan(0)
  const formRepo = {
    findSubmissionByIdempotency: vi.fn(async () => null),
    reserveResponseSlot: vi.fn(async () => {
      assertInTransaction()
      return true
    }),
    createSubmission: vi.fn(async () => {
      assertInTransaction()
      return submission()
    }),
    enqueueFormSubmittedEvent: vi.fn(async () => assertInTransaction()),
    ...options.formRepo,
  } as unknown as FormRepositoryContract
  const databaseRepo = {
    maxRowPosition: vi.fn(async () => 0),
    createRow: vi.fn(async () => {
      assertInTransaction()
      return { id: ROW_ID, pageId: ITEM_PAGE_ID, position: 1_024 }
    }),
    updatePageTitle: vi.fn(async () => assertInTransaction()),
    upsertCellValue: vi.fn(async () => assertInTransaction()),
    ...options.databaseRepo,
  } as unknown as DatabaseRepository
  const pageRepo = {
    createItemPageTx: vi.fn(async () => {
      assertInTransaction()
      return { id: ITEM_PAGE_ID }
    }),
    ...options.pageRepo,
  } as ItemPageCreator
  const service = new FormSubmissionService(formRepo, databaseRepo, pageRepo, uow)
  return { service, formRepo, databaseRepo, pageRepo, uow }
}

describe('FormSubmissionService prepared transaction core', () => {
  it('persists the server-provided title, scalar values, ending, and authenticated actor atomically', async () => {
    const { service, formRepo, databaseRepo, pageRepo, uow } = makeHarness()

    await expect(service.persistPrepared(prepared())).resolves.toEqual({
      submissionId: SUBMISSION_ID,
      rowId: ROW_ID,
      pageId: ITEM_PAGE_ID,
      endingId: 'server-ending',
      submittedAt: NOW,
      created: true,
    })

    expect(uow.transaction).toHaveBeenCalledTimes(1)
    expect(pageRepo.createItemPageTx).toHaveBeenCalledWith(SOURCE_PAGE_ID, WORKSPACE_ID, ACTOR_ID)
    expect(databaseRepo.createRow).toHaveBeenCalledWith({
      sourceId: SOURCE_ID,
      pageId: ITEM_PAGE_ID,
      position: 1_024,
      createdById: ACTOR_ID,
    })
    expect(databaseRepo.updatePageTitle).toHaveBeenCalledWith(
      ITEM_PAGE_ID,
      'Server title',
      ACTOR_ID,
    )
    expect(databaseRepo.upsertCellValue).toHaveBeenCalledWith(ROW_ID, PROPERTY_ID, 'prepared value')
    expect(formRepo.createSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ endingId: 'server-ending', respondentUserId: ACTOR_ID }),
    )
    expect(formRepo.enqueueFormSubmittedEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        submissionId: SUBMISSION_ID,
        rowId: ROW_ID,
        itemPageId: ITEM_PAGE_ID,
      }),
    )
  })

  it('propagates a null actor only through the focused response page, row, title, and submission paths', async () => {
    const { service, formRepo, databaseRepo, pageRepo } = makeHarness()

    await service.persistPrepared(prepared({ respondentUserId: null }))

    expect(pageRepo.createItemPageTx).toHaveBeenCalledWith(SOURCE_PAGE_ID, WORKSPACE_ID, null)
    expect(databaseRepo.createRow).toHaveBeenCalledWith(
      expect.objectContaining({ createdById: null }),
    )
    expect(databaseRepo.updatePageTitle).toHaveBeenCalledWith(ITEM_PAGE_ID, 'Server title', null)
    expect(formRepo.createSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ respondentUserId: null }),
    )
  })

  it('returns an exact replay without reserving capacity or creating a second page, submission, or outbox', async () => {
    const replay = submission()
    const { service, formRepo, databaseRepo, pageRepo } = makeHarness({
      formRepo: { findSubmissionByIdempotency: vi.fn(async () => replay) },
    })

    await expect(service.persistPrepared(prepared())).resolves.toEqual({
      submissionId: SUBMISSION_ID,
      rowId: ROW_ID,
      pageId: ITEM_PAGE_ID,
      endingId: 'server-ending',
      submittedAt: NOW,
      created: false,
    })

    expect(formRepo.reserveResponseSlot).not.toHaveBeenCalled()
    expect(pageRepo.createItemPageTx).not.toHaveBeenCalled()
    expect(databaseRepo.createRow).not.toHaveBeenCalled()
    expect(formRepo.createSubmission).not.toHaveBeenCalled()
    expect(formRepo.enqueueFormSubmittedEvent).not.toHaveBeenCalled()
  })

  it('admits only one concurrent response for the final slot', async () => {
    let remaining = 1
    const reserveResponseSlot = vi.fn(async () => {
      if (remaining === 0) return false
      remaining -= 1
      return true
    })
    const { service } = makeHarness({ formRepo: { reserveResponseSlot } })

    const [first, second] = await Promise.allSettled([
      service.persistPrepared(prepared()),
      service.persistPrepared(prepared({ idempotencyKey: '00000000-0000-7000-8000-000000000099' })),
    ])

    expect([first, second].filter(({ status }) => status === 'fulfilled')).toHaveLength(1)
    expect([first, second].filter(({ status }) => status === 'rejected')).toHaveLength(1)
    expect(remaining).toBe(0)
  })

  it('leaves the counter, page, row, values, submission, and outbox rolled back after a write failure', async () => {
    const state = { slots: 0, pages: 0, rows: 0, values: 0, submissions: 0, outbox: 0 }
    const uow = {
      transaction: vi.fn(async (run: () => Promise<unknown>) => {
        const before = { ...state }
        try {
          return await run()
        } catch (error) {
          Object.assign(state, before)
          throw error
        }
      }),
      client: vi.fn() as unknown as UnitOfWork['client'],
    } satisfies UnitOfWork
    const { service } = makeHarness({
      uow,
      formRepo: {
        reserveResponseSlot: vi.fn(async () => {
          state.slots += 1
          return true
        }),
        createSubmission: vi.fn(async () => {
          state.submissions += 1
          throw new Error('submission failed')
        }),
        enqueueFormSubmittedEvent: vi.fn(async () => {
          state.outbox += 1
        }),
      },
      pageRepo: {
        createItemPageTx: vi.fn(async () => {
          state.pages += 1
          return { id: ITEM_PAGE_ID }
        }),
      },
      databaseRepo: {
        createRow: vi.fn(async () => {
          state.rows += 1
          return { id: ROW_ID, pageId: ITEM_PAGE_ID, position: 1_024 }
        }),
        updatePageTitle: vi.fn(async () => undefined),
        upsertCellValue: vi.fn(async () => {
          state.values += 1
        }),
      },
    })

    await expect(service.persistPrepared(prepared())).rejects.toThrow('submission failed')
    expect(state).toEqual({ slots: 0, pages: 0, rows: 0, values: 0, submissions: 0, outbox: 0 })
  })
})

describe('DatabaseFormRepository submission transaction primitives', () => {
  it('reserves a slot with one conditional update covering state, schedule, and the live limit', async () => {
    const client = { $queryRaw: vi.fn(async () => [{ id: FORM_ID }]) }
    const uow = { client: vi.fn(() => client) } as unknown as UnitOfWork
    const repository = new DatabaseFormRepository(uow)

    await expect(repository.reserveResponseSlot(FORM_ID, NOW)).resolves.toBe(true)

    const query = client.$queryRaw.mock.calls[0]![0] as {
      strings: readonly string[]
      values: unknown[]
    }
    const sql = query.strings.join('?')
    expect(sql).toContain('state =')
    expect(sql).toContain('opens_at IS NULL OR opens_at <=')
    expect(sql).toContain('closes_at IS NULL OR closes_at >')
    expect(sql).toContain('response_limit IS NULL OR accepted_responses < response_limit')
    expect(sql).toContain('accepted_responses = accepted_responses + 1')
    expect(query.values).toEqual([FORM_ID, 'OPEN', NOW, NOW])
  })

  it('creates submission provenance and enqueues an identifier-only form event on the active client', async () => {
    const created = submission()
    const client = {
      databaseFormSubmission: { create: vi.fn(async () => created) },
      outboxEvent: { create: vi.fn(async () => ({ id: 1n })) },
    }
    const uow = { client: vi.fn(() => client) } as unknown as UnitOfWork
    const repository = new DatabaseFormRepository(uow)

    await repository.createSubmission({
      formId: FORM_ID,
      versionId: VERSION_ID,
      rowId: ROW_ID,
      respondentUserId: null,
      endingId: 'server-ending',
      idempotencyKey: IDEMPOTENCY_KEY,
      submittedAt: NOW,
    })
    await repository.enqueueFormSubmittedEvent({
      formId: FORM_ID,
      versionNumber: 3,
      sourceId: SOURCE_ID,
      sourcePageId: SOURCE_PAGE_ID,
      workspaceId: WORKSPACE_ID,
      rowId: ROW_ID,
      itemPageId: ITEM_PAGE_ID,
      submissionId: SUBMISSION_ID,
      respondentUserId: null,
      submittedAt: NOW,
    })

    expect(client.databaseFormSubmission.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ endingId: 'server-ending', respondentUserId: null }),
      }),
    )
    expect(client.outboxEvent.create).toHaveBeenCalledWith({
      data: {
        eventType: 'database.form.submitted',
        aggregateType: 'webhook_event',
        aggregateId: SOURCE_PAGE_ID,
        workspaceId: WORKSPACE_ID,
        payload: {
          resourceType: 'page',
          actorId: null,
          hints: {
            formId: FORM_ID,
            versionNumber: 3,
            sourceId: SOURCE_ID,
            rowId: ROW_ID,
            itemPageId: ITEM_PAGE_ID,
            submissionId: SUBMISSION_ID,
            submittedAt: NOW.toISOString(),
            respondentKind: 'anonymous',
          },
        },
      },
    })
    expect(JSON.stringify(client.outboxEvent.create.mock.calls[0]![0])).not.toContain(
      'Server title',
    )
    expect(JSON.stringify(client.outboxEvent.create.mock.calls[0]![0])).not.toContain(
      'prepared value',
    )
  })
})

describe('nullable response actor type boundary', () => {
  it('widens only the focused item-page creation port', () => {
    expectTypeOf<ItemPageCreator['createItemPageTx']>().parameter(2).toEqualTypeOf<string | null>()
    expectTypeOf<PageRepository['createPageTx']>().parameter(0).toEqualTypeOf<string>()
  })
})
