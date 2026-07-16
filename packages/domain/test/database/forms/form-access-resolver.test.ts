import { describe, expect, it, vi } from 'vitest'

import type {
  FormRepositoryContract,
  FormVersionRecord,
  PublicFormRecord,
} from '../../../src/database/forms/database-form.repository.ts'
import { FormAccessResolver } from '../../../src/database/forms/form-access-resolver.ts'
import { forbidden } from '../../../src/shared/errors.ts'

const NOW = new Date('2026-07-16T08:00:00.000Z')
const USER_ID = '00000000-0000-7000-8000-000000000001'

const version = (overrides: Partial<FormVersionRecord> = {}): FormVersionRecord =>
  ({
    id: '00000000-0000-7000-8000-000000000010',
    formId: '00000000-0000-7000-8000-000000000020',
    versionNumber: 2,
    schemaVersion: 1,
    schema: {},
    schemaHash: 'a'.repeat(64),
    publishedById: USER_ID,
    publishedAt: new Date('2026-07-16T07:00:00.000Z'),
    acceptUntil: null,
    ...overrides,
  }) as FormVersionRecord

const publicForm = (overrides: Partial<PublicFormRecord> = {}): PublicFormRecord => {
  const current = version()
  return {
    id: current.formId,
    sourceId: '00000000-0000-7000-8000-000000000030',
    routeKey: 'anf_key',
    customSlug: 'public-form',
    linkRevision: 1,
    state: 'OPEN',
    audience: 'ANYONE_WITH_LINK',
    respondentAccess: 'NONE',
    publishedVersionId: current.id,
    opensAt: null,
    closesAt: null,
    responseLimit: null,
    acceptedResponses: 0,
    createdById: USER_ID,
    source: {
      workspaceId: '00000000-0000-7000-8000-000000000040',
      pageId: '00000000-0000-7000-8000-000000000050',
      page: { archivedAt: null, deletedAt: null },
      workspace: {
        id: '00000000-0000-7000-8000-000000000040',
        securityPolicy: { disablePublicLinksSitesForms: false },
      },
    },
    publishedVersion: current,
    ...overrides,
  }
}

function makeHarness(form: PublicFormRecord | null = publicForm()) {
  const repo = {
    findByLocator: vi.fn(async () => form),
    findVersion: vi.fn(async (_formId: string, versionNumber: number) =>
      form?.publishedVersion?.versionNumber === versionNumber ? form.publishedVersion : null,
    ),
  }
  const workspace = {
    assertMembership: vi.fn(async (userId: string, workspaceId: string) => ({
      userId,
      workspaceId,
      role: 'VIEWER' as const,
    })),
  }
  const resolver = new FormAccessResolver(
    repo as Pick<FormRepositoryContract, 'findByLocator' | 'findVersion'>,
    workspace,
    () => NOW,
  )
  return { resolver, repo, workspace }
}

describe('FormAccessResolver.resolvePublished', () => {
  it.each([
    ['unknown form', null],
    ['archived form', publicForm({ state: 'ARCHIVED' })],
    ['draft form', publicForm({ state: 'DRAFT' })],
    ['missing current version', publicForm({ publishedVersionId: null, publishedVersion: null })],
    [
      'archived source page',
      publicForm({
        source: {
          ...publicForm().source,
          page: { archivedAt: new Date('2026-07-16T07:00:00.000Z'), deletedAt: null },
        },
      }),
    ],
    [
      'deleted source page',
      publicForm({
        source: {
          ...publicForm().source,
          page: { archivedAt: null, deletedAt: new Date('2026-07-16T07:00:00.000Z') },
        },
      }),
    ],
  ])('collapses %s to the uniform unavailable result', async (_label, form) => {
    const { resolver } = makeHarness(form)

    await expect(resolver.resolvePublished('anf_key', USER_ID)).resolves.toEqual({
      status: 'UNAVAILABLE',
    })
  })

  it.each([
    ['empty locator', ''],
    ['overlong locator', 'x'.repeat(65)],
    ['invalid slug', 'Not A Valid Slug'],
  ])('rejects an %s without querying persistence', async (_label, locator) => {
    const { resolver, repo } = makeHarness()

    await expect(resolver.resolvePublished(locator, USER_ID)).resolves.toEqual({
      status: 'UNAVAILABLE',
    })
    expect(repo.findByLocator).not.toHaveBeenCalled()
  })

  it('normalizes a valid custom slug through the shared locator schemas', async () => {
    const { resolver, repo } = makeHarness()

    await expect(resolver.resolvePublished('  Public-Form  ', USER_ID)).resolves.toMatchObject({
      status: 'OPEN',
      locator: 'public-form',
    })

    expect(repo.findByLocator).toHaveBeenCalledWith('public-form')
  })

  it('preserves the exact generated route key during normalization', async () => {
    const { resolver, repo } = makeHarness()

    await expect(resolver.resolvePublished('  anf_KeyCase  ', USER_ID)).resolves.toMatchObject({
      status: 'OPEN',
      locator: 'anf_KeyCase',
    })
    expect(repo.findByLocator).toHaveBeenCalledWith('anf_KeyCase')
  })

  it('loads one requested version through the form-scoped repository lookup', async () => {
    const requested = version({ versionNumber: 1 })
    const { resolver, repo } = makeHarness()
    repo.findVersion.mockResolvedValueOnce(requested)

    await expect(resolver.resolveVersion(publicForm(), 1)).resolves.toEqual(requested)

    expect(repo.findVersion).toHaveBeenCalledWith(publicForm().id, 1)
  })

  it('checks the workspace policy before manual state', async () => {
    const base = publicForm()
    const { resolver } = makeHarness(
      publicForm({
        state: 'CLOSED',
        source: {
          ...base.source,
          workspace: {
            ...base.source.workspace,
            securityPolicy: { disablePublicLinksSitesForms: true },
          },
        },
      }),
    )

    await expect(resolver.resolvePublished('anf_key', USER_ID)).resolves.toEqual({
      status: 'POLICY_DISABLED',
    })
  })

  it('returns CLOSED for a manually closed form', async () => {
    const { resolver } = makeHarness(publicForm({ state: 'CLOSED' }))

    await expect(resolver.resolvePublished('anf_key', USER_ID)).resolves.toEqual({
      status: 'CLOSED',
    })
  })

  it('only exposes the opening time for a scheduled form', async () => {
    const opensAt = new Date('2026-07-16T09:00:00.000Z')
    const { resolver } = makeHarness(publicForm({ opensAt }))

    await expect(resolver.resolvePublished('anf_key', USER_ID)).resolves.toEqual({
      status: 'SCHEDULED',
      opensAt,
    })
  })

  it('returns CLOSED after the closing time without exposing it', async () => {
    const { resolver } = makeHarness(publicForm({ closesAt: new Date('2026-07-16T08:00:00.000Z') }))

    await expect(resolver.resolvePublished('anf_key', USER_ID)).resolves.toEqual({
      status: 'CLOSED',
    })
  })

  it('returns CAPPED once the response limit is reached', async () => {
    const { resolver } = makeHarness(publicForm({ responseLimit: 3, acceptedResponses: 3 }))

    await expect(resolver.resolvePublished('anf_key', USER_ID)).resolves.toEqual({
      status: 'CAPPED',
    })
  })

  it('uses the current version rather than an active grace version', async () => {
    const form = publicForm()
    const { resolver } = makeHarness(form)

    await expect(resolver.resolvePublished('anf_key', null)).resolves.toMatchObject({
      status: 'OPEN',
      version: { versionNumber: 2, acceptUntil: null },
    })
  })

  it('ignores an existing session identity for ANYONE_WITH_LINK', async () => {
    const { resolver, workspace } = makeHarness()

    await expect(resolver.resolvePublished('anf_key', USER_ID)).resolves.toMatchObject({
      status: 'OPEN',
      respondentUserId: null,
    })
    expect(workspace.assertMembership).not.toHaveBeenCalled()
  })

  it('requires and retains identity for SIGNED_IN_WITH_LINK', async () => {
    const signedOut = makeHarness(publicForm({ audience: 'SIGNED_IN_WITH_LINK' }))
    const signedIn = makeHarness(publicForm({ audience: 'SIGNED_IN_WITH_LINK' }))

    await expect(signedOut.resolver.resolvePublished('anf_key', null)).resolves.toEqual({
      status: 'AUTH_REQUIRED',
    })
    await expect(signedIn.resolver.resolvePublished('anf_key', USER_ID)).resolves.toMatchObject({
      status: 'OPEN',
      respondentUserId: USER_ID,
    })
    expect(signedIn.workspace.assertMembership).not.toHaveBeenCalled()
  })

  it('requires active membership for WORKSPACE_MEMBERS_WITH_LINK', async () => {
    const signedOut = makeHarness(publicForm({ audience: 'WORKSPACE_MEMBERS_WITH_LINK' }))
    const outsider = makeHarness(publicForm({ audience: 'WORKSPACE_MEMBERS_WITH_LINK' }))
    outsider.workspace.assertMembership.mockRejectedValueOnce(forbidden('not active'))
    const member = makeHarness(publicForm({ audience: 'WORKSPACE_MEMBERS_WITH_LINK' }))

    await expect(signedOut.resolver.resolvePublished('anf_key', null)).resolves.toEqual({
      status: 'AUTH_REQUIRED',
    })
    await expect(outsider.resolver.resolvePublished('anf_key', USER_ID)).resolves.toEqual({
      status: 'AUTH_REQUIRED',
    })
    await expect(member.resolver.resolvePublished('anf_key', USER_ID)).resolves.toMatchObject({
      status: 'OPEN',
      respondentUserId: USER_ID,
    })
    expect(member.workspace.assertMembership).toHaveBeenCalledWith(
      USER_ID,
      publicForm().source.workspaceId,
    )
  })
})
