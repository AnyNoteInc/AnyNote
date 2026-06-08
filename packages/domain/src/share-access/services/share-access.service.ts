import type { ShareAccessRepository, ShareRow } from '../repositories/share-access.repository.ts'
import type {
  PublicShareResult,
  ResolvePublicShareInput,
  PublicAccessRole,
} from '../dto/share-access.dto.ts'

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
    if (input.requestedPageId && input.requestedPageId !== share.page.id) {
      if (share.mode !== 'SITE') return { status: 'unavailable', reason: 'restricted_child' }
      const child = await this.checkChild(share, input.requestedPageId)
      if (child) return child
    }

    const role = (share.mode === 'SITE' ? 'READER' : share.linkRole) as PublicAccessRole
    return {
      status: 'ok',
      role,
      page: {
        id: share.page.id,
        type: share.page.type,
        title: share.page.title,
        icon: share.page.icon,
        workspaceId: share.page.workspaceId,
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

  // checkSite + checkChild implemented in Task A4 (return null for now).
  protected checkSite(_share: ShareRow, _input: ResolvePublicShareInput): PublicShareResult | null {
    return { status: 'unavailable', reason: 'unpublished' }
  }
  protected async checkChild(
    _share: ShareRow,
    _childId: string,
  ): Promise<PublicShareResult | null> {
    return { status: 'unavailable', reason: 'restricted_child' }
  }
}
