import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { PageType, prisma } from '@repo/db'

import { PrismaUnitOfWork } from '../../../src/shared/unit-of-work.ts'
import { DatabaseFormRepository } from '../../../src/database/forms/database-form.repository.ts'
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
let paginationFormId = ''

const repository = new DatabaseFormRepository(new PrismaUnitOfWork(prisma))

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
})
