import { createHash, randomBytes } from 'node:crypto'

import type { DatabaseFormAudience, DatabaseFormRespondentAccess } from '@repo/db'

import type { BillingService } from '../../billing/services/billing.service.ts'
import type { DatabaseRepository, SourceWithLock } from '../repositories/database.repository.ts'
import { assertCanEditDatabaseStructure } from '../services/database-structure-access.ts'
import { badRequest, conflict, forbidden, notFound } from '../../shared/errors.ts'
import type { UnitOfWork } from '../../shared/unit-of-work.ts'
import type {
  CreateFormInput,
  DuplicateFormViewInput,
  FormIdInput,
  ListFormResponsesInput,
  ListFormsInput,
  PublishFormInput,
  RenameFormViewInput,
  SetFormSlugInput,
  UpdateFormDraftInput,
  UpdateFormSettingsInput,
} from './database-form.dto.ts'
import { customSlugSchema } from './database-form.dto.ts'
import type {
  FormRepositoryContract,
  ManagedFormRecord,
  UpdateFormSettingsRecord,
} from './database-form.repository.ts'
import {
  FORM_SCHEMA_VERSION,
  parseFormVersionDocument,
  type FormVersionDocument,
} from './form-document.ts'
import { validateFormGraph } from './form-graph.ts'
import { FORM_AUDIT, writeFormAudit } from './form-audit.ts'

const POSITION_GAP = 1024
const VERSION_GRACE_MS = 24 * 60 * 60 * 1000
const INTERNAL_PROPERTY_TYPES = new Set(['PERSON', 'RELATION', 'PAGE_LINK'])
const RESERVED_SLUGS = new Set([
  'app',
  'api',
  'auth',
  'login',
  'signup',
  'settings',
  'admin',
  's',
  'f',
  'forms',
])

type JsonObject = { [key: string]: unknown }

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as JsonObject)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    )
  }
  return value
}

export function canonicalFormSchemaHash(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex')
}

export function newFormRouteKey(): string {
  return `anf_${randomBytes(32).toString('base64url')}`
}

function emptyFormDocument(title: string): FormVersionDocument {
  return {
    schemaVersion: FORM_SCHEMA_VERSION,
    firstSectionId: 'section-1',
    presentation: {
      title,
      submitButtonText: 'Отправить',
      hideAnyNoteBranding: false,
    },
    sections: [{ id: 'section-1', title: 'Вопросы', questionIds: [] }],
    questions: [],
    transitions: [
      {
        id: 'transition-1',
        fromSectionId: 'section-1',
        priority: 0,
        when: null,
        target: { kind: 'ENDING', endingId: 'ending-1' },
      },
    ],
    endings: [{ id: 'ending-1', title: 'Спасибо' }],
  }
}

function sourceAuthority(form: ManagedFormRecord): SourceWithLock {
  return {
    id: form.source.id,
    workspaceId: form.source.workspaceId,
    pageId: form.source.pageId,
    structureLocked: form.source.structureLocked,
    pageCreatedById: form.source.page.createdById,
  }
}

function isUniqueConflict(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002'
  )
}

function sameDate(left: Date | null, right: Date | null): boolean {
  return left?.getTime() === right?.getTime()
}

function optionIds(settings: unknown): Set<string> {
  if (settings === null || typeof settings !== 'object') return new Set()
  const options = (settings as { options?: unknown }).options
  if (!Array.isArray(options)) return new Set()
  return new Set(
    options.flatMap((option) =>
      option !== null &&
      typeof option === 'object' &&
      typeof (option as { id?: unknown }).id === 'string'
        ? [(option as { id: string }).id]
        : [],
    ),
  )
}

export type PublishedFormResult = ManagedFormRecord & { versionNumber: number }

export class DatabaseFormService {
  private readonly repo: FormRepositoryContract
  private readonly databaseRepo: DatabaseRepository
  private readonly uow: UnitOfWork
  private readonly billing: BillingService
  private readonly now: () => Date

  constructor(
    repo: FormRepositoryContract,
    databaseRepo: DatabaseRepository,
    uow: UnitOfWork,
    billing: BillingService,
    now: () => Date = () => new Date(),
  ) {
    this.repo = repo
    this.databaseRepo = databaseRepo
    this.uow = uow
    this.billing = billing
    this.now = now
  }

  async create(actorUserId: string, input: CreateFormInput): Promise<ManagedFormRecord> {
    const initialSource = await this.requireSource(input.pageId)
    await assertCanEditDatabaseStructure(this.databaseRepo, actorUserId, initialSource)
    return this.uow.transaction(async () => {
      await this.lockSource(initialSource.id)
      const source = await this.requireSource(input.pageId)
      await assertCanEditDatabaseStructure(this.databaseRepo, actorUserId, source)
      const views = await this.databaseRepo.listViews(source.id)
      const form = await this.repo.createFormWithView({
        sourceId: source.id,
        title: input.title.trim(),
        position: (views.at(-1)?.position ?? 0) + POSITION_GAP,
        routeKey: newFormRouteKey(),
        draftSchema: emptyFormDocument(input.title.trim()),
        createdById: actorUserId,
      })
      await writeFormAudit(this.uow, {
        workspaceId: source.workspaceId,
        actorId: actorUserId,
        action: FORM_AUDIT.CREATED,
        metadata: { formId: form.id, ...(form.viewId === null ? {} : { viewId: form.viewId }) },
      })
      return form
    })
  }

  async get(actorUserId: string, input: FormIdInput): Promise<ManagedFormRecord> {
    await this.requireReadablePage(actorUserId, input.pageId)
    return this.requireForm(input.pageId, input.formId)
  }

  async list(actorUserId: string, input: ListFormsInput): Promise<ManagedFormRecord[]> {
    await this.requireReadablePage(actorUserId, input.pageId)
    return this.repo.listManagedForms(input.pageId)
  }

  async updateDraft(actorUserId: string, input: UpdateFormDraftInput): Promise<ManagedFormRecord> {
    const initial = await this.requireManageableForm(actorUserId, input)
    const document = parseFormVersionDocument(input.schema)
    return this.uow.transaction(async () => {
      await this.lockSource(initial.sourceId)
      const form = await this.requireManageableForm(actorUserId, input)
      if (form.state === 'ARCHIVED') throw badRequest('FORM_ARCHIVED')
      const updated = await this.repo.updateDraftIfRevision({
        formId: form.id,
        expectedRevision: input.expectedRevision,
        draftSchema: input.schema,
      })
      if (updated === null) throw conflict('FORM_DRAFT_CONFLICT')
      let previousBranding: boolean | undefined
      try {
        previousBranding = parseFormVersionDocument(form.draftSchema).presentation
          .hideAnyNoteBranding
      } catch {
        // A valid save may repair a malformed legacy draft. Treat the branding
        // value as changed so the exposure-affecting setting is still audited.
      }
      if (previousBranding !== document.presentation.hideAnyNoteBranding) {
        await writeFormAudit(this.uow, {
          workspaceId: form.source.workspaceId,
          actorId: actorUserId,
          action: FORM_AUDIT.SETTINGS_CHANGED,
          metadata: {
            formId: form.id,
            ...(form.viewId === null ? {} : { viewId: form.viewId }),
            changedSettings: ['hideAnyNoteBranding'],
          },
        })
      }
      return updated
    })
  }

  async publish(actorUserId: string, input: PublishFormInput): Promise<PublishedFormResult> {
    const initial = await this.requireManageableForm(actorUserId, input)
    await this.validatePublication(initial)

    return this.uow.transaction(async () => {
      await this.lockSource(initial.sourceId)
      const form = await this.requireManageableForm(actorUserId, input)
      const document = await this.validatePublication(form)
      const publishedAt = this.now()
      const versionNumber = (form.publishedVersion?.versionNumber ?? 0) + 1
      const state = form.state === 'DRAFT' ? 'OPEN' : form.state
      if (state !== 'OPEN' && state !== 'CLOSED') throw badRequest('FORM_STATE_INVALID')
      const updated = await this.repo.publishVersion({
        formId: form.id,
        previousPublishedVersionId: form.publishedVersionId,
        previousAcceptUntil:
          form.publishedVersionId === null
            ? null
            : new Date(publishedAt.getTime() + VERSION_GRACE_MS),
        versionNumber,
        schemaVersion: document.schemaVersion,
        schema: document,
        schemaHash: canonicalFormSchemaHash(document),
        publishedById: actorUserId,
        publishedAt,
        expectedState: form.state as Exclude<typeof form.state, 'ARCHIVED'>,
        expectedDraftRevision: form.draftRevision,
        expectedUpdatedAt: form.updatedAt,
        expectedLinkRevision: form.linkRevision,
        state,
      })
      await writeFormAudit(this.uow, {
        workspaceId: form.source.workspaceId,
        actorId: actorUserId,
        action: FORM_AUDIT.PUBLISHED,
        metadata: {
          formId: form.id,
          ...(form.viewId === null ? {} : { viewId: form.viewId }),
          versionNumber,
        },
      })
      return Object.assign(updated, { versionNumber })
    })
  }

  async updateSettings(
    actorUserId: string,
    input: UpdateFormSettingsInput,
  ): Promise<ManagedFormRecord> {
    const initial = await this.requireManageableForm(actorUserId, input)
    return this.uow.transaction(async () => {
      await this.lockSource(initial.sourceId)
      const form = await this.requireManageableForm(actorUserId, input)
      if (form.state === 'ARCHIVED') throw badRequest('FORM_ARCHIVED')
      if (input.opensAt !== null && input.closesAt !== null && input.opensAt >= input.closesAt) {
        throw badRequest('FORM_SCHEDULE_INVALID')
      }
      if (
        input.responseLimit !== null &&
        (!Number.isInteger(input.responseLimit) || input.responseLimit <= 0)
      ) {
        throw badRequest('FORM_RESPONSE_LIMIT_INVALID')
      }
      const respondentAccess =
        input.audience === 'ANYONE_WITH_LINK' ? 'NONE' : input.respondentAccess
      if (form.publishedVersion !== null) {
        let publishedDocument: FormVersionDocument
        try {
          publishedDocument = parseFormVersionDocument(form.publishedVersion.schema)
        } catch {
          throw badRequest('FORM_SCHEMA_INVALID')
        }
        this.assertAudienceCompatibility(input.audience, publishedDocument)
      }
      const changedSettings = this.changedSettings(form, { ...input, respondentAccess })
      if (changedSettings.length === 0) return form
      const updated = await this.repo.updateSettings({
        ...this.snapshot(form),
        audience: input.audience,
        respondentAccess,
        opensAt: input.opensAt,
        closesAt: input.closesAt,
        responseLimit: input.responseLimit,
        notifyOwners: input.notifyOwners,
      })
      await writeFormAudit(this.uow, {
        workspaceId: form.source.workspaceId,
        actorId: actorUserId,
        action: FORM_AUDIT.SETTINGS_CHANGED,
        metadata: {
          formId: form.id,
          ...(form.viewId === null ? {} : { viewId: form.viewId }),
          changedSettings,
        },
      })
      return updated
    })
  }

  async setSlug(actorUserId: string, input: SetFormSlugInput): Promise<ManagedFormRecord> {
    const initial = await this.requireManageableForm(actorUserId, input)
    const slug = this.normalizeSlug(input.slug)
    return this.uow.transaction(async () => {
      await this.lockSource(initial.sourceId)
      const form = await this.requireManageableForm(actorUserId, input)
      if (form.state === 'ARCHIVED') throw badRequest('FORM_ARCHIVED')
      if (form.customSlug === slug) return form
      if (slug !== null) {
        const features = await this.billing.getWorkspaceFeatures(form.source.workspaceId)
        if (!features.formCustomSlugEnabled) throw forbidden('PLAN_UPGRADE_REQUIRED')
      }
      try {
        const updated = await this.repo.updateSettings({
          ...this.snapshot(form),
          customSlug: slug,
          linkRevision: form.linkRevision + 1,
        })
        await writeFormAudit(this.uow, {
          workspaceId: form.source.workspaceId,
          actorId: actorUserId,
          action: FORM_AUDIT.SLUG_CHANGED,
          metadata: {
            formId: form.id,
            ...(form.viewId === null ? {} : { viewId: form.viewId }),
            changedSettings: ['customSlug'],
          },
        })
        return updated
      } catch (error) {
        if (isUniqueConflict(error)) throw conflict('FORM_SLUG_TAKEN')
        throw error
      }
    })
  }

  async rotateKey(actorUserId: string, input: FormIdInput): Promise<ManagedFormRecord> {
    const initial = await this.requireManageableForm(actorUserId, input)
    return this.uow.transaction(async () => {
      await this.lockSource(initial.sourceId)
      const form = await this.requireManageableForm(actorUserId, input)
      if (form.state === 'ARCHIVED') throw badRequest('FORM_ARCHIVED')
      const updated = await this.repo.updateSettings({
        ...this.snapshot(form),
        routeKey: newFormRouteKey(),
        linkRevision: form.linkRevision + 1,
      })
      await writeFormAudit(this.uow, {
        workspaceId: form.source.workspaceId,
        actorId: actorUserId,
        action: FORM_AUDIT.KEY_ROTATED,
        metadata: {
          formId: form.id,
          ...(form.viewId === null ? {} : { viewId: form.viewId }),
          changedSettings: ['routeKey'],
        },
      })
      return updated
    })
  }

  close(actorUserId: string, input: FormIdInput): Promise<ManagedFormRecord> {
    return this.changeState(actorUserId, input, 'OPEN', 'CLOSED', FORM_AUDIT.CLOSED)
  }

  reopen(actorUserId: string, input: FormIdInput): Promise<ManagedFormRecord> {
    return this.changeState(actorUserId, input, 'CLOSED', 'OPEN', FORM_AUDIT.OPENED)
  }

  async archive(actorUserId: string, input: FormIdInput): Promise<{ ok: true }> {
    const initial = await this.requireManageableForm(actorUserId, input)
    return this.uow.transaction(async () => {
      await this.lockSource(initial.sourceId)
      const form = await this.requireManageableForm(actorUserId, input)
      if (form.state === 'ARCHIVED') return { ok: true }
      await this.repo.archiveForm({ formId: form.id })
      await writeFormAudit(this.uow, {
        workspaceId: form.source.workspaceId,
        actorId: actorUserId,
        action: FORM_AUDIT.ARCHIVED,
        metadata: { formId: form.id, ...(form.viewId === null ? {} : { viewId: form.viewId }) },
      })
      return { ok: true }
    })
  }

  async duplicateByView(
    actorUserId: string,
    input: DuplicateFormViewInput,
  ): Promise<ManagedFormRecord> {
    const initialView = await this.databaseRepo.findViewById(input.viewId)
    if (initialView?.type !== 'FORM' || initialView.formId === null) {
      throw notFound('FORM_VIEW_NOT_FOUND')
    }
    const initial = await this.requireManageableForm(actorUserId, {
      pageId: input.pageId,
      formId: initialView.formId,
    })
    return this.uow.transaction(async () => {
      await this.lockSource(initial.sourceId)
      const view = await this.databaseRepo.findViewById(input.viewId)
      if (view?.type !== 'FORM' || view.formId === null) throw notFound('FORM_VIEW_NOT_FOUND')
      const form = await this.requireManageableForm(actorUserId, {
        pageId: input.pageId,
        formId: view.formId,
      })
      const views = await this.databaseRepo.listViews(form.sourceId)
      const duplicate = await this.repo.duplicateForm({
        sourceId: form.sourceId,
        title: `${form.view?.title ?? 'Форма'} (копия)`,
        position: (views.at(-1)?.position ?? 0) + POSITION_GAP,
        routeKey: newFormRouteKey(),
        draftSchema: parseFormVersionDocument(form.draftSchema),
        createdById: actorUserId,
        audience: form.audience,
        respondentAccess: form.respondentAccess,
        opensAt: form.opensAt,
        closesAt: form.closesAt,
        responseLimit: form.responseLimit,
        notifyOwners: form.notifyOwners,
      })
      await writeFormAudit(this.uow, {
        workspaceId: form.source.workspaceId,
        actorId: actorUserId,
        action: FORM_AUDIT.CREATED,
        metadata: {
          formId: duplicate.id,
          ...(duplicate.viewId === null ? {} : { viewId: duplicate.viewId }),
        },
      })
      return duplicate
    })
  }

  async renameByView(actorUserId: string, input: RenameFormViewInput) {
    const initialView = await this.databaseRepo.findViewById(input.viewId)
    if (initialView?.type !== 'FORM' || initialView.formId === null) {
      throw notFound('FORM_VIEW_NOT_FOUND')
    }
    const initial = await this.requireManageableForm(actorUserId, {
      pageId: input.pageId,
      formId: initialView.formId,
    })
    return this.uow.transaction(async () => {
      await this.lockSource(initial.sourceId)
      const view = await this.databaseRepo.findViewById(input.viewId)
      if (view?.type !== 'FORM' || view.formId === null) throw notFound('FORM_VIEW_NOT_FOUND')
      const form = await this.requireManageableForm(actorUserId, {
        pageId: input.pageId,
        formId: view.formId,
      })
      if (form.state === 'ARCHIVED') throw badRequest('FORM_ARCHIVED')
      const updated = await this.databaseRepo.updateView(view.id, { title: input.title.trim() })
      await writeFormAudit(this.uow, {
        workspaceId: form.source.workspaceId,
        actorId: actorUserId,
        action: FORM_AUDIT.SETTINGS_CHANGED,
        metadata: {
          formId: form.id,
          viewId: view.id,
          changedSettings: ['viewTitle'],
        },
      })
      return updated
    })
  }

  async listVersions(actorUserId: string, input: FormIdInput) {
    const form = await this.requireManageableForm(actorUserId, input)
    return this.repo.listVersions(form.id)
  }

  async listResponses(actorUserId: string, input: ListFormResponsesInput) {
    const form = await this.requireManageableForm(actorUserId, input)
    return this.repo.listResponses({ formId: form.id, cursor: input.cursor, limit: input.limit })
  }

  private async changeState(
    actorUserId: string,
    input: FormIdInput,
    from: 'OPEN' | 'CLOSED',
    to: 'OPEN' | 'CLOSED',
    action: typeof FORM_AUDIT.OPENED | typeof FORM_AUDIT.CLOSED,
  ): Promise<ManagedFormRecord> {
    const initial = await this.requireManageableForm(actorUserId, input)
    return this.uow.transaction(async () => {
      await this.lockSource(initial.sourceId)
      const form = await this.requireManageableForm(actorUserId, input)
      if (form.state !== from || form.publishedVersionId === null)
        throw badRequest('FORM_STATE_INVALID')
      const updated = await this.repo.updateSettings({ ...this.snapshot(form), state: to })
      await writeFormAudit(this.uow, {
        workspaceId: form.source.workspaceId,
        actorId: actorUserId,
        action,
        metadata: { formId: form.id, ...(form.viewId === null ? {} : { viewId: form.viewId }) },
      })
      return updated
    })
  }

  private async requireManageableForm(
    actorUserId: string,
    input: Pick<FormIdInput, 'pageId' | 'formId'>,
  ): Promise<ManagedFormRecord> {
    const form = await this.requireForm(input.pageId, input.formId)
    await assertCanEditDatabaseStructure(this.databaseRepo, actorUserId, sourceAuthority(form))
    return form
  }

  private async requireForm(pageId: string, formId: string): Promise<ManagedFormRecord> {
    const form = await this.repo.findManagedForm(pageId, formId)
    if (form === null) throw notFound('FORM_NOT_FOUND')
    return form
  }

  private async requireSource(pageId: string): Promise<SourceWithLock> {
    const source = await this.databaseRepo.findSourceWithLockByPageId(pageId)
    if (source === null) throw notFound('FORM_SOURCE_NOT_FOUND')
    return source
  }

  private async requireReadablePage(actorUserId: string, pageId: string): Promise<void> {
    if ((await this.databaseRepo.findAccessiblePage(actorUserId, pageId)) === null) {
      throw notFound('FORM_NOT_FOUND')
    }
  }

  private async lockSource(sourceId: string): Promise<void> {
    if (!(await this.databaseRepo.lockSourceForStructureMutation(sourceId, this.now()))) {
      throw conflict('FORM_SOURCE_CONFLICT')
    }
  }

  private snapshot(
    form: ManagedFormRecord,
  ): Pick<
    UpdateFormSettingsRecord,
    | 'formId'
    | 'expectedState'
    | 'expectedUpdatedAt'
    | 'expectedLinkRevision'
    | 'expectedDraftRevision'
    | 'expectedPublishedVersionId'
  > {
    return {
      formId: form.id,
      expectedState: form.state,
      expectedUpdatedAt: form.updatedAt,
      expectedLinkRevision: form.linkRevision,
      expectedDraftRevision: form.draftRevision,
      expectedPublishedVersionId: form.publishedVersionId,
    }
  }

  private async validatePublication(form: ManagedFormRecord): Promise<FormVersionDocument> {
    if (form.state === 'ARCHIVED') throw badRequest('FORM_ARCHIVED')
    let document: FormVersionDocument
    try {
      document = parseFormVersionDocument(form.draftSchema)
    } catch {
      throw badRequest('FORM_SCHEMA_INVALID')
    }
    const graph = validateFormGraph(document)
    if (!graph.ok) throw badRequest('FORM_GRAPH_INVALID')
    await this.assertPropertyDependencies(form, document)
    this.assertAudienceCompatibility(form.audience, document)
    await this.assertPlanFeatures(form, document)
    return document
  }

  private async assertPropertyDependencies(
    form: ManagedFormRecord,
    document: FormVersionDocument,
  ): Promise<void> {
    const properties = new Map(form.source.properties.map((property) => [property.id, property]))
    for (const question of document.questions) {
      if (question.property.kind === 'TITLE') continue
      const property = properties.get(question.property.propertyId)
      if (property === undefined || property.type !== question.property.propertyType) {
        throw badRequest('FORM_PROPERTY_INVALID')
      }
      if (question.input.kind === 'SINGLE_CHOICE' || question.input.kind === 'MULTI_CHOICE') {
        const currentIds = optionIds(property.settings)
        if (question.input.options.some(({ id }) => !currentIds.has(id))) {
          throw badRequest('FORM_PROPERTY_INVALID')
        }
      }
      if (question.property.propertyType === 'RELATION') {
        const relation =
          property.settings !== null && typeof property.settings === 'object'
            ? (property.settings as { relation?: { targetSourceId?: unknown } }).relation
            : undefined
        if (typeof relation?.targetSourceId !== 'string') throw badRequest('FORM_PROPERTY_INVALID')
        const targetWorkspace = await this.databaseRepo.findSourceWorkspaceId(
          relation.targetSourceId,
        )
        if (targetWorkspace !== form.source.workspaceId) throw badRequest('FORM_PROPERTY_INVALID')
      }
    }
  }

  private assertAudienceCompatibility(
    audience: DatabaseFormAudience,
    document: FormVersionDocument,
  ): void {
    if (
      audience !== 'WORKSPACE_MEMBERS_WITH_LINK' &&
      document.questions.some(
        (question) =>
          question.property.kind === 'PROPERTY' &&
          INTERNAL_PROPERTY_TYPES.has(question.property.propertyType),
      )
    ) {
      throw badRequest('FORM_AUDIENCE_INCOMPATIBLE')
    }
  }

  private async assertPlanFeatures(
    form: ManagedFormRecord,
    document: FormVersionDocument,
  ): Promise<void> {
    const features = await this.billing.getWorkspaceFeatures(form.source.workspaceId)
    const conditional =
      document.endings.length > 1 ||
      document.questions.some((question) => question.visibleWhen !== undefined) ||
      document.transitions.some((transition) => transition.when !== null)
    if (
      (conditional && !features.formConditionalLogicEnabled) ||
      (form.customSlug !== null && !features.formCustomSlugEnabled) ||
      (document.presentation.hideAnyNoteBranding && !features.formBrandingRemovalEnabled)
    ) {
      throw forbidden('PLAN_UPGRADE_REQUIRED')
    }
  }

  private normalizeSlug(raw: string | null): string | null {
    if (raw === null || raw.trim() === '') return null
    const normalized = raw.trim().toLowerCase()
    if (
      normalized.startsWith('anf_') ||
      [...RESERVED_SLUGS].some(
        (reserved) => normalized === reserved || normalized.startsWith(`${reserved}-`),
      )
    ) {
      throw badRequest('FORM_SLUG_RESERVED')
    }
    const parsed = customSlugSchema.safeParse(normalized)
    if (!parsed.success) throw badRequest('FORM_SLUG_INVALID')
    return parsed.data
  }

  private changedSettings(
    form: ManagedFormRecord,
    next: {
      audience: DatabaseFormAudience
      respondentAccess: DatabaseFormRespondentAccess
      opensAt: Date | null
      closesAt: Date | null
      responseLimit: number | null
      notifyOwners: boolean
    },
  ): string[] {
    const changed: string[] = []
    if (form.audience !== next.audience) changed.push('audience')
    if (form.respondentAccess !== next.respondentAccess) changed.push('respondentAccess')
    if (!sameDate(form.opensAt, next.opensAt)) changed.push('opensAt')
    if (!sameDate(form.closesAt, next.closesAt)) changed.push('closesAt')
    if (form.responseLimit !== next.responseLimit) changed.push('responseLimit')
    if (form.notifyOwners !== next.notifyOwners) changed.push('notifyOwners')
    return changed
  }
}
