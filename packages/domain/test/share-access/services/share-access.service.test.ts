import { describe, it, expect } from 'vitest'
import {
  ShareAccessService,
  hashSharePassword,
} from '../../../src/share-access/services/share-access.service.ts'
import type { ShareRow } from '../../../src/share-access/repositories/share-access.repository.ts'

const NOW = new Date('2026-06-08T12:00:00Z')

function makeShare(over: Partial<ShareRow> = {}): ShareRow {
  return {
    shareId: 's1',
    access: 'PUBLIC',
    linkRole: 'READER',
    mode: 'LINK',
    expiresAt: null,
    publishedAt: null,
    unpublishedAt: null,
    allowIndexing: false,
    allowCopy: false,
    publishSubpages: true,
    analyticsGoogleId: null,
    analyticsYandexMetricaId: null,
    passwordHash: null,
    exposesAt: null,
    page: {
      id: 'p1',
      type: 'TEXT',
      title: 'T',
      icon: null,
      workspaceId: 'w1',
      parentId: null,
      collectionId: 'c1',
      archivedAt: null,
      deletedAt: null,
    },
    ...over,
  }
}

function makeService(share: ShareRow | null) {
  const repo = {
    findShareByShareId: async () => share,
    findPathToRoot: async () => null,
  }
  return new ShareAccessService(repo as never)
}

describe('ShareAccessService (LINK mode)', () => {
  it('returns ok with linkRole when public link is enabled', async () => {
    const r = await makeService(makeShare()).resolve({ shareId: 's1', now: NOW })
    expect(r).toMatchObject({ status: 'ok', role: 'READER' })
  })

  it('denies not_found when no share row', async () => {
    const r = await makeService(null).resolve({ shareId: 'x', now: NOW })
    expect(r).toEqual({ status: 'unavailable', reason: 'not_found' })
  })

  it('denies disabled when access is RESTRICTED', async () => {
    const r = await makeService(makeShare({ access: 'RESTRICTED' })).resolve({
      shareId: 's1',
      now: NOW,
    })
    expect(r).toEqual({ status: 'unavailable', reason: 'disabled' })
  })

  it('denies expired after expiresAt', async () => {
    const r = await makeService(makeShare({ expiresAt: new Date('2026-06-07T00:00:00Z') })).resolve({
      shareId: 's1',
      now: NOW,
    })
    expect(r).toEqual({ status: 'unavailable', reason: 'expired' })
  })

  it('stays available before expiresAt', async () => {
    const r = await makeService(makeShare({ expiresAt: new Date('2026-06-09T00:00:00Z') })).resolve({
      shareId: 's1',
      now: NOW,
    })
    expect(r).toMatchObject({ status: 'ok' })
  })

  it('denies disabled when page is archived', async () => {
    const s = makeShare()
    s.page.archivedAt = NOW
    const r = await makeService(s).resolve({ shareId: 's1', now: NOW })
    expect(r).toEqual({ status: 'unavailable', reason: 'disabled' })
  })

  it('denies disabled when page is deleted', async () => {
    const s = makeShare()
    s.page.deletedAt = NOW
    const r = await makeService(s).resolve({ shareId: 's1', now: NOW })
    expect(r).toEqual({ status: 'unavailable', reason: 'disabled' })
  })

  it('denies restricted_child when a child page is requested in LINK mode', async () => {
    const r = await makeService(makeShare()).resolve({
      shareId: 's1',
      requestedPageId: 'p2',
      now: NOW,
    })
    expect(r).toEqual({ status: 'unavailable', reason: 'restricted_child' })
  })
})

describe('ShareAccessService (SITE mode)', () => {
  const siteBase = () => makeShare({ mode: 'SITE', publishedAt: new Date('2026-06-01T00:00:00Z') })

  it('ok when published', async () => {
    const r = await makeService(siteBase()).resolve({ shareId: 's1', now: NOW })
    expect(r).toMatchObject({ status: 'ok', role: 'READER' })
  })

  it('denies unpublished when no publishedAt', async () => {
    const r = await makeService(makeShare({ mode: 'SITE' })).resolve({ shareId: 's1', now: NOW })
    expect(r).toEqual({ status: 'unavailable', reason: 'unpublished' })
  })

  it('denies unpublished when unpublishedAt is after publishedAt', async () => {
    const s = siteBase()
    s.unpublishedAt = new Date('2026-06-05T00:00:00Z')
    const r = await makeService(s).resolve({ shareId: 's1', now: NOW })
    expect(r).toEqual({ status: 'unavailable', reason: 'unpublished' })
  })

  it('denies not_yet_exposed when exposesAt is in the future', async () => {
    const s = siteBase()
    s.exposesAt = new Date('2026-06-20T00:00:00Z')
    const r = await makeService(s).resolve({ shareId: 's1', now: NOW })
    expect(r).toEqual({ status: 'unavailable', reason: 'not_yet_exposed' })
  })

  it('denies password_required when password missing', async () => {
    const s = siteBase()
    s.passwordHash = await hashSharePassword('secret')
    const r = await makeService(s).resolve({ shareId: 's1', now: NOW })
    expect(r).toEqual({ status: 'unavailable', reason: 'password_required' })
  })

  it('ok when correct password supplied', async () => {
    const s = siteBase()
    s.passwordHash = await hashSharePassword('secret')
    const r = await makeService(s).resolve({ shareId: 's1', password: 'secret', now: NOW })
    expect(r).toMatchObject({ status: 'ok' })
  })

  it('denies child not descended from root', async () => {
    const repo = { findShareByShareId: async () => siteBase(), findPathToRoot: async () => null }
    const svc = new ShareAccessService(repo as never)
    const r = await svc.resolve({ shareId: 's1', requestedPageId: 'pX', now: NOW })
    expect(r).toEqual({ status: 'unavailable', reason: 'restricted_child' })
  })

  it('ok for a child in the published subtree', async () => {
    const repo = {
      findShareByShareId: async () => siteBase(),
      findPathToRoot: async () => [
        {
          id: 'p2',
          parentId: 'p1',
          collectionId: 'c1',
          archivedAt: null,
          deletedAt: null,
          collectionKind: 'TEAM',
          collectionOwnerId: null,
        },
        {
          id: 'p1',
          parentId: null,
          collectionId: 'c1',
          archivedAt: null,
          deletedAt: null,
          collectionKind: 'TEAM',
          collectionOwnerId: null,
        },
      ],
      findPublicPageById: async () => ({
        id: 'p2',
        type: 'TEXT',
        title: 'C',
        icon: null,
        workspaceId: 'w1',
      }),
    }
    const svc = new ShareAccessService(repo as never)
    const r = await svc.resolve({ shareId: 's1', requestedPageId: 'p2', now: NOW })
    expect(r).toMatchObject({ status: 'ok', page: { id: 'p2', title: 'C' } })
  })

  it('denies child when an ancestor is archived', async () => {
    const repo = {
      findShareByShareId: async () => siteBase(),
      findPathToRoot: async () => [
        {
          id: 'p2',
          parentId: 'p1',
          collectionId: 'c1',
          archivedAt: NOW,
          deletedAt: null,
          collectionKind: 'TEAM',
          collectionOwnerId: null,
        },
        {
          id: 'p1',
          parentId: null,
          collectionId: 'c1',
          archivedAt: null,
          deletedAt: null,
          collectionKind: 'TEAM',
          collectionOwnerId: null,
        },
      ],
    }
    const svc = new ShareAccessService(repo as never)
    const r = await svc.resolve({ shareId: 's1', requestedPageId: 'p2', now: NOW })
    expect(r).toEqual({ status: 'unavailable', reason: 'restricted_child' })
  })

  it('denies child in another user PERSONAL collection', async () => {
    const repo = {
      findShareByShareId: async () => siteBase(),
      findPathToRoot: async () => [
        {
          id: 'p2',
          parentId: 'p1',
          collectionId: 'cP',
          archivedAt: null,
          deletedAt: null,
          collectionKind: 'PERSONAL',
          collectionOwnerId: 'someoneElse',
        },
        {
          id: 'p1',
          parentId: null,
          collectionId: 'c1',
          archivedAt: null,
          deletedAt: null,
          collectionKind: 'TEAM',
          collectionOwnerId: null,
        },
      ],
    }
    const svc = new ShareAccessService(repo as never)
    const r = await svc.resolve({ shareId: 's1', requestedPageId: 'p2', now: NOW })
    expect(r).toEqual({ status: 'unavailable', reason: 'restricted_child' })
  })

  it('denies child when publishSubpages is false', async () => {
    const s = siteBase()
    s.publishSubpages = false
    const repo = {
      findShareByShareId: async () => s,
      findPathToRoot: async () => [
        {
          id: 'p2',
          parentId: 'p1',
          collectionId: 'c1',
          archivedAt: null,
          deletedAt: null,
          collectionKind: 'TEAM',
          collectionOwnerId: null,
        },
        {
          id: 'p1',
          parentId: null,
          collectionId: 'c1',
          archivedAt: null,
          deletedAt: null,
          collectionKind: 'TEAM',
          collectionOwnerId: null,
        },
      ],
    }
    const svc = new ShareAccessService(repo as never)
    const r = await svc.resolve({ shareId: 's1', requestedPageId: 'p2', now: NOW })
    expect(r).toEqual({ status: 'unavailable', reason: 'restricted_child' })
  })
})
