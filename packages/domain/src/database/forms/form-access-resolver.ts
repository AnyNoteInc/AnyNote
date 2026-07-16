import type { WorkspaceService } from '../../workspace/services/workspace.service.ts'
import { isDomainError } from '../../shared/errors.ts'
import { normalizeFormLocator } from './database-form.dto.ts'
import type {
  FormRepositoryContract,
  FormVersionRecord,
  OwnResponseSubmissionRecord,
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

export type ReplayFormResolution =
  | {
      status: 'ACCESSIBLE'
      locator: string
      form: PublicFormRecord
      version: FormVersionRecord
      respondentUserId: string | null
    }
  | { status: 'AUTH_REQUIRED' | 'POLICY_DISABLED' | 'UNAVAILABLE' }

type OwnResponseResolutionData = {
  locator: string
  form: PublicFormRecord
  version: FormVersionRecord
  submission: OwnResponseSubmissionRecord
  respondentUserId: string
}

export type OwnResponseResolution =
  | ({ status: 'VIEW' } & OwnResponseResolutionData)
  | ({ status: 'EDIT' } & OwnResponseResolutionData)
  | { status: 'UNAVAILABLE' }

type PublicFormLookup = Pick<
  FormRepositoryContract,
  'findByLocator' | 'findVersion' | 'findOwnResponseSubmission'
>
type ActiveMembershipAuthority = Pick<WorkspaceService, 'assertMembership'>

function isUnavailable(form: PublicFormRecord): boolean {
  return (
    form.state === 'ARCHIVED' ||
    form.state === 'DRAFT' ||
    form.publishedVersionId === null ||
    form.source.page.archivedAt !== null ||
    form.source.page.deletedAt !== null
  )
}

function isOwnResponseUnavailable(form: PublicFormRecord): boolean {
  return (
    form.state === 'ARCHIVED' ||
    form.state === 'DRAFT' ||
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

  /**
   * Resolve the durable identity/access context for an already committed
   * response. Unlike new-submission access, schedules, state and capacity are
   * deliberately ignored: those gates cannot invalidate an idempotent replay.
   */
  async resolveReplay(
    rawLocator: string,
    actorUserId: string | null,
  ): Promise<ReplayFormResolution> {
    const locator = normalizeFormLocator(rawLocator)
    if (locator === null) return { status: 'UNAVAILABLE' }

    const form = await this.repo.findByLocator(locator)
    if (form === null || isUnavailable(form)) return { status: 'UNAVAILABLE' }
    const version = form.publishedVersion
    if (version === null) return { status: 'UNAVAILABLE' }
    if (form.source.workspace.securityPolicy?.disablePublicLinksSitesForms === true) {
      return { status: 'POLICY_DISABLED' }
    }
    if (form.audience === 'ANYONE_WITH_LINK') {
      return { status: 'ACCESSIBLE', locator, form, version, respondentUserId: null }
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
    return { status: 'ACCESSIBLE', locator, form, version, respondentUserId: actorUserId }
  }

  /**
   * Resolve only a durable response owner. Manual close, schedules and caps do
   * not revoke an already submitted response; archival and the workspace
   * public-link kill switch do. Every miss intentionally collapses to the same
   * status so the locator/submission pair cannot be enumerated.
   */
  async resolveOwnResponse(
    rawLocator: string,
    submissionId: string,
    actorUserId: string | null,
  ): Promise<OwnResponseResolution> {
    const locator = normalizeFormLocator(rawLocator)
    if (locator === null || actorUserId === null) return { status: 'UNAVAILABLE' }

    const form = await this.repo.findByLocator(locator)
    if (
      form === null ||
      isOwnResponseUnavailable(form) ||
      form.respondentAccess === 'NONE' ||
      form.source.workspace.securityPolicy?.disablePublicLinksSitesForms === true
    ) {
      return { status: 'UNAVAILABLE' }
    }

    const submission = await this.repo.findOwnResponseSubmission(submissionId)
    if (
      submission === null ||
      submission.formId !== form.id ||
      submission.respondentUserId !== actorUserId ||
      submission.row.deletedAt !== null ||
      submission.version.formId !== form.id
    ) {
      return { status: 'UNAVAILABLE' }
    }

    const data: OwnResponseResolutionData = {
      locator,
      form,
      version: submission.version,
      submission,
      respondentUserId: actorUserId,
    }
    return form.respondentAccess === 'EDIT'
      ? { status: 'EDIT', ...data }
      : { status: 'VIEW', ...data }
  }

  async resolveVersion(
    form: PublicFormRecord,
    versionNumber: number,
  ): Promise<FormVersionRecord | null> {
    const version = await this.repo.findVersion(form.id, versionNumber)
    return version?.formId === form.id ? version : null
  }
}
