import { createHash } from 'node:crypto'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  FormVersionDocument,
  FormVersionRecord,
  PublicFormRecord,
  PublishedFormResolution,
} from '@repo/domain'

const mocks = vi.hoisted(() => ({
  resolvePublished: vi.fn(),
  listRows: vi.fn(),
}))

vi.mock('../src/domain', () => ({
  domain: {
    formAccess: { resolvePublished: mocks.resolvePublished },
    database: { listRows: mocks.listRows },
  },
}))

import { formRouter } from '../src/routers/form'
import { createCallerFactory } from '../src/trpc'

const NOW = Date.UTC(2026, 6, 16, 8)
const SECRET = 'task-10-test-form-token-secret-32-bytes'
const USER_ID = '00000000-0000-7000-8000-000000000001'
const WORKSPACE_ID = '00000000-0000-7000-8000-000000000002'
const SOURCE_ID = '00000000-0000-7000-8000-000000000003'
const SOURCE_PAGE_ID = '00000000-0000-7000-8000-000000000004'
const FORM_ID = '00000000-0000-7000-8000-000000000005'
const VERSION_ID = '00000000-0000-7000-8000-000000000006'
const TEXT_PROPERTY_ID = '00000000-0000-7000-8000-000000000007'
const PERSON_PROPERTY_ID = '00000000-0000-7000-8000-000000000008'
const RELATION_PROPERTY_ID = '00000000-0000-7000-8000-000000000009'
const PAGE_PROPERTY_ID = '00000000-0000-7000-8000-00000000000a'
const TARGET_SOURCE_ID = '00000000-0000-7000-8000-00000000000b'
const TARGET_PAGE_ID = '00000000-0000-7000-8000-00000000000c'
const ROW_ID = '00000000-0000-7000-8000-00000000000d'
const LINKED_PAGE_ID = '00000000-0000-7000-8000-00000000000e'

const document: FormVersionDocument = {
  schemaVersion: 1,
  firstSectionId: 'section-1',
  presentation: {
    title: 'Public contact form',
    submitButtonText: 'Send',
    hideAnyNoteBranding: false,
  },
  sections: [
    {
      id: 'section-1',
      title: 'Questions',
      questionIds: ['text', 'person', 'relation', 'page'],
    },
  ],
  questions: [
    {
      id: 'text',
      sectionId: 'section-1',
      property: { kind: 'PROPERTY', propertyId: TEXT_PROPERTY_ID, propertyType: 'TEXT' },
      label: 'Name',
      required: true,
      syncWithPropertyName: false,
      input: { kind: 'TEXT', multiline: false, maxLength: 200 },
    },
    {
      id: 'person',
      sectionId: 'section-1',
      property: { kind: 'PROPERTY', propertyId: PERSON_PROPERTY_ID, propertyType: 'PERSON' },
      label: 'Person',
      required: false,
      syncWithPropertyName: false,
      input: { kind: 'PERSON', maxSelections: 1 },
    },
    {
      id: 'relation',
      sectionId: 'section-1',
      property: { kind: 'PROPERTY', propertyId: RELATION_PROPERTY_ID, propertyType: 'RELATION' },
      label: 'Relation',
      required: false,
      syncWithPropertyName: false,
      input: { kind: 'RELATION', maxSelections: 5 },
    },
    {
      id: 'page',
      sectionId: 'section-1',
      property: { kind: 'PROPERTY', propertyId: PAGE_PROPERTY_ID, propertyType: 'PAGE_LINK' },
      label: 'Page',
      required: false,
      syncWithPropertyName: false,
      input: { kind: 'PAGE_LINK' },
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
}

const version: FormVersionRecord = {
  id: VERSION_ID,
  formId: FORM_ID,
  versionNumber: 3,
  schemaVersion: 1,
  schema: document,
  schemaHash: createHash('sha256').update(JSON.stringify(document)).digest('hex'),
  publishedById: USER_ID,
  publishedAt: new Date(NOW - 60_000),
  acceptUntil: null,
}

const form = (audience: PublicFormRecord['audience']): PublicFormRecord => ({
  id: FORM_ID,
  sourceId: SOURCE_ID,
  routeKey: 'anf_public-key',
  customSlug: 'public-form',
  linkRevision: 2,
  state: 'OPEN',
  audience,
  respondentAccess: 'NONE',
  publishedVersionId: VERSION_ID,
  opensAt: null,
  closesAt: null,
  responseLimit: null,
  acceptedResponses: 0,
  createdById: USER_ID,
  source: {
    workspaceId: WORKSPACE_ID,
    pageId: SOURCE_PAGE_ID,
    page: { archivedAt: null, deletedAt: null },
    workspace: {
      id: WORKSPACE_ID,
      securityPolicy: { disablePublicLinksSitesForms: false },
    },
  },
  publishedVersion: version,
  versions: [],
})

let audience: PublicFormRecord['audience']

function openResolution(actorUserId: string | null): PublishedFormResolution {
  if (audience !== 'ANYONE_WITH_LINK' && actorUserId === null) return { status: 'AUTH_REQUIRED' }
  return {
    status: 'OPEN',
    form: form(audience),
    version,
    respondentUserId: audience === 'ANYONE_WITH_LINK' ? null : actorUserId,
  }
}

function prismaMock() {
  return {
    databaseProperty: { findFirst: vi.fn() },
    databaseSource: { findFirst: vi.fn() },
    user: { findMany: vi.fn() },
    page: { findMany: vi.fn() },
  }
}

function caller(userId: string | null, prisma = prismaMock()) {
  const resHeaders = new Headers()
  const api = createCallerFactory(formRouter)({
    prisma: prisma as never,
    user: userId
      ? ({
          id: userId,
          email: 'forms@example.test',
          firstName: 'Forms',
          lastName: 'Test',
          emailVerified: true,
        } as never)
      : null,
    headers: new Headers(),
    resHeaders,
    yookassa: {} as never,
    returnUrlBase: 'http://localhost',
    jobs: { kick: vi.fn() },
  })
  return { api, prisma, resHeaders }
}

function expectNoInternalKeys(value: unknown): void {
  const serialized = JSON.stringify(value)
  for (const forbiddenKey of [
    'sourceId',
    'pageId',
    'propertyId',
    'formId',
    'versionId',
    'workspaceId',
  ]) {
    expect(serialized).not.toContain(`"${forbiddenKey}"`)
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.stubEnv('FORM_TOKEN_SECRET', SECRET)
  vi.setSystemTime(NOW)
  audience = 'ANYONE_WITH_LINK'
  mocks.resolvePublished.mockImplementation(async (_locator, actorUserId) =>
    openResolution(actorUserId),
  )
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('public database forms router', () => {
  it('returns a sanitized public version, signed context and private no-store caching', async () => {
    const { api, resHeaders } = caller(USER_ID)

    const result = await api.getPublished({ locator: 'anf_public-key' })

    expect(result).toMatchObject({
      status: 'OPEN',
      versionFingerprint: version.schemaHash,
      respondentKind: 'anonymous',
    })
    expectNoInternalKeys(result)
    expect(JSON.stringify(result)).not.toContain(TEXT_PROPERTY_ID)
    expect(resHeaders.get('cache-control')).toBe('private, no-store')
  })

  it.each([
    ['ANYONE_WITH_LINK', USER_ID, 'anonymous'],
    ['SIGNED_IN_WITH_LINK', USER_ID, 'authenticated'],
    ['WORKSPACE_MEMBERS_WITH_LINK', USER_ID, 'authenticated'],
  ] as const)('preserves %s session semantics', async (nextAudience, userId, respondentKind) => {
    audience = nextAudience

    const result = await caller(userId).api.getPublished({ locator: 'anf_public-key' })

    expect(result).toMatchObject({ status: 'OPEN', respondentKind })
    expect(mocks.resolvePublished).toHaveBeenCalledWith('anf_public-key', userId)
  })

  it.each(['SIGNED_IN_WITH_LINK', 'WORKSPACE_MEMBERS_WITH_LINK'] as const)(
    'requires a session for %s',
    async (nextAudience) => {
      audience = nextAudience

      await expect(caller(null).api.getPublished({ locator: 'anf_public-key' })).resolves.toEqual({
        status: 'AUTH_REQUIRED',
      })
    },
  )

  it('keeps unknown and archived locators byte-identical', async () => {
    mocks.resolvePublished.mockResolvedValue({ status: 'UNAVAILABLE' })
    const api = caller(null).api

    const unknown = await api.getPublished({ locator: 'unknown-form' })
    const archived = await api.getPublished({ locator: 'archived-form' })

    expect(JSON.stringify(unknown)).toBe(JSON.stringify(archived))
    expectNoInternalKeys(unknown)
    expectNoInternalKeys(archived)
  })

  it('lists active PERSON options with opaque IDs and keyset pagination', async () => {
    audience = 'WORKSPACE_MEMBERS_WITH_LINK'
    const { api, prisma } = caller(USER_ID)
    prisma.databaseProperty.findFirst.mockResolvedValue({
      id: PERSON_PROPERTY_ID,
      type: 'PERSON',
      settings: null,
    })
    prisma.user.findMany.mockResolvedValue([
      { id: USER_ID, name: 'Ada Lovelace' },
      { id: '00000000-0000-7000-8000-000000000011', name: 'Grace Hopper' },
    ])
    const published = await api.getPublished({ locator: 'anf_public-key' })
    if (published.status !== 'OPEN') throw new Error('expected open form')

    const result = await api.listPickerOptions({
      locator: 'anf_public-key',
      versionToken: published.versionToken,
      questionId: 'person',
      cursor: '00000000-0000-7000-8000-000000000000',
      limit: 1,
    })

    expect(result).toEqual({
      items: [{ id: USER_ID, label: 'Ada Lovelace' }],
      nextCursor: USER_ID,
    })
    expectNoInternalKeys(result)
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workspaceMemberships: { some: { workspaceId: WORKSPACE_ID } },
          workspaceBlocks: { none: { workspaceId: WORKSPACE_ID } },
        }),
        orderBy: { id: 'asc' },
        take: 2,
      }),
    )
  })

  it('uses the normal row service and keyset cursor for RELATION options', async () => {
    audience = 'WORKSPACE_MEMBERS_WITH_LINK'
    const { api, prisma } = caller(USER_ID)
    prisma.databaseProperty.findFirst.mockResolvedValue({
      id: RELATION_PROPERTY_ID,
      type: 'RELATION',
      settings: { relation: { targetSourceId: TARGET_SOURCE_ID } },
    })
    prisma.databaseSource.findFirst.mockResolvedValue({
      id: TARGET_SOURCE_ID,
      pageId: TARGET_PAGE_ID,
    })
    mocks.listRows.mockResolvedValue({
      rows: [
        {
          rowId: ROW_ID,
          pageId: LINKED_PAGE_ID,
          title: 'Visible linked row',
          icon: null,
          position: 1024,
          cells: {},
        },
      ],
      nextCursor: null,
    })
    const published = await api.getPublished({ locator: 'anf_public-key' })
    if (published.status !== 'OPEN') throw new Error('expected open form')

    const result = await api.listPickerOptions({
      locator: 'anf_public-key',
      versionToken: published.versionToken,
      questionId: 'relation',
      query: 'linked',
      cursor: '00000000-0000-7000-8000-000000000000',
      limit: 10,
    })

    expect(result).toEqual({
      items: [{ id: ROW_ID, label: 'Visible linked row' }],
      nextCursor: null,
    })
    expectNoInternalKeys(result)
    expect(mocks.listRows).toHaveBeenCalledWith(USER_ID, {
      pageId: TARGET_PAGE_ID,
      cursor: '00000000-0000-7000-8000-000000000000',
      limit: 51,
    })
  })

  it('rejects a cross-workspace RELATION target before row lookup', async () => {
    audience = 'WORKSPACE_MEMBERS_WITH_LINK'
    const { api, prisma } = caller(USER_ID)
    prisma.databaseProperty.findFirst.mockResolvedValue({
      id: RELATION_PROPERTY_ID,
      type: 'RELATION',
      settings: { relation: { targetSourceId: TARGET_SOURCE_ID } },
    })
    prisma.databaseSource.findFirst.mockResolvedValue(null)
    const published = await api.getPublished({ locator: 'anf_public-key' })
    if (published.status !== 'OPEN') throw new Error('expected open form')

    await expect(
      api.listPickerOptions({
        locator: 'anf_public-key',
        versionToken: published.versionToken,
        questionId: 'relation',
        limit: 10,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(mocks.listRows).not.toHaveBeenCalled()
    expect(prisma.databaseSource.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: TARGET_SOURCE_ID,
          workspaceId: WORKSPACE_ID,
          page: { archivedAt: null, deletedAt: null },
        },
      }),
    )
  })

  it('applies the normal page visibility predicate to PAGE_LINK options', async () => {
    audience = 'WORKSPACE_MEMBERS_WITH_LINK'
    const { api, prisma } = caller(USER_ID)
    prisma.databaseProperty.findFirst.mockResolvedValue({
      id: PAGE_PROPERTY_ID,
      type: 'PAGE_LINK',
      settings: null,
    })
    prisma.page.findMany.mockResolvedValue([{ id: LINKED_PAGE_ID, title: 'Visible page' }])
    const published = await api.getPublished({ locator: 'anf_public-key' })
    if (published.status !== 'OPEN') throw new Error('expected open form')

    const result = await api.listPickerOptions({
      locator: 'anf_public-key',
      versionToken: published.versionToken,
      questionId: 'page',
      query: 'visible',
      limit: 10,
    })

    expect(result).toEqual({
      items: [{ id: LINKED_PAGE_ID, label: 'Visible page' }],
      nextCursor: null,
    })
    expectNoInternalKeys(result)
    expect(prisma.page.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workspaceId: WORKSPACE_ID,
          archivedAt: null,
          deletedAt: null,
          AND: expect.any(Array),
        }),
      }),
    )
  })

  it('validates the signed version before any picker property lookup', async () => {
    audience = 'WORKSPACE_MEMBERS_WITH_LINK'
    const { api, prisma } = caller(USER_ID)

    await expect(
      api.listPickerOptions({
        locator: 'anf_public-key',
        versionToken: 'forged.token',
        questionId: 'person',
        limit: 10,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(prisma.databaseProperty.findFirst).not.toHaveBeenCalled()
  })
})
