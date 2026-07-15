import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Container } from 'inversify'

import {
  FORM_SCHEMA_VERSION,
  type FormVersionDocument,
} from '../../../src/database/forms/public.ts'
import {
  DatabaseFormRepository,
  type CreateFormRecord,
  type PublishFormVersionRecord,
} from '../../../src/database/forms/database-form.repository.ts'
import type { UnitOfWork } from '../../../src/shared/unit-of-work.ts'
import { SHARED } from '../../../src/shared/tokens.ts'
import { databaseFormsModule } from '../../../src/database/forms/database-forms.module.ts'
import { DATABASE_FORMS } from '../../../src/database/forms/database-forms.tokens.ts'

const now = new Date('2026-07-16T00:00:00.000Z')

afterEach(() => vi.useRealTimers())

const documentFor = (propertyId: string): FormVersionDocument => ({
  schemaVersion: FORM_SCHEMA_VERSION,
  firstSectionId: 'section-1',
  presentation: {
    title: 'Contact',
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

const managed = {
  id: 'form-1',
  sourceId: 'source-1',
  viewId: 'view-1',
  routeKey: 'anf_route',
  customSlug: null,
  linkRevision: 1,
  state: 'DRAFT',
  audience: 'ANYONE_WITH_LINK',
  respondentAccess: 'NONE',
  draftSchema: documentFor('property-1'),
  draftRevision: 1,
  publishedVersionId: null,
  opensAt: null,
  closesAt: null,
  responseLimit: null,
  acceptedResponses: 0,
  notifyOwners: true,
  createdById: 'user-1',
  createdAt: now,
  updatedAt: now,
  source: {
    id: 'source-1',
    workspaceId: 'workspace-1',
    pageId: 'page-1',
    structureLocked: false,
    page: { id: 'page-1', createdById: 'user-1', archivedAt: null, deletedAt: null },
    workspace: {
      id: 'workspace-1',
      securityPolicy: { disablePublicLinksSitesForms: false },
    },
    properties: [],
  },
  view: { id: 'view-1', title: 'Form', position: 0 },
  createdBy: { id: 'user-1', name: 'Owner', email: 'owner@example.test', image: null },
  publishedVersion: null,
}

function makeClient(overrides: Record<string, unknown> = {}) {
  const client = {
    databaseView: {
      create: vi.fn(async () => ({ id: 'view-1' })),
      delete: vi.fn(async () => ({ id: 'view-1' })),
    },
    databaseForm: {
      create: vi.fn(async () => managed),
      findFirst: vi.fn(async () => managed),
      findMany: vi.fn(async () => [managed]),
      findUnique: vi.fn(async () => managed),
      updateMany: vi.fn(async () => ({ count: 1 })),
      update: vi.fn(async () => managed),
    },
    databaseFormVersion: {
      create: vi.fn(async () => ({ id: 'version-2' })),
      update: vi.fn(async () => ({ id: 'version-1' })),
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(async () => null),
      findUnique: vi.fn(async () => null),
    },
    databaseFormSubmission: {
      findMany: vi.fn(async () => []),
      findUnique: vi.fn(async () => null),
      findFirst: vi.fn(async () => null),
    },
    ...overrides,
  }
  return client
}

function makeRepository(client = makeClient()) {
  const uow = {
    client: vi.fn(() => client),
    transaction: vi.fn(async (callback: () => Promise<unknown>) => callback()),
  } as unknown as UnitOfWork
  return { client, uow, repository: new DatabaseFormRepository(uow) }
}

function expectNoRowsInSelection(args: unknown) {
  const serialized = JSON.stringify(args)
  expect(serialized).not.toContain('"rows"')
  expect(serialized).not.toContain('"content"')
  expect(serialized).not.toContain('"contentYjs"')
}

describe('DatabaseFormRepository writes', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates the FORM view and form through the active UnitOfWork client', async () => {
    const { client, uow, repository } = makeRepository()
    const input: CreateFormRecord = {
      sourceId: 'source-1',
      title: 'Contact form',
      position: 1024,
      routeKey: 'anf_route',
      draftSchema: documentFor('property-1'),
      createdById: 'user-1',
    }

    await expect(repository.createFormWithView(input)).resolves.toBe(managed)

    expect(uow.client).toHaveBeenCalled()
    expect(client.databaseView.create).toHaveBeenCalledWith({
      data: {
        sourceId: 'source-1',
        type: 'FORM',
        title: 'Contact form',
        position: 1024,
        settings: undefined,
      },
      select: { id: true },
    })
    expect(client.databaseForm.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ sourceId: 'source-1', viewId: 'view-1' }),
      }),
    )
    expectNoRowsInSelection(client.databaseForm.create.mock.calls[0]?.[0])
  })

  it('conditionally updates a draft and re-reads it on the same active client', async () => {
    const { client, repository } = makeRepository()

    await expect(
      repository.updateDraftIfRevision({
        formId: 'form-1',
        expectedRevision: 3,
        draftSchema: documentFor('property-2'),
      }),
    ).resolves.toBe(managed)

    expect(client.databaseForm.updateMany).toHaveBeenCalledWith({
      where: { id: 'form-1', draftRevision: 3 },
      data: { draftSchema: documentFor('property-2'), draftRevision: { increment: 1 } },
    })
    expect(client.databaseForm.findUnique).toHaveBeenCalled()
    expectNoRowsInSelection(client.databaseForm.findUnique.mock.calls[0]?.[0])
  })

  it('returns null after an optimistic draft conflict without overwriting', async () => {
    const client = makeClient({
      databaseForm: {
        ...makeClient().databaseForm,
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
    })
    const { repository } = makeRepository(client)

    await expect(
      repository.updateDraftIfRevision({
        formId: 'form-1',
        expectedRevision: 3,
        draftSchema: documentFor('property-2'),
      }),
    ).resolves.toBeNull()
    expect(client.databaseForm.findUnique).not.toHaveBeenCalled()
  })

  it('publishes an immutable next version and only closes the prior current version', async () => {
    const { client, repository } = makeRepository()
    const input: PublishFormVersionRecord = {
      formId: 'form-1',
      previousPublishedVersionId: 'version-1',
      previousAcceptUntil: new Date('2026-07-16T00:05:00.000Z'),
      versionNumber: 2,
      schemaVersion: 1,
      schema: documentFor('property-1'),
      schemaHash: 'a'.repeat(64),
      publishedById: 'user-1',
      publishedAt: now,
      state: 'OPEN',
    }

    await expect(repository.publishVersion(input)).resolves.toBe(managed)

    expect(client.databaseFormVersion.update).toHaveBeenCalledWith({
      where: { id: 'version-1', formId: 'form-1' },
      data: { acceptUntil: input.previousAcceptUntil },
      select: { id: true },
    })
    expect(client.databaseFormVersion.create).toHaveBeenCalledWith({
      data: {
        formId: 'form-1',
        versionNumber: 2,
        schemaVersion: 1,
        schema: input.schema,
        schemaHash: input.schemaHash,
        publishedById: 'user-1',
        publishedAt: now,
      },
      select: { id: true },
    })
    expect(client.databaseForm.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'form-1' },
        data: { publishedVersionId: 'version-2', state: 'OPEN' },
      }),
    )
    expect(client.databaseFormVersion.update.mock.calls[0]?.[0]).not.toHaveProperty('data.schema')
  })

  it('archives a form, clears its view link, then deletes the old view on the active client', async () => {
    const { client, repository } = makeRepository()

    await repository.archiveForm({ formId: 'form-1' })

    expect(client.databaseForm.findUnique).toHaveBeenCalledWith({
      where: { id: 'form-1' },
      select: { viewId: true },
    })
    expect(client.databaseForm.update).toHaveBeenCalledWith({
      where: { id: 'form-1' },
      data: { state: 'ARCHIVED', viewId: null },
      select: { id: true },
    })
    expect(client.databaseView.delete).toHaveBeenCalledWith({ where: { id: 'view-1' } })
  })

  it('updates only supplied form settings through the active client', async () => {
    const { client, uow, repository } = makeRepository()

    await repository.updateSettings({
      formId: 'form-1',
      audience: 'SIGNED_IN_WITH_LINK',
      responseLimit: 25,
      notifyOwners: false,
    })

    expect(uow.client).toHaveBeenCalled()
    expect(client.databaseForm.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'form-1' },
        data: {
          audience: 'SIGNED_IN_WITH_LINK',
          responseLimit: 25,
          notifyOwners: false,
        },
      }),
    )
  })

  it('duplicates into a fresh DRAFT form without copying slug, versions or counters', async () => {
    const { client, uow, repository } = makeRepository()

    await repository.duplicateForm({
      sourceId: 'source-1',
      title: 'Contact form copy',
      position: 2048,
      routeKey: 'anf_fresh',
      draftSchema: documentFor('property-1'),
      createdById: 'user-2',
      audience: 'SIGNED_IN_WITH_LINK',
      respondentAccess: 'VIEW',
      opensAt: null,
      closesAt: null,
      responseLimit: 10,
      notifyOwners: false,
    })

    expect(uow.client).toHaveBeenCalled()
    const data = client.databaseForm.create.mock.calls[0]?.[0].data
    expect(data).toEqual({
      sourceId: 'source-1',
      viewId: 'view-1',
      routeKey: 'anf_fresh',
      draftSchema: documentFor('property-1'),
      createdById: 'user-2',
      audience: 'SIGNED_IN_WITH_LINK',
      respondentAccess: 'VIEW',
      opensAt: null,
      closesAt: null,
      responseLimit: 10,
      notifyOwners: false,
    })
    expect(data).not.toHaveProperty('state')
    expect(data).not.toHaveProperty('customSlug')
    expect(data).not.toHaveProperty('publishedVersionId')
    expect(data).not.toHaveProperty('acceptedResponses')
    expect(data).not.toHaveProperty('versions')
    expect(data).not.toHaveProperty('submissions')
    expect(data).not.toHaveProperty('uploads')
  })
})

describe('database forms dependency injection', () => {
  it('binds only the repository token to a UnitOfWork-backed repository', async () => {
    expect(Object.keys(DATABASE_FORMS)).toEqual(['Repository'])
    const { uow } = makeRepository()
    const container = new Container()
    container.bind(SHARED.UnitOfWork).toConstantValue(uow)
    await container.load(databaseFormsModule)

    expect(container.get(DATABASE_FORMS.Repository)).toBeInstanceOf(DatabaseFormRepository)
  })
})

describe('DatabaseFormRepository focused reads', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(now)
  })

  it('scopes managed form lookup by page and form without selecting database rows', async () => {
    const { client, repository } = makeRepository()

    await repository.findManagedForm('page-1', 'form-1')

    expect(client.databaseForm.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'form-1', source: { pageId: 'page-1' } },
      }),
    )
    expectNoRowsInSelection(client.databaseForm.findFirst.mock.calls[0]?.[0])
  })

  it('uses one locator OR for the exact route key or normalized custom slug', async () => {
    const { client, repository } = makeRepository()

    await repository.findByLocator('My-Custom-Slug')

    expect(client.databaseForm.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [{ routeKey: 'My-Custom-Slug' }, { customSlug: 'my-custom-slug' }],
        },
      }),
    )
    const args = client.databaseForm.findFirst.mock.calls[0]?.[0]
    expectNoRowsInSelection(args)
    expect(args).toEqual(
      expect.objectContaining({
        select: expect.objectContaining({
          publishedVersion: expect.any(Object),
          versions: expect.objectContaining({ where: { acceptUntil: { gt: now } } }),
          source: expect.objectContaining({
            select: expect.objectContaining({
              workspace: {
                select: {
                  id: true,
                  securityPolicy: { select: { disablePublicLinksSitesForms: true } },
                },
              },
            }),
          }),
        }),
      }),
    )
  })

  it('paginates responses by submittedAt and id without selecting page bodies', async () => {
    const submission = (id: string, submittedAt: Date) => ({
      id,
      formId: 'form-1',
      versionId: 'version-1',
      rowId: `row-${id}`,
      respondentUserId: null,
      endingId: 'ending-1',
      idempotencyKey: `00000000-0000-7000-8000-00000000000${id}`,
      submittedAt,
      row: { id: `row-${id}`, pageId: `page-${id}`, page: { title: id, icon: null }, cells: [] },
    })
    const records = [
      submission('1', new Date('2026-07-15T03:00:00.000Z')),
      submission('2', new Date('2026-07-15T02:00:00.000Z')),
      submission('3', new Date('2026-07-15T01:00:00.000Z')),
    ]
    const client = makeClient({
      databaseFormSubmission: {
        ...makeClient().databaseFormSubmission,
        findMany: vi.fn(async () => records),
      },
    })
    const { repository } = makeRepository(client)
    const cursor = { submittedAt: new Date('2026-07-16T00:00:00.000Z'), id: 'cursor-id' }

    const result = await repository.listResponses({ formId: 'form-1', cursor, limit: 2 })

    expect(client.databaseFormSubmission.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          formId: 'form-1',
          OR: [
            { submittedAt: { lt: cursor.submittedAt } },
            { submittedAt: cursor.submittedAt, id: { lt: 'cursor-id' } },
          ],
        },
        orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
        take: 3,
      }),
    )
    expect(result.items).toEqual(records.slice(0, 2))
    expect(result.nextCursor).toEqual({ submittedAt: records[1]!.submittedAt, id: '2' })
    expectNoRowsInSelection(client.databaseFormSubmission.findMany.mock.calls[0]?.[0])
  })

  it('orders form versions newest-first with a stable id tie-breaker', async () => {
    const { client, repository } = makeRepository()

    await repository.listVersions('form-1')

    expect(client.databaseFormVersion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { formId: 'form-1' },
        orderBy: [{ versionNumber: 'desc' }, { id: 'desc' }],
      }),
    )
  })

  it('uses focused unique lookups for version and submission provenance', async () => {
    const { client, repository } = makeRepository()

    await repository.findVersion('form-1', 3)
    await repository.findSubmission('submission-1')
    await repository.findSubmissionByIdempotency('form-1', '00000000-0000-7000-8000-000000000001')

    expect(client.databaseFormVersion.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { formId_versionNumber: { formId: 'form-1', versionNumber: 3 } },
      }),
    )
    expect(client.databaseFormSubmission.findUnique).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ where: { id: 'submission-1' } }),
    )
    expect(client.databaseFormSubmission.findUnique).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: {
          formId_idempotencyKey: {
            formId: 'form-1',
            idempotencyKey: '00000000-0000-7000-8000-000000000001',
          },
        },
      }),
    )
    for (const [args] of client.databaseFormSubmission.findUnique.mock.calls) {
      expectNoRowsInSelection(args)
    }
  })
})

describe('DatabaseFormRepository protected property dependencies', () => {
  it('detects a reference in a current published version', async () => {
    const client = makeClient()
    client.databaseFormVersion.findMany.mockResolvedValueOnce([
      { schema: documentFor('property-protected') },
    ])
    const { repository } = makeRepository(client)

    await expect(
      repository.hasProtectedPropertyDependency('property-protected', now),
    ).resolves.toBe(true)
    expect(client.databaseFormVersion.findMany).toHaveBeenCalledWith({
      where: {
        OR: [{ currentForForm: { isNot: null } }, { acceptUntil: { gt: now } }],
      },
      select: { schema: true },
    })
  })

  it('detects a reference in a grace-period version', async () => {
    const client = makeClient()
    client.databaseFormVersion.findMany.mockResolvedValueOnce([
      { schema: documentFor('property-protected') },
    ])
    const { repository } = makeRepository(client)

    await expect(
      repository.hasProtectedPropertyDependency('property-protected', now),
    ).resolves.toBe(true)
  })

  it('ignores expired and unrelated versions because only active schemas are selected', async () => {
    const client = makeClient()
    client.databaseFormVersion.findMany.mockResolvedValueOnce([
      { schema: documentFor('other-property') },
    ])
    const { repository } = makeRepository(client)

    await expect(
      repository.hasProtectedPropertyDependency('property-protected', now),
    ).resolves.toBe(false)
  })

  it('fails closed when an active stored schema is malformed', async () => {
    const client = makeClient()
    client.databaseFormVersion.findMany.mockResolvedValueOnce([{ schema: { malformed: true } }])
    const { repository } = makeRepository(client)

    await expect(
      repository.hasProtectedPropertyDependency('property-protected', now),
    ).resolves.toBe(true)
  })
})
