import { describe, expect, it, vi } from 'vitest'

import type { PlanFeatures } from '../../../src/billing/dto/billing.dto.ts'
import type { BillingService } from '../../../src/billing/services/billing.service.ts'
import type { DatabaseRepository } from '../../../src/database/repositories/database.repository.ts'
import {
  DatabaseFormService,
  canonicalFormSchemaHash,
  newFormRouteKey,
} from '../../../src/database/forms/database-form.service.ts'
import type {
  FormRepositoryContract,
  ManagedFormRecord,
} from '../../../src/database/forms/database-form.repository.ts'
import type { FormVersionDocument } from '../../../src/database/forms/public.ts'
import type { UnitOfWork } from '../../../src/shared/unit-of-work.ts'

const NOW = new Date('2026-07-16T00:00:00.000Z')

const linearDocument = (overrides: Partial<FormVersionDocument> = {}): FormVersionDocument => ({
  schemaVersion: 1,
  firstSectionId: 'section-1',
  presentation: {
    title: 'Contact',
    submitButtonText: 'Send',
    hideAnyNoteBranding: false,
  },
  sections: [{ id: 'section-1', title: 'Questions', questionIds: ['question-1'] }],
  questions: [
    {
      id: 'question-1',
      sectionId: 'section-1',
      property: { kind: 'PROPERTY', propertyId: 'property-1', propertyType: 'TEXT' },
      label: 'Name',
      required: false,
      syncWithPropertyName: false,
      input: { kind: 'TEXT', multiline: false, maxLength: 200 },
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
  ...overrides,
})

const managedForm = (overrides: Partial<ManagedFormRecord> = {}): ManagedFormRecord =>
  ({
    id: '00000000-0000-7000-8000-000000000010',
    sourceId: '00000000-0000-7000-8000-000000000020',
    viewId: '00000000-0000-7000-8000-000000000030',
    routeKey: 'anf_existing',
    customSlug: null,
    linkRevision: 1,
    state: 'DRAFT',
    audience: 'ANYONE_WITH_LINK',
    respondentAccess: 'NONE',
    draftSchema: linearDocument(),
    draftRevision: 1,
    publishedVersionId: null,
    opensAt: null,
    closesAt: null,
    responseLimit: null,
    acceptedResponses: 0,
    notifyOwners: true,
    createdById: '00000000-0000-7000-8000-000000000001',
    createdAt: NOW,
    updatedAt: NOW,
    source: {
      id: '00000000-0000-7000-8000-000000000020',
      workspaceId: '00000000-0000-7000-8000-000000000040',
      pageId: '00000000-0000-7000-8000-000000000050',
      structureLocked: false,
      page: {
        id: '00000000-0000-7000-8000-000000000050',
        createdById: '00000000-0000-7000-8000-000000000001',
        archivedAt: null,
        deletedAt: null,
      },
      workspace: {
        id: '00000000-0000-7000-8000-000000000040',
        securityPolicy: { disablePublicLinksSitesForms: false },
      },
      properties: [
        { id: 'property-1', type: 'TEXT', name: 'Name', position: 1024, settings: null },
      ],
    },
    view: { id: '00000000-0000-7000-8000-000000000030', title: 'Form', position: 1024 },
    createdBy: { id: '00000000-0000-7000-8000-000000000001', name: 'Owner' },
    publishedVersion: null,
    ...overrides,
  }) as ManagedFormRecord

const planFeatures = (overrides: Partial<PlanFeatures> = {}): PlanFeatures => ({
  slug: 'pro',
  name: 'Pro',
  sortOrder: 2,
  isPaid: true,
  maxWorkspaces: null,
  maxMembersPerWorkspace: 100,
  chatsEnabled: true,
  pageIndexingEnabled: true,
  membersSettingsEnabled: true,
  aiSettingsEnabled: true,
  customMcpEnabled: true,
  customAiProvidersEnabled: true,
  prioritySupport: true,
  developerSpaceEnabled: true,
  publicSitesEnabled: true,
  formConditionalLogicEnabled: true,
  formCustomSlugEnabled: true,
  formBrandingRemovalEnabled: true,
  meetingsEnabled: true,
  pageHistoryDays: null,
  ...overrides,
})

function makeHarness(
  options: {
    form?: ManagedFormRecord
    formRepo?: Partial<FormRepositoryContract>
    databaseRepo?: Partial<DatabaseRepository>
    features?: PlanFeatures
  } = {},
) {
  let current = options.form ?? managedForm()
  const formRepo = {
    createFormWithView: vi.fn(async () => current),
    findManagedForm: vi.fn(async () => current),
    listManagedForms: vi.fn(async () => [current]),
    updateDraftIfRevision: vi.fn(async () => ({ ...current, draftRevision: 2 })),
    publishVersion: vi.fn(async (input) => {
      current = {
        ...current,
        state: input.state,
        publishedVersionId: '00000000-0000-7000-8000-000000000060',
        publishedVersion: {
          id: '00000000-0000-7000-8000-000000000060',
          formId: current.id,
          versionNumber: input.versionNumber,
          schemaVersion: input.schemaVersion,
          schema: input.schema,
          schemaHash: input.schemaHash,
          publishedById: input.publishedById,
          publishedAt: input.publishedAt,
          acceptUntil: null,
        },
      } as ManagedFormRecord
      return current
    }),
    updateSettings: vi.fn(async (input) => {
      current = { ...current, ...input } as ManagedFormRecord
      return current
    }),
    duplicateForm: vi.fn(async () => managedForm({ id: 'duplicate', state: 'DRAFT' })),
    archiveForm: vi.fn(async () => undefined),
    listVersions: vi.fn(async () => []),
    listResponses: vi.fn(async () => ({ items: [], nextCursor: null })),
    findByLocator: vi.fn(async () => null),
    findVersion: vi.fn(async () => null),
    findSubmission: vi.fn(async () => null),
    findSubmissionByIdempotency: vi.fn(async () => null),
    hasProtectedPropertyDependency: vi.fn(async () => false),
    ...options.formRepo,
  } as unknown as FormRepositoryContract
  const databaseRepo = {
    findWorkspaceRole: vi.fn(async () => 'OWNER'),
    findSourceWithLockByPageId: vi.fn(async () => ({
      id: current.sourceId,
      workspaceId: current.source.workspaceId,
      pageId: current.source.pageId,
      structureLocked: false,
      pageCreatedById: current.source.page.createdById,
    })),
    listViews: vi.fn(async () => [{ position: 1024 }]),
    findViewById: vi.fn(async () => ({
      id: current.viewId!,
      sourceId: current.sourceId,
      type: 'FORM',
      formId: current.id,
    })),
    updateView: vi.fn(async (_id, data) => ({
      id: current.viewId!,
      type: 'FORM',
      title: data.title ?? current.view?.title ?? 'Form',
      position: current.view?.position ?? 1024,
      settings: data.settings ?? null,
    })),
    lockSourceForStructureMutation: vi.fn(async () => true),
    ...options.databaseRepo,
  } as unknown as DatabaseRepository
  const transaction = vi.fn(async (fn: () => Promise<unknown>) => fn())
  const auditCreate = vi.fn(async () => ({ id: 'audit-1' }))
  const uow = {
    transaction,
    client: vi.fn(() => ({ workspaceAuditLog: { create: auditCreate } })),
  } as unknown as UnitOfWork
  const billing = {
    getWorkspaceFeatures: vi.fn(async () => options.features ?? planFeatures()),
  } as unknown as BillingService
  const service = new DatabaseFormService(formRepo, databaseRepo, uow, billing, () => NOW)
  return { service, formRepo, databaseRepo, uow, billing, transaction, auditCreate }
}

describe('DatabaseFormService lifecycle', () => {
  it('creates a FORM view and form atomically with a server-generated anf_ key and audit', async () => {
    const { service, formRepo, transaction, auditCreate } = makeHarness()
    await service.create('00000000-0000-7000-8000-000000000001', {
      pageId: '00000000-0000-7000-8000-000000000050',
      title: 'Contact form',
    })

    expect(transaction).toHaveBeenCalledOnce()
    expect(formRepo.createFormWithView).toHaveBeenCalledWith(
      expect.objectContaining({ routeKey: expect.stringMatching(/^anf_[A-Za-z0-9_-]{43}$/) }),
    )
    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'database_form.created',
        metadata: expect.objectContaining({
          formId: expect.any(String),
          viewId: expect.any(String),
        }),
      }),
    })
  })

  it('returns a typed conflict when optimistic draft revision is stale', async () => {
    const { service } = makeHarness({
      formRepo: { updateDraftIfRevision: vi.fn(async () => null) },
    })
    await expect(
      service.updateDraft('00000000-0000-7000-8000-000000000001', {
        pageId: '00000000-0000-7000-8000-000000000050',
        formId: '00000000-0000-7000-8000-000000000010',
        expectedRevision: 1,
        schema: linearDocument(),
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT', message: 'FORM_DRAFT_CONFLICT' })
  })

  it('audits a branding setting change without storing the draft schema or labels', async () => {
    const { service, auditCreate } = makeHarness()
    const branded = linearDocument({
      presentation: { ...linearDocument().presentation, hideAnyNoteBranding: true },
    })
    await service.updateDraft('00000000-0000-7000-8000-000000000001', {
      pageId: '00000000-0000-7000-8000-000000000050',
      formId: '00000000-0000-7000-8000-000000000010',
      expectedRevision: 1,
      schema: branded,
    })
    const payload = auditCreate.mock.calls.at(-1)?.[0]
    expect(payload).toEqual({
      data: {
        workspaceId: '00000000-0000-7000-8000-000000000040',
        actorId: '00000000-0000-7000-8000-000000000001',
        action: 'database_form.settings_changed',
        metadata: {
          formId: '00000000-0000-7000-8000-000000000010',
          viewId: '00000000-0000-7000-8000-000000000030',
          changedSettings: ['hideAnyNoteBranding'],
        },
      },
    })
    expect(JSON.stringify(payload)).not.toContain('Contact')
    expect(JSON.stringify(payload)).not.toContain('question-1')
  })

  it('publishes version 1 inside the source lock transaction and opens a draft form', async () => {
    const { service, formRepo, databaseRepo, auditCreate } = makeHarness()
    const result = await service.publish('00000000-0000-7000-8000-000000000001', {
      pageId: '00000000-0000-7000-8000-000000000050',
      formId: '00000000-0000-7000-8000-000000000010',
    })

    expect(databaseRepo.lockSourceForStructureMutation).toHaveBeenCalledWith(
      '00000000-0000-7000-8000-000000000020',
      NOW,
    )
    expect(formRepo.findManagedForm).toHaveBeenCalledTimes(2)
    expect(formRepo.publishVersion).toHaveBeenCalledWith(
      expect.objectContaining({
        versionNumber: 1,
        state: 'OPEN',
        previousPublishedVersionId: null,
        schemaHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    )
    expect(result).toMatchObject({ state: 'OPEN', versionNumber: 1 })
    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'database_form.published',
        metadata: { formId: expect.any(String), viewId: expect.any(String), versionNumber: 1 },
      }),
    })
  })

  it('republishes as version 2, preserves CLOSED and grants the prior version exactly 24h grace', async () => {
    const prior = {
      id: '00000000-0000-7000-8000-000000000060',
      formId: '00000000-0000-7000-8000-000000000010',
      versionNumber: 1,
      schemaVersion: 1,
      schema: linearDocument(),
      schemaHash: 'a'.repeat(64),
      publishedById: '00000000-0000-7000-8000-000000000001',
      publishedAt: new Date('2026-07-15T00:00:00.000Z'),
      acceptUntil: null,
    }
    const { service, formRepo } = makeHarness({
      form: managedForm({
        state: 'CLOSED',
        publishedVersionId: prior.id,
        publishedVersion: prior,
      }),
    })
    await service.publish('00000000-0000-7000-8000-000000000001', {
      pageId: '00000000-0000-7000-8000-000000000050',
      formId: '00000000-0000-7000-8000-000000000010',
    })
    expect(formRepo.publishVersion).toHaveBeenCalledWith(
      expect.objectContaining({
        versionNumber: 2,
        state: 'CLOSED',
        previousPublishedVersionId: prior.id,
        previousAcceptUntil: new Date('2026-07-17T00:00:00.000Z'),
      }),
    )
  })

  it('creates no version when graph, property, audience, or plan validation fails', async () => {
    const invalidGraph = linearDocument({
      transitions: [
        {
          ...linearDocument().transitions[0]!,
          target: { kind: 'ENDING', endingId: 'missing-ending' },
        },
      ],
    })
    const graphHarness = makeHarness({ form: managedForm({ draftSchema: invalidGraph }) })
    await expect(
      graphHarness.service.publish('00000000-0000-7000-8000-000000000001', {
        pageId: '00000000-0000-7000-8000-000000000050',
        formId: '00000000-0000-7000-8000-000000000010',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'FORM_GRAPH_INVALID' })
    expect(graphHarness.formRepo.publishVersion).not.toHaveBeenCalled()

    const driftHarness = makeHarness({
      form: managedForm({
        source: { ...managedForm().source, properties: [] },
      }),
    })
    await expect(
      driftHarness.service.publish('00000000-0000-7000-8000-000000000001', {
        pageId: '00000000-0000-7000-8000-000000000050',
        formId: '00000000-0000-7000-8000-000000000010',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'FORM_PROPERTY_INVALID' })
    expect(driftHarness.formRepo.publishVersion).not.toHaveBeenCalled()

    const internalQuestion = linearDocument({
      questions: [
        {
          id: 'question-1',
          sectionId: 'section-1',
          property: { kind: 'PROPERTY', propertyId: 'property-1', propertyType: 'PERSON' },
          label: 'Owner',
          required: false,
          syncWithPropertyName: false,
          input: { kind: 'PERSON', maxSelections: 1 },
        },
      ],
    })
    const audienceHarness = makeHarness({
      form: managedForm({
        draftSchema: internalQuestion,
        source: {
          ...managedForm().source,
          properties: [
            { id: 'property-1', type: 'PERSON', name: 'Owner', position: 1, settings: null },
          ],
        },
      }),
    })
    await expect(
      audienceHarness.service.publish('00000000-0000-7000-8000-000000000001', {
        pageId: '00000000-0000-7000-8000-000000000050',
        formId: '00000000-0000-7000-8000-000000000010',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'FORM_AUDIENCE_INCOMPATIBLE' })
    expect(audienceHarness.formRepo.publishVersion).not.toHaveBeenCalled()

    const branded = linearDocument({
      presentation: {
        ...linearDocument().presentation,
        hideAnyNoteBranding: true,
      },
    })
    const planHarness = makeHarness({
      form: managedForm({ draftSchema: branded }),
      features: planFeatures({ formBrandingRemovalEnabled: false }),
    })
    await expect(
      planHarness.service.publish('00000000-0000-7000-8000-000000000001', {
        pageId: '00000000-0000-7000-8000-000000000050',
        formId: '00000000-0000-7000-8000-000000000010',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', message: 'PLAN_UPGRADE_REQUIRED' })
    expect(planHarness.formRepo.publishVersion).not.toHaveBeenCalled()
  })

  it('normalizes slugs, rejects reserved routes, and increments linkRevision only on change', async () => {
    const { service, formRepo } = makeHarness()
    await service.setSlug('00000000-0000-7000-8000-000000000001', {
      pageId: '00000000-0000-7000-8000-000000000050',
      formId: '00000000-0000-7000-8000-000000000010',
      slug: '  My-Form  ',
    })
    expect(formRepo.updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({ customSlug: 'my-form', linkRevision: 2 }),
    )

    await expect(
      service.setSlug('00000000-0000-7000-8000-000000000001', {
        pageId: '00000000-0000-7000-8000-000000000050',
        formId: '00000000-0000-7000-8000-000000000010',
        slug: 'settings',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'FORM_SLUG_RESERVED' })

    for (const slug of ['api-v2', 'forms-public']) {
      await expect(
        service.setSlug('00000000-0000-7000-8000-000000000001', {
          pageId: '00000000-0000-7000-8000-000000000050',
          formId: '00000000-0000-7000-8000-000000000010',
          slug,
        }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'FORM_SLUG_RESERVED' })
    }

    await expect(
      service.setSlug('00000000-0000-7000-8000-000000000001', {
        pageId: '00000000-0000-7000-8000-000000000050',
        formId: '00000000-0000-7000-8000-000000000010',
        slug: 'appetite',
      }),
    ).resolves.toBeDefined()
  })

  it('maps global slug uniqueness failures to a stable conflict', async () => {
    const taken = Object.assign(new Error('unique'), { code: 'P2002' })
    const { service } = makeHarness({
      formRepo: { updateSettings: vi.fn(async () => Promise.reject(taken)) },
    })
    await expect(
      service.setSlug('00000000-0000-7000-8000-000000000001', {
        pageId: '00000000-0000-7000-8000-000000000050',
        formId: '00000000-0000-7000-8000-000000000010',
        slug: 'already-taken',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT', message: 'FORM_SLUG_TAKEN' })
  })

  it('gates a newly configured custom slug after a soft downgrade', async () => {
    const { service, formRepo } = makeHarness({
      features: planFeatures({ formCustomSlugEnabled: false }),
    })
    await expect(
      service.setSlug('00000000-0000-7000-8000-000000000001', {
        pageId: '00000000-0000-7000-8000-000000000050',
        formId: '00000000-0000-7000-8000-000000000010',
        slug: 'new-slug',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', message: 'PLAN_UPGRADE_REQUIRED' })
    expect(formRepo.updateSettings).not.toHaveBeenCalled()
  })

  it('gates conditional publication after downgrade and creates no version', async () => {
    const base = linearDocument()
    const conditional = linearDocument({
      sections: [
        { id: 'section-1', title: 'Questions', questionIds: ['question-1', 'question-2'] },
      ],
      questions: [
        base.questions[0]!,
        {
          id: 'question-2',
          sectionId: 'section-1',
          property: { kind: 'TITLE' },
          label: 'Details',
          required: false,
          syncWithPropertyName: false,
          visibleWhen: {
            kind: 'ALL',
            members: [{ kind: 'TEXT_EQUALS', questionId: 'question-1', value: 'yes' }],
          },
          input: { kind: 'TEXT', multiline: false, maxLength: 200 },
        },
      ],
    })
    const { service, formRepo } = makeHarness({
      form: managedForm({ draftSchema: conditional }),
      features: planFeatures({ formConditionalLogicEnabled: false }),
    })
    await expect(
      service.publish('00000000-0000-7000-8000-000000000001', {
        pageId: '00000000-0000-7000-8000-000000000050',
        formId: '00000000-0000-7000-8000-000000000010',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', message: 'PLAN_UPGRADE_REQUIRED' })
    expect(formRepo.publishVersion).not.toHaveBeenCalled()
  })

  it('rotates only the generated key, increments linkRevision, and never audits the key value', async () => {
    const { service, formRepo, auditCreate } = makeHarness()
    await service.rotateKey('00000000-0000-7000-8000-000000000001', {
      pageId: '00000000-0000-7000-8000-000000000050',
      formId: '00000000-0000-7000-8000-000000000010',
    })
    expect(formRepo.updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({ routeKey: expect.stringMatching(/^anf_/), linkRevision: 2 }),
    )
    const auditPayload = auditCreate.mock.calls.at(-1)?.[0]
    expect(auditPayload).toMatchObject({
      data: {
        action: 'database_form.key_rotated',
        metadata: expect.objectContaining({ changedSettings: ['routeKey'] }),
      },
    })
    expect(JSON.stringify(auditPayload)).not.toContain('anf_')
  })

  it('closes and reopens only published forms with distinct audit actions', async () => {
    const open = managedForm({
      state: 'OPEN',
      publishedVersionId: '00000000-0000-7000-8000-000000000060',
    })
    const closeHarness = makeHarness({ form: open })
    await closeHarness.service.close('00000000-0000-7000-8000-000000000001', {
      pageId: '00000000-0000-7000-8000-000000000050',
      formId: '00000000-0000-7000-8000-000000000010',
    })
    expect(closeHarness.formRepo.updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'CLOSED' }),
    )
    expect(closeHarness.auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'database_form.closed' }),
    })

    const closed = managedForm({
      state: 'CLOSED',
      publishedVersionId: '00000000-0000-7000-8000-000000000060',
    })
    const reopenHarness = makeHarness({ form: closed })
    await reopenHarness.service.reopen('00000000-0000-7000-8000-000000000001', {
      pageId: '00000000-0000-7000-8000-000000000050',
      formId: '00000000-0000-7000-8000-000000000010',
    })
    expect(reopenHarness.formRepo.updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'OPEN' }),
    )
    expect(reopenHarness.auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'database_form.opened' }),
    })
  })

  it('forces respondent access NONE for public forms and validates the schedule', async () => {
    const { service, formRepo } = makeHarness()
    await service.updateSettings('00000000-0000-7000-8000-000000000001', {
      pageId: '00000000-0000-7000-8000-000000000050',
      formId: '00000000-0000-7000-8000-000000000010',
      audience: 'ANYONE_WITH_LINK',
      respondentAccess: 'EDIT',
      opensAt: null,
      closesAt: null,
      responseLimit: 10,
      notifyOwners: true,
    })
    expect(formRepo.updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({ audience: 'ANYONE_WITH_LINK', respondentAccess: 'NONE' }),
    )

    await expect(
      service.updateSettings('00000000-0000-7000-8000-000000000001', {
        pageId: '00000000-0000-7000-8000-000000000050',
        formId: '00000000-0000-7000-8000-000000000010',
        audience: 'SIGNED_IN_WITH_LINK',
        respondentAccess: 'VIEW',
        opensAt: new Date('2026-07-18T00:00:00.000Z'),
        closesAt: new Date('2026-07-17T00:00:00.000Z'),
        responseLimit: null,
        notifyOwners: true,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'FORM_SCHEDULE_INVALID' })
  })

  it('rejects changing a published internal-picker form to a non-workspace audience under the source lock', async () => {
    const internal = linearDocument({
      questions: [
        {
          id: 'question-1',
          sectionId: 'section-1',
          property: { kind: 'PROPERTY', propertyId: 'property-1', propertyType: 'PERSON' },
          label: 'Owner',
          required: false,
          syncWithPropertyName: false,
          input: { kind: 'PERSON', maxSelections: 1 },
        },
      ],
    })
    const publishedVersion = {
      id: '00000000-0000-7000-8000-000000000060',
      formId: '00000000-0000-7000-8000-000000000010',
      versionNumber: 1,
      schemaVersion: 1,
      schema: internal,
      schemaHash: 'a'.repeat(64),
      publishedById: '00000000-0000-7000-8000-000000000001',
      publishedAt: NOW,
      acceptUntil: null,
    }
    const { service, formRepo, databaseRepo } = makeHarness({
      form: managedForm({
        state: 'OPEN',
        audience: 'WORKSPACE_MEMBERS_WITH_LINK',
        publishedVersionId: publishedVersion.id,
        publishedVersion,
        source: {
          ...managedForm().source,
          properties: [
            { id: 'property-1', type: 'PERSON', name: 'Owner', position: 1, settings: null },
          ],
        },
      }),
    })

    for (const audience of ['SIGNED_IN_WITH_LINK', 'ANYONE_WITH_LINK'] as const) {
      await expect(
        service.updateSettings('00000000-0000-7000-8000-000000000001', {
          pageId: '00000000-0000-7000-8000-000000000050',
          formId: '00000000-0000-7000-8000-000000000010',
          audience,
          respondentAccess: 'NONE',
          opensAt: null,
          closesAt: null,
          responseLimit: null,
          notifyOwners: true,
        }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'FORM_AUDIENCE_INCOMPATIBLE' })
    }
    expect(databaseRepo.lockSourceForStructureMutation).toHaveBeenCalled()
    expect(formRepo.updateSettings).not.toHaveBeenCalled()
  })

  it('checks every active grace version even when the current and newest grace versions are public-safe', async () => {
    const safeCurrent = {
      id: '00000000-0000-7000-8000-000000000063',
      formId: '00000000-0000-7000-8000-000000000010',
      versionNumber: 3,
      schemaVersion: 1,
      schema: linearDocument(),
      schemaHash: 'c'.repeat(64),
      publishedById: '00000000-0000-7000-8000-000000000001',
      publishedAt: NOW,
      acceptUntil: null,
    }
    const safeGrace = {
      ...safeCurrent,
      id: '00000000-0000-7000-8000-000000000062',
      versionNumber: 2,
      schemaHash: 'b'.repeat(64),
      acceptUntil: new Date('2026-07-17T00:00:00.000Z'),
    }
    const internalGraceDocument = linearDocument({
      questions: [
        {
          id: 'question-1',
          sectionId: 'section-1',
          property: { kind: 'PROPERTY', propertyId: 'property-2', propertyType: 'PERSON' },
          label: 'Owner',
          required: false,
          syncWithPropertyName: false,
          input: { kind: 'PERSON', maxSelections: 1 },
        },
      ],
    })
    const internalGrace = {
      ...safeCurrent,
      id: '00000000-0000-7000-8000-000000000061',
      versionNumber: 1,
      schema: internalGraceDocument,
      schemaHash: 'a'.repeat(64),
      acceptUntil: new Date('2026-07-17T00:00:00.000Z'),
    }
    const form = managedForm({
      state: 'OPEN',
      audience: 'WORKSPACE_MEMBERS_WITH_LINK',
      publishedVersionId: safeCurrent.id,
      publishedVersion: safeCurrent,
    })
    const { service, formRepo } = makeHarness({
      form,
      formRepo: {
        listVersions: vi.fn(async () => [safeCurrent, safeGrace, internalGrace]),
      },
    })

    for (const audience of ['ANYONE_WITH_LINK', 'SIGNED_IN_WITH_LINK'] as const) {
      await expect(
        service.updateSettings('00000000-0000-7000-8000-000000000001', {
          pageId: form.source.pageId,
          formId: form.id,
          audience,
          respondentAccess: 'NONE',
          opensAt: null,
          closesAt: null,
          responseLimit: null,
          notifyOwners: true,
        }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'FORM_AUDIENCE_INCOMPATIBLE' })
    }
    expect(formRepo.listVersions).toHaveBeenCalledWith(form.id, NOW)
    expect(formRepo.updateSettings).not.toHaveBeenCalled()
  })

  it('allows a public audience when current and all active grace schemas are public-safe', async () => {
    const current = {
      id: '00000000-0000-7000-8000-000000000063',
      formId: '00000000-0000-7000-8000-000000000010',
      versionNumber: 3,
      schemaVersion: 1,
      schema: linearDocument(),
      schemaHash: 'c'.repeat(64),
      publishedById: '00000000-0000-7000-8000-000000000001',
      publishedAt: NOW,
      acceptUntil: null,
    }
    const newestGrace = {
      ...current,
      id: '00000000-0000-7000-8000-000000000062',
      versionNumber: 2,
      schemaHash: 'b'.repeat(64),
      acceptUntil: new Date('2026-07-17T00:00:00.000Z'),
    }
    const oldestGrace = {
      ...current,
      id: '00000000-0000-7000-8000-000000000061',
      versionNumber: 1,
      schemaHash: 'a'.repeat(64),
      acceptUntil: new Date('2026-07-17T00:00:00.000Z'),
    }
    const form = managedForm({
      state: 'OPEN',
      audience: 'WORKSPACE_MEMBERS_WITH_LINK',
      publishedVersionId: current.id,
      publishedVersion: current,
    })
    const { service, formRepo } = makeHarness({
      form,
      formRepo: {
        listVersions: vi.fn(async () => [current, newestGrace, oldestGrace]),
      },
    })

    await service.updateSettings('00000000-0000-7000-8000-000000000001', {
      pageId: form.source.pageId,
      formId: form.id,
      audience: 'ANYONE_WITH_LINK',
      respondentAccess: 'NONE',
      opensAt: null,
      closesAt: null,
      responseLimit: null,
      notifyOwners: true,
    })
    expect(formRepo.listVersions).toHaveBeenCalledWith(form.id, NOW)
    expect(formRepo.updateSettings).toHaveBeenCalled()
  })

  it('fails closed when any active grace version schema is malformed', async () => {
    const current = {
      id: '00000000-0000-7000-8000-000000000063',
      formId: '00000000-0000-7000-8000-000000000010',
      versionNumber: 3,
      schemaVersion: 1,
      schema: linearDocument(),
      schemaHash: 'c'.repeat(64),
      publishedById: '00000000-0000-7000-8000-000000000001',
      publishedAt: NOW,
      acceptUntil: null,
    }
    const safeGrace = {
      ...current,
      id: '00000000-0000-7000-8000-000000000062',
      versionNumber: 2,
      schemaHash: 'b'.repeat(64),
      acceptUntil: new Date('2026-07-17T00:00:00.000Z'),
    }
    const malformedGrace = {
      ...current,
      id: '00000000-0000-7000-8000-000000000061',
      versionNumber: 1,
      schema: { malformed: true },
      schemaHash: 'a'.repeat(64),
      acceptUntil: new Date('2026-07-17T00:00:00.000Z'),
    }
    const form = managedForm({
      state: 'OPEN',
      audience: 'WORKSPACE_MEMBERS_WITH_LINK',
      publishedVersionId: current.id,
      publishedVersion: current,
    })
    const { service, formRepo } = makeHarness({
      form,
      formRepo: {
        listVersions: vi.fn(async () => [current, safeGrace, malformedGrace]),
      },
    })

    await expect(
      service.updateSettings('00000000-0000-7000-8000-000000000001', {
        pageId: form.source.pageId,
        formId: form.id,
        audience: 'ANYONE_WITH_LINK',
        respondentAccess: 'NONE',
        opensAt: null,
        closesAt: null,
        responseLimit: null,
        notifyOwners: true,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'FORM_SCHEMA_INVALID' })
    expect(formRepo.listVersions).toHaveBeenCalledWith(form.id, NOW)
    expect(formRepo.updateSettings).not.toHaveBeenCalled()
  })

  it('duplicates by FORM view as a fresh audited draft without publication, slug, or accepted count', async () => {
    const { service, formRepo, auditCreate, transaction } = makeHarness({
      form: managedForm({
        state: 'OPEN',
        customSlug: 'contact',
        acceptedResponses: 9,
      }),
    })
    await service.duplicateByView('00000000-0000-7000-8000-000000000001', {
      pageId: '00000000-0000-7000-8000-000000000050',
      viewId: '00000000-0000-7000-8000-000000000030',
    })
    expect(formRepo.duplicateForm).toHaveBeenCalledWith(
      expect.objectContaining({
        routeKey: expect.stringMatching(/^anf_/),
        draftSchema: linearDocument(),
      }),
    )
    const duplicateInput = vi.mocked(formRepo.duplicateForm).mock.calls[0]![0]
    expect(duplicateInput).not.toHaveProperty('customSlug')
    expect(duplicateInput).not.toHaveProperty('acceptedResponses')
    expect(transaction).toHaveBeenCalledOnce()
    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'database_form.created',
        metadata: expect.objectContaining({ formId: 'duplicate', viewId: expect.any(String) }),
      }),
    })
  })

  it('renames a FORM view through the lifecycle lock with metadata-only audit', async () => {
    const { service, databaseRepo, auditCreate, transaction } = makeHarness()
    await service.renameByView('00000000-0000-7000-8000-000000000001', {
      pageId: '00000000-0000-7000-8000-000000000050',
      viewId: '00000000-0000-7000-8000-000000000030',
      title: 'Customer intake',
    })
    expect(databaseRepo.lockSourceForStructureMutation).toHaveBeenCalled()
    expect(transaction).toHaveBeenCalledOnce()
    expect(databaseRepo.updateView).toHaveBeenCalledWith('00000000-0000-7000-8000-000000000030', {
      title: 'Customer intake',
    })
    const audit = auditCreate.mock.calls.at(-1)?.[0]
    expect(audit).toEqual({
      data: {
        workspaceId: '00000000-0000-7000-8000-000000000040',
        actorId: '00000000-0000-7000-8000-000000000001',
        action: 'database_form.settings_changed',
        metadata: {
          formId: '00000000-0000-7000-8000-000000000010',
          viewId: '00000000-0000-7000-8000-000000000030',
          changedSettings: ['viewTitle'],
        },
      },
    })
    expect(JSON.stringify(audit)).not.toContain('Customer intake')
  })

  it('archives through one transaction and preserves submission rows by using the focused repository operation', async () => {
    const { service, formRepo, databaseRepo, transaction } = makeHarness()
    await service.archive('00000000-0000-7000-8000-000000000001', {
      pageId: '00000000-0000-7000-8000-000000000050',
      formId: '00000000-0000-7000-8000-000000000010',
    })
    expect(transaction).toHaveBeenCalledOnce()
    expect(databaseRepo.lockSourceForStructureMutation).toHaveBeenCalled()
    expect(formRepo.archiveForm).toHaveBeenCalledWith({
      formId: '00000000-0000-7000-8000-000000000010',
    })
  })
})

describe('form publication primitives', () => {
  it('generates 32-byte base64url route keys', () => {
    expect(newFormRouteKey()).toMatch(/^anf_[A-Za-z0-9_-]{43}$/)
  })

  it('hashes canonical JSON independently of object insertion order', () => {
    expect(canonicalFormSchemaHash({ a: 1, b: { c: 2, d: 3 } })).toBe(
      canonicalFormSchemaHash({ b: { d: 3, c: 2 }, a: 1 }),
    )
  })
})
