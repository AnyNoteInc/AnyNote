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
  resolveVersion: vi.fn(),
  listRows: vi.fn(),
}))

vi.mock('../src/domain', () => ({
  domain: {
    formAccess: {
      resolvePublished: mocks.resolvePublished,
      resolveVersion: mocks.resolveVersion,
    },
    database: { listRows: mocks.listRows },
  },
}))

import { formRouter } from '../src/routers/form'
import { hashFormLocator, signFormVersionToken } from '../src/helpers/form-version-token'
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
const CONTINUATION_ROW_ID = '00000000-0000-7000-8000-00000000000f'
const WRONG_FORM_ID = '00000000-0000-7000-8000-000000000010'

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
})

let audience: PublicFormRecord['audience']

function normalizeTestLocator(locator: string): string {
  const trimmed = locator.trim()
  return trimmed.startsWith('anf_') ? trimmed : trimmed.toLowerCase()
}

function openResolution(
  actorUserId: string | null,
  locator = 'anf_public-key',
): PublishedFormResolution {
  if (audience !== 'ANYONE_WITH_LINK' && actorUserId === null) return { status: 'AUTH_REQUIRED' }
  return {
    status: 'OPEN',
    locator: normalizeTestLocator(locator),
    form: form(audience),
    version,
    respondentUserId: audience === 'ANYONE_WITH_LINK' ? null : actorUserId,
  }
}

function tokenFor(storedVersion: FormVersionRecord, locator = 'anf_public-key'): string {
  return signFormVersionToken(
    {
      locatorHash: hashFormLocator(locator),
      versionNumber: storedVersion.versionNumber,
      schemaHash: storedVersion.schemaHash,
      linkRevision: 2,
      issuedAt: NOW - 1_000,
      expiresAt: NOW + 60_000,
    },
    SECRET,
  )
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
  mocks.resolvePublished.mockImplementation(async (locator, actorUserId) =>
    openResolution(actorUserId, locator),
  )
  mocks.resolveVersion.mockImplementation(async (_form, versionNumber) =>
    versionNumber === version.versionNumber ? version : null,
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

  it('collapses malformed locator strings to the same public unavailable response', async () => {
    mocks.resolvePublished.mockResolvedValue({ status: 'UNAVAILABLE' })
    const api = caller(null).api

    const results = await Promise.all([
      api.getPublished({ locator: '' }),
      api.getPublished({ locator: 'x'.repeat(65) }),
      api.getPublished({ locator: 'Not A Valid Slug' }),
    ])

    expect(results.map(JSON.stringify)).toEqual([
      JSON.stringify({ status: 'UNAVAILABLE' }),
      JSON.stringify({ status: 'UNAVAILABLE' }),
      JSON.stringify({ status: 'UNAVAILABLE' }),
    ])
    expect(mocks.resolvePublished).toHaveBeenCalledTimes(3)
  })

  it('keeps malformed picker locators on the uniform unavailable error path', async () => {
    audience = 'WORKSPACE_MEMBERS_WITH_LINK'
    mocks.resolvePublished.mockResolvedValue({ status: 'UNAVAILABLE' })
    const { api, prisma } = caller(USER_ID)

    for (const locator of ['', 'x'.repeat(65), 'Not A Valid Slug']) {
      await expect(
        api.listPickerOptions({
          locator,
          versionToken: tokenFor(version),
          questionId: 'person',
          limit: 10,
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'FORM_PICKER_UNAVAILABLE' })
    }
    expect(prisma.databaseProperty.findFirst).not.toHaveBeenCalled()
  })

  it('uses one normalized custom locator for lookup, token issue and token validation', async () => {
    audience = 'WORKSPACE_MEMBERS_WITH_LINK'
    const { api, prisma } = caller(USER_ID)
    prisma.databaseProperty.findFirst.mockResolvedValue({
      id: PERSON_PROPERTY_ID,
      type: 'PERSON',
      settings: null,
    })
    prisma.user.findMany.mockResolvedValue([])

    const published = await api.getPublished({ locator: '  Public-Form  ' })
    if (published.status !== 'OPEN') throw new Error('expected open form')

    await expect(
      api.listPickerOptions({
        locator: 'public-form',
        versionToken: published.versionToken,
        questionId: 'person',
        limit: 10,
      }),
    ).resolves.toEqual({ items: [], nextCursor: null })
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

  it('returns one bounded sparse RELATION page and resumes to a later title match', async () => {
    audience = 'WORKSPACE_MEMBERS_WITH_LINK'
    const { api, prisma } = caller(USER_ID)
    prisma.databaseProperty.findFirst.mockResolvedValue({
      id: RELATION_PROPERTY_ID,
      type: 'RELATION',
      settings: { relation: { targetSourceId: TARGET_SOURCE_ID } },
    })
    prisma.databaseSource.findFirst.mockResolvedValue({ id: TARGET_SOURCE_ID, pageId: TARGET_PAGE_ID })
    mocks.listRows
      .mockResolvedValueOnce({
        rows: [{ rowId: ROW_ID, pageId: LINKED_PAGE_ID, title: 'No title match', icon: null, position: 1024, cells: {} }],
        nextCursor: CONTINUATION_ROW_ID,
      })
      .mockResolvedValueOnce({
        rows: [{ rowId: CONTINUATION_ROW_ID, pageId: LINKED_PAGE_ID, title: 'Needle found later', icon: null, position: 2048, cells: {} }],
        nextCursor: null,
      })
    const published = await api.getPublished({ locator: 'anf_public-key' })
    if (published.status !== 'OPEN') throw new Error('expected open form')

    const sparse = await api.listPickerOptions({
      locator: 'anf_public-key', versionToken: published.versionToken,
      questionId: 'relation', query: 'needle', limit: 10,
    })
    expect(sparse).toEqual({ items: [], nextCursor: CONTINUATION_ROW_ID })
    expect(mocks.listRows).toHaveBeenCalledTimes(1)

    const resumed = await api.listPickerOptions({
      locator: 'anf_public-key', versionToken: published.versionToken,
      questionId: 'relation', query: 'needle', cursor: sparse.nextCursor ?? undefined, limit: 10,
    })
    expect(resumed).toEqual({
      items: [{ id: CONTINUATION_ROW_ID, label: 'Needle found later' }], nextCursor: null,
    })
    expect(mocks.listRows).toHaveBeenCalledTimes(2)
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
        where: expect.objectContaining({
          id: TARGET_SOURCE_ID,
          workspaceId: WORKSPACE_ID,
          page: expect.objectContaining({ archivedAt: null, deletedAt: null }),
        }),
      }),
    )
  })

  it("rejects a RELATION target in another user's PERSONAL collection before row lookup", async () => {
    audience = 'WORKSPACE_MEMBERS_WITH_LINK'
    const { api, prisma } = caller(USER_ID)
    prisma.databaseProperty.findFirst.mockResolvedValue({
      id: RELATION_PROPERTY_ID, type: 'RELATION',
      settings: { relation: { targetSourceId: TARGET_SOURCE_ID } },
    })
    prisma.databaseSource.findFirst.mockResolvedValue(null)
    const published = await api.getPublished({ locator: 'anf_public-key' })
    if (published.status !== 'OPEN') throw new Error('expected open form')

    await expect(api.listPickerOptions({
      locator: 'anf_public-key', versionToken: published.versionToken,
      questionId: 'relation', limit: 10,
    })).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'FORM_PICKER_UNAVAILABLE' })
    expect(prisma.databaseSource.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        page: expect.objectContaining({ AND: [{ OR: expect.arrayContaining([
          { collection: { kind: 'PERSONAL', ownerId: USER_ID } },
        ]) }] }),
      }),
    }))
    expect(mocks.listRows).not.toHaveBeenCalled()
  })

  it('accepts every live grace version plus current and uniformly rejects expired or wrong-form versions', async () => {
    audience = 'WORKSPACE_MEMBERS_WITH_LINK'
    const graceV1: FormVersionRecord = { ...version, id: '00000000-0000-7000-8000-000000000011', versionNumber: 1, acceptUntil: new Date(NOW + 60_000) }
    const graceV2: FormVersionRecord = { ...version, id: '00000000-0000-7000-8000-000000000012', versionNumber: 2, acceptUntil: new Date(NOW + 60_000) }
    const expired: FormVersionRecord = { ...version, id: '00000000-0000-7000-8000-000000000013', versionNumber: 4, acceptUntil: new Date(NOW - 1) }
    const wrongForm: FormVersionRecord = { ...version, id: '00000000-0000-7000-8000-000000000014', formId: WRONG_FORM_ID, versionNumber: 5, acceptUntil: new Date(NOW + 60_000) }
    const versions = new Map([graceV1, graceV2, version, expired, wrongForm].map((item) => [item.versionNumber, item]))
    mocks.resolveVersion.mockImplementation(async (_form, versionNumber) => versions.get(versionNumber) ?? null)
    const { api, prisma } = caller(USER_ID)
    prisma.databaseProperty.findFirst.mockResolvedValue({ id: PERSON_PROPERTY_ID, type: 'PERSON', settings: null })
    prisma.user.findMany.mockResolvedValue([])

    for (const accepted of [graceV1, graceV2, version]) {
      await expect(api.listPickerOptions({
        locator: 'anf_public-key', versionToken: tokenFor(accepted), questionId: 'person', limit: 10,
      })).resolves.toEqual({ items: [], nextCursor: null })
    }
    const unavailable = { code: 'NOT_FOUND', message: 'FORM_PICKER_UNAVAILABLE' }
    await expect(api.listPickerOptions({
      locator: 'anf_public-key', versionToken: tokenFor(expired), questionId: 'person', limit: 10,
    })).rejects.toMatchObject(unavailable)
    await expect(api.listPickerOptions({
      locator: 'anf_public-key', versionToken: tokenFor(wrongForm), questionId: 'person', limit: 10,
    })).rejects.toMatchObject(unavailable)
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
