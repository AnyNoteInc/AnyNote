import type { WorkspaceService } from '../../workspace/services/workspace.service.ts'
import { isDomainError } from '../../shared/errors.ts'
import { customSlugSchema, formLocatorSchema } from './database-form.dto.ts'
import type {
  FormRepositoryContract,
  FormVersionRecord,
  PublicFormRecord,
} from './database-form.repository.ts'

export type PublishedFormResolution =
  | {
      status: 'OPEN'
      locator: string
      form: PublicFormRecord
      version: FormVersionRecord
      respondentUserId: string | null
    }
  | { status: 'SCHEDULED'; opensAt: Date }
  | {
      status: 'CLOSED' | 'CAPPED' | 'AUTH_REQUIRED' | 'POLICY_DISABLED' | 'UNAVAILABLE'
    }

type PublicFormLookup = Pick<FormRepositoryContract, 'findByLocator' | 'findVersion'>
type ActiveMembershipAuthority = Pick<WorkspaceService, 'assertMembership'>

const GENERATED_LOCATOR = /^anf_[A-Za-z0-9_-]+$/u

export function normalizeFormLocator(raw: string): string | null {
  const locator = formLocatorSchema.safeParse(raw)
  if (!locator.success) return null
  if (GENERATED_LOCATOR.test(locator.data)) return locator.data
  const slug = customSlugSchema.safeParse(locator.data)
  return slug.success ? slug.data : null
}

function isUnavailable(form: PublicFormRecord): boolean {
  return (
    form.state === 'ARCHIVED' ||
    form.state === 'DRAFT' ||
    form.publishedVersionId === null ||
    form.source.page.archivedAt !== null ||
    form.source.page.deletedAt !== null
  )
}

export class FormAccessResolver {
  private readonly repo: PublicFormLookup
  private readonly workspace: ActiveMembershipAuthority
  private readonly now: () => Date

  constructor(
    repo: PublicFormLookup,
    workspace: ActiveMembershipAuthority,
    now: () => Date = () => new Date(),
  ) {
    this.repo = repo
    this.workspace = workspace
    this.now = now
  }

  async resolvePublished(
    rawLocator: string,
    actorUserId: string | null,
  ): Promise<PublishedFormResolution> {
    const locator = normalizeFormLocator(rawLocator)
    if (locator === null) return { status: 'UNAVAILABLE' }

    const form = await this.repo.findByLocator(locator)
    if (form === null || isUnavailable(form)) return { status: 'UNAVAILABLE' }
    const version = form.publishedVersion
    if (version === null) return { status: 'UNAVAILABLE' }
    if (form.source.workspace.securityPolicy?.disablePublicLinksSitesForms === true) {
      return { status: 'POLICY_DISABLED' }
    }
    if (form.state !== 'OPEN') return { status: 'CLOSED' }

    const now = this.now()
    if (form.opensAt !== null && form.opensAt > now) {
      return { status: 'SCHEDULED', opensAt: form.opensAt }
    }
    if (form.closesAt !== null && form.closesAt <= now) return { status: 'CLOSED' }
    if (form.responseLimit !== null && form.acceptedResponses >= form.responseLimit) {
      return { status: 'CAPPED' }
    }

    if (form.audience === 'ANYONE_WITH_LINK') {
      return { status: 'OPEN', locator, form, version, respondentUserId: null }
    }
    if (actorUserId === null) return { status: 'AUTH_REQUIRED' }
    if (form.audience === 'WORKSPACE_MEMBERS_WITH_LINK') {
      try {
        await this.workspace.assertMembership(actorUserId, form.source.workspaceId)
      } catch (error) {
        if (isDomainError(error)) return { status: 'AUTH_REQUIRED' }
        throw error
      }
    }

    return {
      status: 'OPEN',
      locator,
      form,
      version,
      respondentUserId: actorUserId,
    }
  }

  async resolveVersion(
    form: PublicFormRecord,
    versionNumber: number,
  ): Promise<FormVersionRecord | null> {
    const version = await this.repo.findVersion(form.id, versionNumber)
    return version?.formId === form.id ? version : null
  }
}
