import { describe, it, expect } from 'vitest'
import { ShareAccessService } from '../../../src/share-access/services/share-access.service.ts'
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
