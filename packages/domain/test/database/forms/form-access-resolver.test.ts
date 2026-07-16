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
    versions: [
      version({
        id: '00000000-0000-7000-8000-000000000011',
        versionNumber: 1,
        acceptUntil: new Date('2026-07-17T07:00:00.000Z'),
      }),
    ],
    ...overrides,
  }
}

function makeHarness(form: PublicFormRecord | null = publicForm()) {
  const repo = {
    findByLocator: vi.fn(async () => form),
  }
  const workspace = {
    assertMembership: vi.fn(async (userId: string, workspaceId: string) => ({
      userId,
      workspaceId,
      role: 'VIEWER' as const,
    })),
  }
  const resolver = new FormAccessResolver(
    repo as Pick<FormRepositoryContract, 'findByLocator'>,
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

  it('rejects an invalid locator without querying persistence', async () => {
    const { resolver, repo } = makeHarness()

    await expect(resolver.resolvePublished('Not A Valid Slug', USER_ID)).resolves.toEqual({
      status: 'UNAVAILABLE',
    })
    expect(repo.findByLocator).not.toHaveBeenCalled()
  })

  it('normalizes a valid custom slug through the shared locator schemas', async () => {
    const { resolver, repo } = makeHarness()

    await resolver.resolvePublished('  Public-Form  ', USER_ID)

    expect(repo.findByLocator).toHaveBeenCalledWith('public-form')
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
