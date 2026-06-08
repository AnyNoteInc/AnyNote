import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto'

import type { ShareAccessRepository, ShareRow } from '../repositories/share-access.repository.ts'
import type {
  PublicShareResult,
  ResolvePublicShareInput,
  PublicAccessRole,
} from '../dto/share-access.dto.ts'

const SCRYPT_KEYLEN = 64

export async function hashSharePassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex')
  const derived = scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex')
  return `${salt}:${derived}`
}

export function verifySharePassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':')
  if (!salt || !hash) return false
  const derived = scryptSync(password, salt, SCRYPT_KEYLEN)
  const expected = Buffer.from(hash, 'hex')
  return derived.length === expected.length && timingSafeEqual(derived, expected)
}

export class ShareAccessService {
  private readonly repo: ShareAccessRepository
  constructor(repo: ShareAccessRepository) {
    this.repo = repo
  }

  async resolve(input: ResolvePublicShareInput): Promise<PublicShareResult> {
    const share = await this.repo.findShareByShareId(input.shareId)
    if (!share) return { status: 'unavailable', reason: 'not_found' }

    // Root page must not be archived/deleted (closes the legacy leak).
    if (share.page.archivedAt || share.page.deletedAt)
      return { status: 'unavailable', reason: 'disabled' }

    if (share.expiresAt && share.expiresAt.getTime() <= input.now.getTime())
      return { status: 'unavailable', reason: 'expired' }

    const denial = share.mode === 'SITE' ? this.checkSite(share, input) : this.checkLink(share)
    if (denial) return denial

    // Child access only valid in SITE mode (checked in checkChild below).
    let resolvedPage = share.page
    if (input.requestedPageId && input.requestedPageId !== share.page.id) {
      if (share.mode !== 'SITE') return { status: 'unavailable', reason: 'restricted_child' }
      const child = await this.checkChild(share, input.requestedPageId)
      if (child) return child
      const childPage = await this.repo.findPublicPageById(input.requestedPageId)
      if (!childPage) return { status: 'unavailable', reason: 'restricted_child' }
      resolvedPage = { ...share.page, ...childPage }
    }

    const role = (share.mode === 'SITE' ? 'READER' : share.linkRole) as PublicAccessRole
    return {
      status: 'ok',
      role,
      page: {
        id: resolvedPage.id,
        type: resolvedPage.type,
        title: resolvedPage.title,
        icon: resolvedPage.icon,
        workspaceId: resolvedPage.workspaceId,
      },
      share: {
        shareId: share.shareId,
        mode: share.mode as 'LINK' | 'SITE',
        allowCopy: share.allowCopy,
        allowIndexing: share.allowIndexing,
        publishSubpages: share.publishSubpages,
        analyticsGoogleId: share.analyticsGoogleId,
        analyticsYandexMetricaId: share.analyticsYandexMetricaId,
      },
    }
  }

  private checkLink(share: ShareRow): PublicShareResult | null {
    if (share.access !== 'PUBLIC') return { status: 'unavailable', reason: 'disabled' }
    return null
  }

  protected checkSite(share: ShareRow, input: ResolvePublicShareInput): PublicShareResult | null {
    const published =
      share.publishedAt &&
      (!share.unpublishedAt || share.unpublishedAt.getTime() < share.publishedAt.getTime())
    if (!published) return { status: 'unavailable', reason: 'unpublished' }

    if (share.exposesAt && share.exposesAt.getTime() > input.now.getTime())
      return { status: 'unavailable', reason: 'not_yet_exposed' }

    if (share.passwordHash) {
      if (!input.password || !verifySharePassword(input.password, share.passwordHash))
        return { status: 'unavailable', reason: 'password_required' }
    }
    return null
  }

  protected async checkChild(share: ShareRow, childId: string): Promise<PublicShareResult | null> {
    if (!share.publishSubpages) return { status: 'unavailable', reason: 'restricted_child' }
    const path = await this.repo.findPathToRoot(childId, share.page.id)
    if (!path) return { status: 'unavailable', reason: 'restricted_child' }
    for (const node of path) {
      if (node.archivedAt || node.deletedAt)
        return { status: 'unavailable', reason: 'restricted_child' }
      if (node.collectionKind === 'PERSONAL')
        return { status: 'unavailable', reason: 'restricted_child' }
    }
    return null
  }
}
