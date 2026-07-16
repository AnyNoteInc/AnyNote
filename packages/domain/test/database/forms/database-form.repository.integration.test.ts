import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { PageType, prisma } from '@repo/db'

import { PrismaUnitOfWork } from '../../../src/shared/unit-of-work.ts'
import {
  DatabaseFormRepository,
  type EnqueueFormSubmittedEventRecord,
} from '../../../src/database/forms/database-form.repository.ts'
import { FormSubmissionService } from '../../../src/database/forms/form-submission.service.ts'
import { DatabaseRepository } from '../../../src/database/repositories/database.repository.ts'
import { PageRepository } from '../../../src/pages/repositories/pages.repository.ts'
import {
  FORM_SCHEMA_VERSION,
  type FormVersionDocument,
} from '../../../src/database/forms/public.ts'

const RUN = randomUUID().slice(0, 8)
const EMAIL = `database-form-repository-${RUN}@example.test`
const submittedAt = new Date('2026-07-16T00:00:00.000Z')

function uuid7(): string {
  const chars = [...randomUUID()]
  chars[14] = '7'
  chars[19] = '8'
  return chars.join('')
}

const documentFor = (propertyId = 'property-1'): FormVersionDocument => ({
  schemaVersion: FORM_SCHEMA_VERSION,
  firstSectionId: 'section-1',
  presentation: {
    title: 'Integration form',
    submitButtonText: 'Send',
    hideAnyNoteBranding: false,
  },
  sections: [{ id: 'section-1', title: 'Questions', questionIds: ['question-1'] }],
  questions: [
    {
      id: 'question-1',
      sectionId: 'section-1',
      property: { kind: 'PROPERTY', propertyId, propertyType: 'TEXT' },
      label: 'Name',
      required: false,
      syncWithPropertyName: false,
      input: { kind: 'TEXT', multiline: false, maxLength: 200 },
    },
  ],
  transitions: [
    {
      id: 'transition-1',
      fromSectionId: 'section-1',
      priority: 0,
      when: null,
      target: { kind: 'ENDING', endingId: 'ending-1' },
    },
  ],
  endings: [{ id: 'ending-1', title: 'Done' }],
})

let userId = ''
let workspaceId = ''
let sourceId = ''
let sourcePageId = ''
let paginationFormId = ''

const repository = new DatabaseFormRepository(new PrismaUnitOfWork(prisma))

class FailingOutboxFormRepository extends DatabaseFormRepository {
  override async enqueueFormSubmittedEvent(input: EnqueueFormSubmittedEventRecord): Promise<void> {
    await super.enqueueFormSubmittedEvent(input)
    throw new Error('TEST_OUTBOX_FAILURE')
  }
}

async function createForm(routeSuffix: string) {
  return prisma.databaseForm.create({
    data: {
      sourceId,
      routeKey: `anf_it_${RUN}_${routeSuffix}`,
      draftSchema: documentFor(),
      createdById: userId,
    },
  })
}

beforeAll(async () => {
  const user = await prisma.user.create({
    data: {
      name: `Form Repository ${RUN}`,
      firstName: 'Form',
      lastName: 'Repository',
      email: EMAIL,
    },
  })
  userId = user.id
  const workspace = await prisma.workspace.create({
    data: { name: `Form Repository ${RUN}`, createdById: user.id },
  })
  workspaceId = workspace.id
  const sourcePage = await prisma.page.create({
    data: {
      workspaceId,
      type: PageType.DATABASE,
      title: 'Responses',
      createdById: user.id,
    },
  })
  sourcePageId = sourcePage.id
  const source = await prisma.databaseSource.create({
    data: { workspaceId, pageId: sourcePage.id, title: 'Responses' },
  })
  sourceId = source.id
  const form = await createForm('pagination')
  paginationFormId = form.id
  const version = await prisma.databaseFormVersion.create({
    data: {
      formId: form.id,
      versionNumber: 1,
      schema: documentFor(),
      schemaHash: 'd'.repeat(64),
      publishedById: user.id,
      publishedAt: submittedAt,
    },
  })
  const submissionIds = Array.from({ length: 5 }, uuid7)
  for (const [index, submissionId] of submissionIds.entries()) {
    const itemPage = await prisma.page.create({
      data: {
        id: uuid7(),
        workspaceId,
        title: `Response ${index + 1}`,
        createdById: user.id,
      },
    })
    const row = await prisma.databaseRow.create({
      data: {
        id: uuid7(),
        sourceId,
        pageId: itemPage.id,
        position: index * 1024,
        createdById: user.id,
        updatedById: user.id,
      },
    })
    await prisma.databaseFormSubmission.create({
      data: {
        id: submissionId,
        formId: form.id,
        versionId: version.id,
        rowId: row.id,
        respondentUserId: user.id,
        endingId: 'ending-1',
        idempotencyKey: uuid7(),
        submittedAt,
      },
    })
  }
})

afterAll(async () => {
  if (workspaceId) await prisma.workspace.deleteMany({ where: { id: workspaceId } })
  await prisma.user.deleteMany({ where: { email: EMAIL } })
})

describe('DatabaseFormRepository real PostgreSQL behavior', () => {
  it('paginates equal-timestamp UUIDv7 submissions without gaps or duplicates', async () => {
    const expected = (
      await prisma.databaseFormSubmission.findMany({
        where: { formId: paginationFormId },
        orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
        select: { id: true },
      })
    ).map(({ id }) => id)

    const first = await repository.listResponses({ formId: paginationFormId, limit: 2 })
    expect(first.items.map(({ id }) => id)).toEqual(expected.slice(0, 2))
    expect(first.nextCursor).toEqual({ submittedAt, id: expected[1] })

    const second = await repository.listResponses({
      formId: paginationFormId,
      cursor: first.nextCursor!,
      limit: 2,
    })
    expect(second.items.map(({ id }) => id)).toEqual(expected.slice(2, 4))
    expect(second.nextCursor).toEqual({ submittedAt, id: expected[3] })

    const third = await repository.listResponses({
      formId: paginationFormId,
      cursor: second.nextCursor!,
      limit: 2,
    })
    expect(third.items.map(({ id }) => id)).toEqual(expected.slice(4))
    expect(third.nextCursor).toBeNull()

    const traversed = [...first.items, ...second.items, ...third.items].map(({ id }) => id)
    expect(traversed).toEqual(expected)
    expect(new Set(traversed).size).toBe(5)
  })

  it('admits exactly one concurrent reservation for the final response slot', async () => {
    const form = await prisma.databaseForm.create({
      data: {
        sourceId,
        routeKey: `anf_it_${RUN}_final_slot`,
        draftSchema: documentFor(),
        createdById: userId,
        state: 'OPEN',
        responseLimit: 1,
      },
    })
    const firstUow = new PrismaUnitOfWork(prisma)
    const secondUow = new PrismaUnitOfWork(prisma)
    const firstRepo = new DatabaseFormRepository(firstUow)
    const secondRepo = new DatabaseFormRepository(secondUow)

    const reservations = await Promise.all([
      firstUow.transaction(() => firstRepo.reserveResponseSlot(form.id, submittedAt)),
      secondUow.transaction(() => secondRepo.reserveResponseSlot(form.id, submittedAt)),
    ])

    expect(reservations.sort()).toEqual([false, true])
    await expect(
      prisma.databaseForm.findUniqueOrThrow({ where: { id: form.id } }),
    ).resolves.toMatchObject({ acceptedResponses: 1 })
  })

  it('persists prepared server values once and replays without another slot, page, or outbox', async () => {
    const property = await prisma.databaseProperty.create({
      data: { sourceId, type: 'TEXT', name: `Replay ${RUN}`, position: 9_998 },
    })
    const form = await prisma.databaseForm.create({
      data: {
        sourceId,
        routeKey: `anf_it_${RUN}_replay`,
        draftSchema: documentFor(property.id),
        createdById: userId,
        state: 'OPEN',
        responseLimit: 2,
      },
    })
    const version = await prisma.databaseFormVersion.create({
      data: {
        formId: form.id,
        versionNumber: 1,
        schema: documentFor(property.id),
        schemaHash: 'f'.repeat(64),
        publishedById: userId,
        publishedAt: submittedAt,
      },
    })
    await prisma.databaseForm.update({
      where: { id: form.id },
      data: { publishedVersionId: version.id },
    })
    const uow = new PrismaUnitOfWork(prisma)
    const service = new FormSubmissionService(
      new DatabaseFormRepository(uow),
      new DatabaseRepository(uow),
      new PageRepository(uow),
      uow,
    )
    const idempotencyKey = randomUUID()
    const input = {
      formId: form.id,
      versionId: version.id,
      versionNumber: 1,
      sourceId,
      sourcePageId,
      workspaceId,
      respondentUserId: userId,
      idempotencyKey,
      endingId: 'server-ending',
      title: 'Server-prepared title',
      scalarValues: [{ propertyId: property.id, value: 'Server-prepared value' }],
      submittedAt,
    }
    const pagesBefore = await prisma.page.count({ where: { parentId: sourcePageId } })
    const outboxBefore = await prisma.outboxEvent.count({ where: { workspaceId } })

    const first = await service.persistPrepared(input)
    const outboxAfterFirst = await prisma.outboxEvent.count({ where: { workspaceId } })
    const replay = await service.persistPrepared(input)

    expect(first.created).toBe(true)
    expect(replay).toEqual({ ...first, created: false })
    await expect(
      prisma.databaseForm.findUniqueOrThrow({ where: { id: form.id } }),
    ).resolves.toMatchObject({ acceptedResponses: 1 })
    await expect(prisma.page.count({ where: { parentId: sourcePageId } })).resolves.toBe(
      pagesBefore + 1,
    )
    await expect(prisma.databaseFormSubmission.count({ where: { formId: form.id } })).resolves.toBe(
      1,
    )
    expect(outboxAfterFirst).toBe(outboxBefore + 2)
    await expect(prisma.outboxEvent.count({ where: { workspaceId } })).resolves.toBe(
      outboxAfterFirst,
    )
    await expect(
      prisma.databaseFormSubmission.findUniqueOrThrow({
        where: { formId_idempotencyKey: { formId: form.id, idempotencyKey } },
        include: { row: { include: { page: true, cells: true } } },
      }),
    ).resolves.toMatchObject({
      endingId: 'server-ending',
      respondentUserId: userId,
      row: {
        createdById: userId,
        page: { title: 'Server-prepared title', createdById: userId },
        cells: [{ propertyId: property.id, value: 'Server-prepared value' }],
      },
    })
  })

  it('rolls back the slot, page, row, value, submission, and outbox when the final write fails', async () => {
    const property = await prisma.databaseProperty.create({
      data: { sourceId, type: 'TEXT', name: `Rollback ${RUN}`, position: 9_999 },
    })
    const form = await prisma.databaseForm.create({
      data: {
        sourceId,
        routeKey: `anf_it_${RUN}_rollback`,
        draftSchema: documentFor(property.id),
        createdById: userId,
        state: 'OPEN',
        responseLimit: 1,
      },
    })
    const version = await prisma.databaseFormVersion.create({
      data: {
        formId: form.id,
        versionNumber: 1,
        schema: documentFor(property.id),
        schemaHash: 'e'.repeat(64),
        publishedById: userId,
        publishedAt: submittedAt,
      },
    })
    await prisma.databaseForm.update({
      where: { id: form.id },
      data: { publishedVersionId: version.id },
    })
    const before = {
      pages: await prisma.page.count({ where: { parentId: sourcePageId } }),
      rows: await prisma.databaseRow.count({ where: { sourceId } }),
      values: await prisma.databaseCellValue.count({ where: { propertyId: property.id } }),
      submissions: await prisma.databaseFormSubmission.count({ where: { formId: form.id } }),
      outbox: await prisma.outboxEvent.count({ where: { workspaceId } }),
    }
    const uow = new PrismaUnitOfWork(prisma)
    const service = new FormSubmissionService(
      new FailingOutboxFormRepository(uow),
      new DatabaseRepository(uow),
      new PageRepository(uow),
      uow,
    )

    await expect(
      service.persistPrepared({
        formId: form.id,
        versionId: version.id,
        versionNumber: 1,
        sourceId,
        sourcePageId,
        workspaceId,
        respondentUserId: null,
        idempotencyKey: randomUUID(),
        endingId: 'ending-1',
        title: 'Must roll back',
        scalarValues: [{ propertyId: property.id, value: 'Must roll back' }],
        submittedAt,
      }),
    ).rejects.toThrow('TEST_OUTBOX_FAILURE')

    await expect(
      prisma.databaseForm.findUniqueOrThrow({ where: { id: form.id } }),
    ).resolves.toMatchObject({ acceptedResponses: 0 })
    await expect(prisma.page.count({ where: { parentId: sourcePageId } })).resolves.toBe(
      before.pages,
    )
    await expect(prisma.databaseRow.count({ where: { sourceId } })).resolves.toBe(before.rows)
    await expect(
      prisma.databaseCellValue.count({ where: { propertyId: property.id } }),
    ).resolves.toBe(before.values)
    await expect(prisma.databaseFormSubmission.count({ where: { formId: form.id } })).resolves.toBe(
      before.submissions,
    )
    await expect(prisma.outboxEvent.count({ where: { workspaceId } })).resolves.toBe(before.outbox)
  })
})
