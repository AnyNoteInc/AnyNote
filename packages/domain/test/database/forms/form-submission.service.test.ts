import { createHash } from 'node:crypto'

import { describe, expect, expectTypeOf, it, vi } from 'vitest'

import { DatabaseRepository } from '../../../src/database/repositories/database.repository.ts'
import {
  DatabaseFormRepository,
  type FormRepositoryContract,
  type FormVersionRecord,
  type FormSubmissionRecord,
  type PublicFormRecord,
} from '../../../src/database/forms/database-form.repository.ts'
import { FormAccessResolver } from '../../../src/database/forms/form-access-resolver.ts'
import type {
  FormQuestion,
  FormVersionDocument,
} from '../../../src/database/forms/form-document.ts'
import {
  automaticResponseTitle,
  FormSubmissionService,
  type FormSubmissionInput,
  type FormSubmissionTokenContext,
} from '../../../src/database/forms/form-submission.service.ts'
import { PageRepository } from '../../../src/pages/repositories/pages.repository.ts'
import type { ItemPageCreator } from '../../../src/shared/item-page-creator.ts'
import type { UnitOfWork } from '../../../src/shared/unit-of-work.ts'
import { forbidden } from '../../../src/shared/errors.ts'

const NOW = new Date('2026-07-16T08:00:00.000Z')
const FORM_ID = '00000000-0000-7000-8000-000000000001'
const VERSION_ID = '00000000-0000-7000-8000-000000000002'
const SOURCE_ID = '00000000-0000-7000-8000-000000000003'
const SOURCE_PAGE_ID = '00000000-0000-7000-8000-000000000004'
const WORKSPACE_ID = '00000000-0000-7000-8000-000000000005'
const ACTOR_ID = '00000000-0000-7000-8000-000000000006'
const ITEM_PAGE_ID = '00000000-0000-7000-8000-000000000007'
const ROW_ID = '00000000-0000-7000-8000-000000000008'
const SUBMISSION_ID = '00000000-0000-7000-8000-000000000009'
const IDEMPOTENCY_KEY = '00000000-0000-7000-8000-000000000010'
const PROPERTY_ID = '00000000-0000-7000-8000-000000000011'
const SECOND_PROPERTY_ID = '00000000-0000-7000-8000-000000000012'
const THIRD_PROPERTY_ID = '00000000-0000-7000-8000-000000000013'
const OWNER_ID = '00000000-0000-7000-8000-000000000014'
const TARGET_SOURCE_ID = '00000000-0000-7000-8000-000000000021'
const TARGET_SOURCE_PAGE_ID = '00000000-0000-7000-8000-000000000022'
const TARGET_ROW_ID = '00000000-0000-7000-8000-000000000023'
const TARGET_PAGE_ID = '00000000-0000-7000-8000-000000000024'
const UPLOAD_ID = '00000000-0000-7000-8000-000000000025'
const FILE_ID = '00000000-0000-7000-8000-000000000026'
const LOCATOR_HASH = createHash('sha256').update('anf_public').digest('hex')

const submission = (overrides: Partial<FormSubmissionRecord> = {}): FormSubmissionRecord => ({
  id: SUBMISSION_ID,
  formId: FORM_ID,
  versionId: VERSION_ID,
  rowId: ROW_ID,
  respondentUserId: ACTOR_ID,
  endingId: 'server-ending',
  idempotencyKey: IDEMPOTENCY_KEY,
  submittedAt: NOW,
  row: { pageId: ITEM_PAGE_ID },
  ...overrides,
})

const uploadLease = (overrides: Record<string, unknown> = {}) => ({
  id: UPLOAD_ID,
  formId: FORM_ID,
  versionId: VERSION_ID,
  questionId: 'files',
  fileId: FILE_ID,
  uploadTokenHash: createHash('sha256').update('lease-token-secret').digest('hex'),
  expiresAt: new Date('2026-07-17T08:00:00.000Z'),
  consumedAt: null,
  file: {
    workspaceId: WORKSPACE_ID,
    status: 'PENDING',
    mimeType: 'text/plain',
    fileSize: 512n,
  },
  ...overrides,
})

const titleQuestion = (overrides: Partial<FormQuestion> = {}): FormQuestion =>
  ({
    id: 'title',
    sectionId: 'main',
    property: { kind: 'TITLE' },
    label: 'Название',
    required: false,
    syncWithPropertyName: false,
    input: { kind: 'TEXT', multiline: false, maxLength: 200 },
    ...overrides,
  }) as FormQuestion

const propertyQuestion = (
  id: string,
  propertyId: string,
  propertyType: Exclude<FormQuestion['property'], { kind: 'TITLE' }>['propertyType'],
  input: FormQuestion['input'],
  overrides: Partial<FormQuestion> = {},
): FormQuestion =>
  ({
    id,
    sectionId: 'main',
    property: { kind: 'PROPERTY', propertyId, propertyType },
    label: id,
    required: false,
    syncWithPropertyName: false,
    input,
    ...overrides,
  }) as FormQuestion

const textQuestion = (
  id = 'text',
  propertyId = PROPERTY_ID,
  overrides: Partial<FormQuestion> = {},
): FormQuestion =>
  propertyQuestion(
    id,
    propertyId,
    'TEXT',
    { kind: 'TEXT', multiline: true, maxLength: 2_000 },
    overrides,
  )

function formDocument(
  questions: FormQuestion[] = [titleQuestion(), textQuestion()],
  overrides: Partial<FormVersionDocument> = {},
): FormVersionDocument {
  return {
    schemaVersion: 1,
    firstSectionId: 'main',
    presentation: {
      title: 'Форма',
      submitButtonText: 'Отправить',
      hideAnyNoteBranding: false,
    },
    sections: [{ id: 'main', title: 'Основное', questionIds: questions.map(({ id }) => id) }],
    questions,
    transitions: [
      {
        id: 'finish',
        fromSectionId: 'main',
        priority: 0,
        when: null,
        target: { kind: 'ENDING', endingId: 'done' },
      },
    ],
    endings: [{ id: 'done', title: 'Готово' }],
    ...overrides,
  }
}

function formVersion(
  schema: FormVersionDocument = formDocument(),
  overrides: Partial<FormVersionRecord> = {},
): FormVersionRecord {
  return {
    id: VERSION_ID,
    formId: FORM_ID,
    versionNumber: 3,
    schemaVersion: 1,
    schema,
    schemaHash: 'a'.repeat(64),
    publishedById: OWNER_ID,
    publishedAt: new Date('2026-07-16T07:00:00.000Z'),
    acceptUntil: null,
    ...overrides,
  } as FormVersionRecord
}

function publicForm(
  schema: FormVersionDocument = formDocument(),
  overrides: Partial<PublicFormRecord> = {},
): PublicFormRecord {
  const current = formVersion(schema)
  return {
    id: FORM_ID,
    sourceId: SOURCE_ID,
    routeKey: 'anf_public',
    customSlug: 'feedback',
    linkRevision: 4,
    state: 'OPEN',
    audience: 'ANYONE_WITH_LINK',
    respondentAccess: 'NONE',
    publishedVersionId: current.id,
    opensAt: null,
    closesAt: null,
    responseLimit: null,
    acceptedResponses: 0,
    createdById: OWNER_ID,
    source: {
      workspaceId: WORKSPACE_ID,
      pageId: SOURCE_PAGE_ID,
      page: { archivedAt: null, deletedAt: null },
      workspace: {
        id: WORKSPACE_ID,
        securityPolicy: { disablePublicLinksSitesForms: false },
      },
    },
    publishedVersion: current,
    ...overrides,
  }
}

const tokenContext = (
  overrides: Partial<FormSubmissionTokenContext> = {},
): FormSubmissionTokenContext => ({
  locatorHash: LOCATOR_HASH,
  versionNumber: 3,
  schemaHash: 'a'.repeat(64),
  linkRevision: 4,
  ...overrides,
})

const submissionInput = (answers: Record<string, unknown>): FormSubmissionInput => ({
  locator: 'anf_public',
  idempotencyKey: IDEMPOTENCY_KEY,
  answers,
})

function makeValidationHarness(
  options: {
    storedForm?: PublicFormRecord | null
    requestedVersion?: FormVersionRecord | null
    transactionForm?: PublicFormRecord | null
    transactionVersion?: FormVersionRecord | null
    rejectTransactionMembership?: boolean
    onTransactionStart?: () => void
    now?: () => Date
    properties?: Awaited<ReturnType<DatabaseRepository['listProperties']>>
    formRepo?: Partial<FormRepositoryContract>
    databaseRepo?: Partial<DatabaseRepository>
    pageRepo?: Partial<ItemPageCreator>
  } = {},
) {
  const storedForm = options.storedForm === undefined ? publicForm() : options.storedForm
  const requestedVersion =
    options.requestedVersion === undefined
      ? (storedForm?.publishedVersion ?? null)
      : options.requestedVersion
  let transactionDepth = 0
  const uow = {
    transaction: vi.fn(async (run: () => Promise<unknown>) => {
      transactionDepth += 1
      try {
        options.onTransactionStart?.()
        return await run()
      } finally {
        transactionDepth -= 1
      }
    }),
    client: vi.fn() as unknown as UnitOfWork['client'],
  } satisfies UnitOfWork
  const assertInTransaction = () => expect(transactionDepth).toBeGreaterThan(0)
  let transactionStarted = false
  const formRepo = {
    findByLocator: vi.fn(async () =>
      transactionStarted && options.transactionForm !== undefined
        ? options.transactionForm
        : storedForm,
    ),
    findVersion: vi.fn(async () =>
      transactionStarted && options.transactionVersion !== undefined
        ? options.transactionVersion
        : requestedVersion,
    ),
    lockSubmissionContext: vi.fn(async () => {
      transactionStarted = true
      return true
    }),
    findSubmissionByIdempotency: vi.fn(async () => null),
    reserveResponseSlot: vi.fn(async () => {
      assertInTransaction()
      return true
    }),
    createSubmission: vi.fn(
      async (value: { respondentUserId: string | null; endingId: string }) => {
        assertInTransaction()
        return submission({
          respondentUserId: value.respondentUserId,
          endingId: value.endingId,
        })
      },
    ),
    enqueueFormSubmittedEvent: vi.fn(async () => assertInTransaction()),
    resolveUploadLeases: vi.fn(async () => []),
    resolveUploadLeasesBatch: vi.fn(async (input) => {
      const resolver = options.formRepo?.resolveUploadLeases
      if (resolver === undefined) return []
      const binding = input.bindings[0]
      if (binding === undefined) return []
      return resolver({
        formId: input.formId,
        versionId: input.versionId,
        questionId: binding.questionId,
        tokenHashes: binding.tokenHashes,
        now: input.now,
      })
    }),
    lockFormSubmissionAuthorities: vi.fn(async () => true),
    consumeUploadLeases: vi.fn(async () => assertInTransaction()),
    ...options.formRepo,
  } as unknown as FormRepositoryContract
  const workspace = {
    assertMembership: vi.fn(async (userId: string, workspaceId: string) => {
      if (transactionStarted && options.rejectTransactionMembership) {
        throw forbidden('MEMBERSHIP_REVOKED')
      }
      return { userId, workspaceId, role: 'VIEWER' as const }
    }),
  }
  const now = options.now ?? (() => NOW)
  const formAccess = new FormAccessResolver(formRepo, workspace, now)
  const databaseRepo = {
    listProperties: vi.fn(
      async () =>
        options.properties ?? [
          { id: PROPERTY_ID, type: 'TEXT', name: 'Текст', position: 1, settings: null },
        ],
    ),
    maxRowPosition: vi.fn(async () => 0),
    createRow: vi.fn(async () => {
      assertInTransaction()
      return { id: ROW_ID, pageId: ITEM_PAGE_ID, position: 1_024 }
    }),
    updatePageTitle: vi.fn(async () => assertInTransaction()),
    upsertCellValue: vi.fn(async () => assertInTransaction()),
    upsertFileCellValue: vi.fn(async () => assertInTransaction()),
    replaceRelationLinks: vi.fn(async () => assertInTransaction()),
    isWorkspaceMember: vi.fn(async () => true),
    findSourceMetaById: vi.fn(async (sourceId: string) => ({
      id: sourceId,
      workspaceId: WORKSPACE_ID,
      pageId: TARGET_SOURCE_PAGE_ID,
    })),
    findSourceMetasByIds: vi.fn(async (sourceIds: string[]) => {
      const resolver = options.databaseRepo?.findSourceMetaById
      const sources = await Promise.all(
        sourceIds.map(async (sourceId) =>
          resolver === undefined
            ? { id: sourceId, workspaceId: WORKSPACE_ID, pageId: TARGET_SOURCE_PAGE_ID }
            : resolver(sourceId),
        ),
      )
      return new Map(sources.flatMap((source) => (source === null ? [] : [[source.id, source]])))
    }),
    findActiveWorkspaceMemberIds: vi.fn(async (userIds: string[]) => {
      const resolver = options.databaseRepo?.isWorkspaceMember
      if (resolver === undefined) return new Set(userIds)
      const active = await Promise.all(
        userIds.map(async (userId) => ((await resolver(userId, WORKSPACE_ID)) ? userId : null)),
      )
      return new Set(active.filter((userId): userId is string => userId !== null))
    }),
    findRowsAccessMetaByIds: vi.fn(async (ids: string[]) =>
      ids.map((id) => ({
        id,
        sourceId: TARGET_SOURCE_ID,
        workspaceId: WORKSPACE_ID,
        pageId: TARGET_PAGE_ID,
        createdById: OWNER_ID,
        cellsByProperty: new Map<string, unknown>(),
      })),
    ),
    findEnabledAccessRulesForSources: vi.fn(async () => new Map()),
    findWorkspaceRole: vi.fn(async () => 'VIEWER'),
    isSourcePageCreatedBy: vi.fn(async () => false),
    findSourcePageIdsCreatedBy: vi.fn(async (pageIds: string[]) => {
      const resolver = options.databaseRepo?.isSourcePageCreatedBy
      if (resolver === undefined) return new Set<string>()
      const created = await Promise.all(
        pageIds.map(async (pageId) => ((await resolver(pageId, ACTOR_ID)) ? pageId : null)),
      )
      return new Set(created.filter((pageId): pageId is string => pageId !== null))
    }),
    findItemPageShareLevel: vi.fn(async () => null),
    findItemPageShareLevels: vi.fn(async () => new Map()),
    ...options.databaseRepo,
  } as unknown as DatabaseRepository
  const pageRepo = {
    createItemPageTx: vi.fn(async () => {
      assertInTransaction()
      return { id: ITEM_PAGE_ID }
    }),
    findAccessiblePageIds: vi.fn(
      async (_userId: string, _workspaceId: string, ids: string[]) => new Set(ids),
    ),
    findAccessiblePageLinkIds: vi.fn(
      async (_userId: string, _workspaceId: string, ids: string[]) => new Set(ids),
    ),
    ...options.pageRepo,
  } as ItemPageCreator
  const service = new FormSubmissionService(formRepo, databaseRepo, pageRepo, uow, formAccess, now)
  return { service, formRepo, databaseRepo, pageRepo, uow, workspace }
}

describe('FormSubmissionService server-authoritative scalar preparation', () => {
  it('exposes an early replay only after revalidating stored access and version context', async () => {
    const replay = submission({ respondentUserId: null })
    const { service, formRepo } = makeValidationHarness({
      formRepo: { findSubmissionByIdempotency: vi.fn(async () => replay) },
    })

    await expect(service.findReplay(null, submissionInput({}), tokenContext())).resolves.toEqual({
      submissionId: SUBMISSION_ID,
      endingId: 'server-ending',
      ownResponseUrl: null,
      created: false,
    })
    expect(formRepo.findSubmissionByIdempotency).toHaveBeenCalledWith(FORM_ID, IDEMPOTENCY_KEY)
  })

  it('never looks up an early replay when the signed form/version context is stale', async () => {
    const findSubmissionByIdempotency = vi.fn(async () => submission())
    const { service } = makeValidationHarness({
      formRepo: { findSubmissionByIdempotency },
    })

    await expect(
      service.findReplay(null, submissionInput({}), tokenContext({ linkRevision: 5 })),
    ).rejects.toMatchObject({ message: 'FORM_VERSION_STALE' })
    expect(findSubmissionByIdempotency).not.toHaveBeenCalled()
  })

  it.each([
    ['closed', { state: 'CLOSED' as const }],
    ['capped', { responseLimit: 1, acceptedResponses: 1 }],
    ['scheduled', { opensAt: new Date('2026-07-17T08:00:00.000Z') }],
  ])('replays a committed key after the form becomes %s', async (_label, formOverride) => {
    const replay = submission({ respondentUserId: null })
    const { service } = makeValidationHarness({
      storedForm: publicForm(formDocument(), formOverride),
      formRepo: { findSubmissionByIdempotency: vi.fn(async () => replay) },
    })

    await expect(service.findReplay(null, submissionInput({}), tokenContext())).resolves.toEqual({
      submissionId: SUBMISSION_ID,
      endingId: 'server-ending',
      ownResponseUrl: null,
      created: false,
    })
  })

  it.each([
    ['version', submission({ respondentUserId: null, versionId: OWNER_ID })],
    ['respondent', submission({ respondentUserId: ACTOR_ID })],
  ])('rejects a replay bound to another %s', async (_label, replay) => {
    const { service } = makeValidationHarness({
      formRepo: { findSubmissionByIdempotency: vi.fn(async () => replay) },
    })
    await expect(
      service.findReplay(null, submissionInput({}), tokenContext()),
    ).rejects.toMatchObject({ message: 'FORM_IDEMPOTENCY_CONFLICT' })
  })

  it('returns the same own-response URL for an authenticated creation and replay', async () => {
    let stored: FormSubmissionRecord | null = null
    const storedForm = publicForm(formDocument(), {
      audience: 'SIGNED_IN_WITH_LINK',
      respondentAccess: 'VIEW',
    })
    const { service } = makeValidationHarness({
      storedForm,
      formRepo: {
        findSubmissionByIdempotency: vi.fn(async () => stored),
        createSubmission: vi.fn(async (value) => {
          stored = submission({
            respondentUserId: value.respondentUserId,
            endingId: value.endingId,
          })
          return stored
        }),
      },
    })
    const created = await service.submit(ACTOR_ID, submissionInput({}), tokenContext())
    const replay = await service.submit(ACTOR_ID, submissionInput({}), tokenContext())

    expect(created.ownResponseUrl).toBe(`/f/anf_public/responses/${SUBMISSION_ID}`)
    expect(replay).toEqual({ ...created, created: false })
  })

  it('keeps public input free of server-owned source, property, title, actor, and ending fields', () => {
    expectTypeOf<FormSubmissionInput>().toHaveProperty('locator')
    expectTypeOf<FormSubmissionInput>().toHaveProperty('idempotencyKey')
    expectTypeOf<FormSubmissionInput>().toHaveProperty('answers')
    expectTypeOf<FormSubmissionInput>().not.toHaveProperty('sourceId')
    expectTypeOf<FormSubmissionInput>().not.toHaveProperty('propertyId')
    expectTypeOf<FormSubmissionInput>().not.toHaveProperty('title')
    expectTypeOf<FormSubmissionInput>().not.toHaveProperty('actorUserId')
    expectTypeOf<FormSubmissionInput>().not.toHaveProperty('endingId')
  })

  it('preserves every safe Zod issue under its question id', async () => {
    const schema = formDocument([
      propertyQuestion('choice', PROPERTY_ID, 'MULTI_SELECT', {
        kind: 'MULTI_CHOICE',
        appearance: 'CHECKLIST',
        options: [{ id: 'valid', label: 'Valid' }],
        maxSelections: 1,
      }),
    ])
    const { service } = makeValidationHarness({
      storedForm: publicForm(schema),
      properties: [
        {
          id: PROPERTY_ID,
          type: 'MULTI_SELECT',
          name: 'Choice',
          position: 1,
          settings: { options: [{ id: 'valid', label: 'Valid' }] },
        },
      ],
    })

    await expect(
      service.submit(null, submissionInput({ choice: ['invalid', 'invalid'] }), tokenContext()),
    ).rejects.toMatchObject({
      message: 'FORM_ANSWERS_INVALID',
      fieldErrors: {
        choice: ['DUPLICATE_OPTION_ANSWER', 'INVALID_OPTION_ID', 'TOO_MANY_SELECTIONS'],
      },
    })
  })

  it.each(['constructor', 'prototype'])('maps the inherited-looking %s key safely', async (id) => {
    const schema = formDocument([
      textQuestion(id, PROPERTY_ID, { input: { kind: 'TEXT', multiline: false, maxLength: 1 } }),
    ])
    const { service } = makeValidationHarness({ storedForm: publicForm(schema) })

    await expect(
      service.submit(null, submissionInput({ [id]: 'too long' }), tokenContext()),
    ).rejects.toMatchObject({
      message: 'FORM_ANSWERS_INVALID',
      fieldErrors: { [id]: ['DANGEROUS_OBJECT_KEY'] },
    })
  })

  it('validates and writes every supported scalar value from stored question mappings', async () => {
    const questions = [
      titleQuestion(),
      textQuestion(),
      propertyQuestion('number', SECOND_PROPERTY_ID, 'NUMBER', { kind: 'NUMBER' }),
      propertyQuestion('select', THIRD_PROPERTY_ID, 'SELECT', {
        kind: 'SINGLE_CHOICE',
        appearance: 'DROPDOWN',
        options: [{ id: 'selected', label: 'Selected' }],
      }),
      propertyQuestion('multi', '00000000-0000-7000-8000-000000000015', 'MULTI_SELECT', {
        kind: 'MULTI_CHOICE',
        appearance: 'CHECKLIST',
        options: [
          { id: 'one', label: 'One' },
          { id: 'two', label: 'Two' },
        ],
        maxSelections: 2,
      }),
      propertyQuestion('checked', '00000000-0000-7000-8000-000000000016', 'CHECKBOX', {
        kind: 'CHECKBOX',
        consent: false,
      }),
      propertyQuestion('date', '00000000-0000-7000-8000-000000000017', 'DATE', {
        kind: 'DATE',
        includeTime: false,
      }),
      propertyQuestion('url', '00000000-0000-7000-8000-000000000018', 'URL', { kind: 'URL' }),
      propertyQuestion('email', '00000000-0000-7000-8000-000000000019', 'EMAIL', {
        kind: 'EMAIL',
      }),
      propertyQuestion('phone', '00000000-0000-7000-8000-000000000020', 'PHONE', {
        kind: 'PHONE',
      }),
    ]
    const storedForm = publicForm(formDocument(questions), { audience: 'SIGNED_IN_WITH_LINK' })
    const properties = questions.flatMap((question, index) =>
      question.property.kind === 'PROPERTY'
        ? [
            {
              id: question.property.propertyId,
              type: question.property.propertyType,
              name: question.label,
              position: index,
              settings:
                question.input.kind === 'SINGLE_CHOICE' || question.input.kind === 'MULTI_CHOICE'
                  ? { options: question.input.options }
                  : null,
            },
          ]
        : [],
    )
    const { service, databaseRepo, pageRepo, formRepo } = makeValidationHarness({
      storedForm,
      properties,
    })

    await service.submit(
      ACTOR_ID,
      submissionInput({
        title: 'Мой ответ',
        text: 'Подробности',
        number: 12.5,
        select: 'selected',
        multi: ['one', 'two'],
        checked: false,
        date: '2026-07-16',
        url: 'https://example.com/form',
        email: 'person@example.com',
        phone: '+30 210 123 4567',
      }),
      tokenContext(),
    )

    expect(pageRepo.createItemPageTx).toHaveBeenCalledWith(SOURCE_PAGE_ID, WORKSPACE_ID, ACTOR_ID)
    expect(databaseRepo.updatePageTitle).toHaveBeenCalledWith(ITEM_PAGE_ID, 'Мой ответ', ACTOR_ID)
    expect(databaseRepo.upsertCellValue.mock.calls).toEqual([
      [ROW_ID, PROPERTY_ID, 'Подробности'],
      [ROW_ID, SECOND_PROPERTY_ID, 12.5],
      [ROW_ID, THIRD_PROPERTY_ID, 'selected'],
      [ROW_ID, '00000000-0000-7000-8000-000000000015', ['one', 'two']],
      [ROW_ID, '00000000-0000-7000-8000-000000000016', false],
      [ROW_ID, '00000000-0000-7000-8000-000000000017', '2026-07-16'],
      [ROW_ID, '00000000-0000-7000-8000-000000000018', 'https://example.com/form'],
      [ROW_ID, '00000000-0000-7000-8000-000000000019', 'person@example.com'],
      [ROW_ID, '00000000-0000-7000-8000-000000000020', '+30 210 123 4567'],
    ])
    expect(formRepo.createSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ respondentUserId: ACTOR_ID, endingId: 'done' }),
    )
  })

  it.each([
    ['public audience ignores an existing session', 'ANYONE_WITH_LINK', ACTOR_ID, null],
    ['signed-in audience preserves its actor', 'SIGNED_IN_WITH_LINK', ACTOR_ID, ACTOR_ID],
    ['workspace audience preserves its member', 'WORKSPACE_MEMBERS_WITH_LINK', ACTOR_ID, ACTOR_ID],
  ] as const)('%s', async (_label, audience, actor, expectedActor) => {
    const { service, databaseRepo, workspace } = makeValidationHarness({
      storedForm: publicForm(undefined, { audience }),
    })

    await service.submit(actor, submissionInput({ title: 'Ответ', text: 'ok' }), tokenContext())

    expect(databaseRepo.createRow).toHaveBeenCalledWith(
      expect.objectContaining({ createdById: expectedActor }),
    )
    if (audience === 'WORKSPACE_MEMBERS_WITH_LINK') {
      expect(workspace.assertMembership).toHaveBeenCalledWith(ACTOR_ID, WORKSPACE_ID)
    }
  })

  it('generates the exact deterministic UTC title when no title question exists', async () => {
    const schema = formDocument([textQuestion()])
    const { service, databaseRepo } = makeValidationHarness({ storedForm: publicForm(schema) })

    await service.submit(null, submissionInput({ text: 'Анонимно' }), tokenContext())

    expect(automaticResponseTitle(NOW)).toBe('Ответ · 16.07.2026, 08:00 UTC')
    expect(databaseRepo.updatePageTitle).toHaveBeenCalledWith(
      ITEM_PAGE_ID,
      'Ответ · 16.07.2026, 08:00 UTC',
      null,
    )
  })

  it('independently compiles stored Zod constraints and rejects an invalid scalar before writes', async () => {
    const schema = formDocument([
      titleQuestion(),
      propertyQuestion('text', PROPERTY_ID, 'TEXT', {
        kind: 'TEXT',
        multiline: false,
        maxLength: 2,
      }),
    ])
    const { service, uow } = makeValidationHarness({ storedForm: publicForm(schema) })

    await expect(
      service.submit(null, submissionInput({ title: 'Ответ', text: 'too long' }), tokenContext()),
    ).rejects.toMatchObject({ message: 'FORM_ANSWERS_INVALID' })
    expect(uow.transaction).not.toHaveBeenCalled()
  })

  it.each([
    ['unknown', { title: 'Ответ', text: 'ok', injected: 'no' }],
    ['hidden', { title: 'hide', text: 'ok', hidden: 'no' }],
  ])('rejects %s answer keys before writes', async (_label, answers) => {
    const hidden = textQuestion('hidden', SECOND_PROPERTY_ID, {
      visibleWhen: {
        kind: 'ALL',
        members: [{ kind: 'TEXT_EQUALS', questionId: 'title', value: 'show' }],
      },
    })
    const schema = formDocument([titleQuestion(), textQuestion(), hidden])
    const { service, uow } = makeValidationHarness({ storedForm: publicForm(schema) })

    await expect(
      service.submit(null, submissionInput(answers), tokenContext()),
    ).rejects.toMatchObject({
      message: 'FORM_ANSWERS_INVALID',
    })
    expect(uow.transaction).not.toHaveBeenCalled()
  })

  it('derives the branch ending on the server and accepts no client ending field', async () => {
    const schema = formDocument([titleQuestion(), textQuestion()], {
      transitions: [
        {
          id: 'special',
          fromSectionId: 'main',
          priority: 0,
          when: {
            kind: 'ALL',
            members: [{ kind: 'TEXT_EQUALS', questionId: 'text', value: 'yes' }],
          },
          target: { kind: 'ENDING', endingId: 'special-ending' },
        },
        {
          id: 'default',
          fromSectionId: 'main',
          priority: 1,
          when: null,
          target: { kind: 'ENDING', endingId: 'done' },
        },
      ],
      endings: [
        { id: 'done', title: 'Обычно' },
        { id: 'special-ending', title: 'Особенно' },
      ],
    })
    const { service, formRepo } = makeValidationHarness({ storedForm: publicForm(schema) })

    await service.submit(null, submissionInput({ title: 'Ответ', text: 'yes' }), tokenContext())

    expect(formRepo.createSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ endingId: 'special-ending' }),
    )
  })

  it.each([
    ['locator hash', tokenContext({ locatorHash: 'b'.repeat(64) })],
    ['schema hash', tokenContext({ schemaHash: 'b'.repeat(64) })],
    ['link revision', tokenContext({ linkRevision: 5 })],
    ['missing version', tokenContext({ versionNumber: 2 })],
  ])('rejects stale %s context before writes', async (label, context) => {
    const { service, uow } = makeValidationHarness({
      ...(label === 'missing version' ? { requestedVersion: null } : {}),
    })

    await expect(
      service.submit(null, submissionInput({ title: 'Ответ', text: 'ok' }), context),
    ).rejects.toMatchObject({ message: 'FORM_VERSION_STALE' })
    expect(uow.transaction).not.toHaveBeenCalled()
  })

  it('accepts a live grace version and rejects it at the exact acceptUntil boundary', async () => {
    const current = formVersion(formDocument(), {
      id: '00000000-0000-7000-8000-000000000030',
      versionNumber: 4,
      schemaHash: 'c'.repeat(64),
    })
    const storedForm = publicForm(undefined, {
      publishedVersionId: current.id,
      publishedVersion: current,
    })
    const liveGrace = formVersion(undefined, {
      acceptUntil: new Date('2026-07-16T08:01:00.000Z'),
    })
    const accepted = makeValidationHarness({ storedForm, requestedVersion: liveGrace })

    await expect(
      accepted.service.submit(
        null,
        submissionInput({ title: 'Ответ', text: 'ok' }),
        tokenContext(),
      ),
    ).resolves.toMatchObject({ endingId: 'done' })

    const expired = makeValidationHarness({
      storedForm,
      requestedVersion: formVersion(undefined, { acceptUntil: NOW }),
    })
    await expect(
      expired.service.submit(null, submissionInput({ title: 'Ответ', text: 'ok' }), tokenContext()),
    ).rejects.toMatchObject({ message: 'FORM_VERSION_STALE' })
  })

  it.each([
    [
      'link rotation',
      () => ({ transactionForm: publicForm(undefined, { linkRevision: 5 }) }),
      'FORM_VERSION_STALE',
    ],
    [
      'audience change',
      () => ({
        transactionForm: publicForm(undefined, { audience: 'WORKSPACE_MEMBERS_WITH_LINK' }),
      }),
      'FORM_NOT_ACCEPTING',
    ],
    [
      'workspace policy disablement',
      () => {
        const form = publicForm()
        return {
          transactionForm: {
            ...form,
            source: {
              ...form.source,
              workspace: {
                ...form.source.workspace,
                securityPolicy: { disablePublicLinksSitesForms: true },
              },
            },
          },
        }
      },
      'FORM_NOT_ACCEPTING',
    ],
    [
      'current version replacement',
      () => {
        const current = formVersion(undefined, {
          id: '00000000-0000-7000-8000-000000000030',
          versionNumber: 4,
          schemaHash: 'c'.repeat(64),
        })
        return {
          transactionForm: publicForm(undefined, {
            publishedVersionId: current.id,
            publishedVersion: current,
          }),
          transactionVersion: formVersion(undefined, { acceptUntil: NOW }),
        }
      },
      'FORM_VERSION_STALE',
    ],
  ] as const)(
    'rejects transactional %s before reserving or writing',
    async (_label, changedContext, message) => {
      const { service, formRepo, databaseRepo } = makeValidationHarness(changedContext())

      await expect(
        service.submit(null, submissionInput({ title: 'Ответ', text: 'ok' }), tokenContext()),
      ).rejects.toMatchObject({ message })

      expect(formRepo.lockSubmissionContext).toHaveBeenCalledTimes(1)
      expect(formRepo.reserveResponseSlot).not.toHaveBeenCalled()
      expect(databaseRepo.createRow).not.toHaveBeenCalled()
    },
  )

  it('rechecks workspace membership after locking the transactional context', async () => {
    const memberForm = publicForm(undefined, { audience: 'WORKSPACE_MEMBERS_WITH_LINK' })
    const { service, formRepo } = makeValidationHarness({
      storedForm: memberForm,
      rejectTransactionMembership: true,
    })

    await expect(
      service.submit(ACTOR_ID, submissionInput({ title: 'Ответ', text: 'ok' }), tokenContext()),
    ).rejects.toMatchObject({ message: 'FORM_NOT_ACCEPTING' })
    expect(formRepo.reserveResponseSlot).not.toHaveBeenCalled()
  })

  it('rejects property drift discovered by the post-lock authoritative reload', async () => {
    let reads = 0
    const { service, formRepo, databaseRepo } = makeValidationHarness({
      databaseRepo: {
        listProperties: vi.fn(async () => {
          reads += 1
          return reads === 1
            ? [{ id: PROPERTY_ID, type: 'TEXT', name: 'Text', position: 1, settings: null }]
            : []
        }),
      },
    })

    await expect(
      service.submit(null, submissionInput({ text: 'value' }), tokenContext()),
    ).rejects.toMatchObject({ message: 'FORM_PROPERTY_INVALID' })
    expect(formRepo.reserveResponseSlot).not.toHaveBeenCalled()
    expect(databaseRepo.createRow).not.toHaveBeenCalled()
  })

  it('rejects a PERSON target revoked after the lock but before writes', async () => {
    let checks = 0
    const schema = formDocument([
      propertyQuestion('person', PROPERTY_ID, 'PERSON', { kind: 'PERSON', maxSelections: 1 }),
    ])
    const { service, formRepo } = makeValidationHarness({
      storedForm: publicForm(schema, { audience: 'WORKSPACE_MEMBERS_WITH_LINK' }),
      properties: [
        { id: PROPERTY_ID, type: 'PERSON', name: 'Person', position: 1, settings: null },
      ],
      databaseRepo: {
        isWorkspaceMember: vi.fn(async () => {
          checks += 1
          return checks === 1
        }),
      },
    })

    await expect(
      service.submit(ACTOR_ID, submissionInput({ person: [OWNER_ID] }), tokenContext()),
    ).rejects.toMatchObject({
      message: 'FORM_ANSWERS_INVALID',
      fieldErrors: { person: ['FORM_TARGET_INACCESSIBLE'] },
    })
    expect(formRepo.reserveResponseSlot).not.toHaveBeenCalled()
  })

  it('rejects a PAGE_LINK soft-deleted after preflight and before the locked reload', async () => {
    let visibilityReads = 0
    const schema = formDocument([
      propertyQuestion('page', PROPERTY_ID, 'PAGE_LINK', { kind: 'PAGE_LINK' }),
    ])
    const { service, formRepo, databaseRepo } = makeValidationHarness({
      storedForm: publicForm(schema, { audience: 'WORKSPACE_MEMBERS_WITH_LINK' }),
      properties: [
        { id: PROPERTY_ID, type: 'PAGE_LINK', name: 'Page', position: 1, settings: null },
      ],
      pageRepo: {
        findAccessiblePageLinkIds: vi.fn(async () => {
          visibilityReads += 1
          return visibilityReads === 1 ? new Set([TARGET_PAGE_ID]) : new Set()
        }),
      },
    })

    await expect(
      service.submit(ACTOR_ID, submissionInput({ page: TARGET_PAGE_ID }), tokenContext()),
    ).rejects.toMatchObject({
      message: 'FORM_ANSWERS_INVALID',
      fieldErrors: { page: ['FORM_TARGET_INACCESSIBLE'] },
    })
    expect(formRepo.reserveResponseSlot).not.toHaveBeenCalled()
    expect(databaseRepo.createRow).not.toHaveBeenCalled()
    expect(formRepo.enqueueFormSubmittedEvent).not.toHaveBeenCalled()
  })

  it('rejects an upload lease consumed after the lock but before writes', async () => {
    let reads = 0
    const schema = formDocument([
      propertyQuestion('files', PROPERTY_ID, 'FILE', {
        kind: 'FILE',
        allowedMimeTypes: ['text/plain'],
        maxBytesPerFile: 1_000,
        maxFiles: 1,
      }),
    ])
    const { service, formRepo } = makeValidationHarness({
      storedForm: publicForm(schema),
      properties: [{ id: PROPERTY_ID, type: 'FILE', name: 'Files', position: 1, settings: null }],
      formRepo: {
        resolveUploadLeases: vi.fn(async () => {
          reads += 1
          return [uploadLease(reads === 1 ? {} : { consumedAt: NOW })]
        }),
      },
    })

    await expect(
      service.submit(null, submissionInput({ files: ['lease-token-secret'] }), tokenContext()),
    ).rejects.toMatchObject({
      message: 'FORM_ANSWERS_INVALID',
      fieldErrors: { files: ['FORM_UPLOAD_INVALID'] },
    })
    expect(formRepo.reserveResponseSlot).not.toHaveBeenCalled()
    expect(formRepo.consumeUploadLeases).not.toHaveBeenCalled()
  })

  it('uses a fresh transaction timestamp for closing, submission provenance, and automatic title', async () => {
    const transactionNow = new Date('2026-07-16T08:01:00.000Z')
    let clock = NOW
    const schema = formDocument([textQuestion()])
    const { service, formRepo, databaseRepo } = makeValidationHarness({
      storedForm: publicForm(schema),
      now: () => clock,
      onTransactionStart: () => {
        clock = transactionNow
      },
    })

    await service.submit(null, submissionInput({ text: 'ok' }), tokenContext())

    expect(formRepo.reserveResponseSlot).toHaveBeenCalledWith(
      expect.objectContaining({ now: transactionNow }),
    )
    expect(formRepo.createSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ submittedAt: transactionNow }),
    )
    expect(databaseRepo.updatePageTitle).toHaveBeenCalledWith(
      ITEM_PAGE_ID,
      'Ответ · 16.07.2026, 08:01 UTC',
      null,
    )
  })

  it('rejects when the form closes between preparation and the locked transaction', async () => {
    const closesAt = new Date('2026-07-16T08:00:30.000Z')
    let clock = NOW
    const { service, formRepo } = makeValidationHarness({
      storedForm: publicForm(undefined, { closesAt }),
      now: () => clock,
      onTransactionStart: () => {
        clock = new Date('2026-07-16T08:01:00.000Z')
      },
    })

    await expect(
      service.submit(null, submissionInput({ title: 'Ответ', text: 'ok' }), tokenContext()),
    ).rejects.toMatchObject({ message: 'FORM_NOT_ACCEPTING' })
    expect(formRepo.reserveResponseSlot).not.toHaveBeenCalled()
  })

  it.each([
    ['missing property', []],
    [
      'type drift',
      [{ id: PROPERTY_ID, type: 'NUMBER', name: 'Текст', position: 1, settings: null }],
    ],
  ])('rejects current %s before writes', async (_label, properties) => {
    const { service, uow } = makeValidationHarness({ properties })

    await expect(
      service.submit(null, submissionInput({ title: 'Ответ', text: 'value' }), tokenContext()),
    ).rejects.toMatchObject({ message: 'FORM_PROPERTY_INVALID' })
    expect(uow.transaction).not.toHaveBeenCalled()
  })

  it.each([
    ['SELECT', 'SINGLE_CHOICE', 'expected'],
    ['MULTI_SELECT', 'MULTI_CHOICE', ['expected']],
  ] as const)(
    'rejects current %s option drift before writes',
    async (propertyType, inputKind, answer) => {
      const inputConfig: FormQuestion['input'] =
        inputKind === 'SINGLE_CHOICE'
          ? {
              kind: 'SINGLE_CHOICE',
              appearance: 'DROPDOWN',
              options: [{ id: 'expected', label: 'Expected' }],
            }
          : {
              kind: 'MULTI_CHOICE',
              appearance: 'CHECKLIST',
              options: [{ id: 'expected', label: 'Expected' }],
              maxSelections: 1,
            }
      const schema = formDocument([
        titleQuestion(),
        propertyQuestion('choice', PROPERTY_ID, propertyType, inputConfig),
      ])
      const { service, uow } = makeValidationHarness({
        storedForm: publicForm(schema),
        properties: [
          {
            id: PROPERTY_ID,
            type: propertyType,
            name: 'Choice',
            position: 1,
            settings: { options: [{ id: 'other', label: 'Other' }] },
          },
        ],
      })

      await expect(
        service.submit(null, submissionInput({ title: 'Ответ', choice: answer }), tokenContext()),
      ).rejects.toMatchObject({ message: 'FORM_PROPERTY_INVALID' })
      expect(uow.transaction).not.toHaveBeenCalled()
    },
  )

  it('accepts only active workspace PERSON targets and stores the single-person cell shape', async () => {
    const schema = formDocument([
      titleQuestion(),
      propertyQuestion('person', PROPERTY_ID, 'PERSON', { kind: 'PERSON', maxSelections: 1 }),
    ])
    const { service, databaseRepo, formRepo } = makeValidationHarness({
      storedForm: publicForm(schema, { audience: 'WORKSPACE_MEMBERS_WITH_LINK' }),
      properties: [
        { id: PROPERTY_ID, type: 'PERSON', name: 'Человек', position: 1, settings: null },
      ],
    })

    await service.submit(
      ACTOR_ID,
      submissionInput({ title: 'Ответ', person: [OWNER_ID] }),
      tokenContext(),
    )

    expect(databaseRepo.findActiveWorkspaceMemberIds).toHaveBeenCalledWith([OWNER_ID], WORKSPACE_ID)
    expect(formRepo.lockFormSubmissionAuthorities).toHaveBeenCalledWith(
      expect.objectContaining({ personUserIds: [OWNER_ID] }),
    )
    expect(databaseRepo.upsertCellValue).toHaveBeenCalledWith(ROW_ID, PROPERTY_ID, OWNER_ID)
  })

  it('rejects a stale published PERSON question configured for more than one selection', async () => {
    const schema = formDocument([
      titleQuestion(),
      propertyQuestion('person', PROPERTY_ID, 'PERSON', { kind: 'PERSON', maxSelections: 2 }),
    ])
    const { service, databaseRepo, uow } = makeValidationHarness({
      storedForm: publicForm(schema, { audience: 'WORKSPACE_MEMBERS_WITH_LINK' }),
      properties: [
        { id: PROPERTY_ID, type: 'PERSON', name: 'Человек', position: 1, settings: null },
      ],
    })

    await expect(
      service.submit(
        ACTOR_ID,
        submissionInput({ title: 'Ответ', person: [OWNER_ID, ACTOR_ID] }),
        tokenContext(),
      ),
    ).rejects.toMatchObject({ message: 'FORM_PROPERTY_INVALID' })
    expect(databaseRepo.isWorkspaceMember).not.toHaveBeenCalled()
    expect(uow.transaction).not.toHaveBeenCalled()
  })

  it.each(['not a member', 'blocked member'])(
    'rejects a PERSON target that is %s before opening the transaction',
    async () => {
      const schema = formDocument([
        titleQuestion(),
        propertyQuestion('person', PROPERTY_ID, 'PERSON', { kind: 'PERSON', maxSelections: 1 }),
      ])
      const { service, uow } = makeValidationHarness({
        storedForm: publicForm(schema, { audience: 'WORKSPACE_MEMBERS_WITH_LINK' }),
        properties: [
          { id: PROPERTY_ID, type: 'PERSON', name: 'Человек', position: 1, settings: null },
        ],
        databaseRepo: { isWorkspaceMember: vi.fn(async () => false) },
      })

      await expect(
        service.submit(
          ACTOR_ID,
          submissionInput({ title: 'Ответ', person: [OWNER_ID] }),
          tokenContext(),
        ),
      ).rejects.toMatchObject({
        message: 'FORM_ANSWERS_INVALID',
        fieldErrors: { person: ['FORM_TARGET_INACCESSIBLE'] },
      })
      expect(uow.transaction).not.toHaveBeenCalled()
    },
  )

  it('validates RELATION source workspace, target page visibility, and row ACL before writing links', async () => {
    const schema = formDocument([
      titleQuestion(),
      propertyQuestion('relation', PROPERTY_ID, 'RELATION', {
        kind: 'RELATION',
        maxSelections: 2,
      }),
    ])
    const { service, databaseRepo, pageRepo } = makeValidationHarness({
      storedForm: publicForm(schema, { audience: 'WORKSPACE_MEMBERS_WITH_LINK' }),
      properties: [
        {
          id: PROPERTY_ID,
          type: 'RELATION',
          name: 'Связь',
          position: 1,
          settings: { relation: { targetSourceId: TARGET_SOURCE_ID } },
        },
      ],
    })

    await service.submit(
      ACTOR_ID,
      submissionInput({ title: 'Ответ', relation: [TARGET_ROW_ID] }),
      tokenContext(),
    )

    expect(pageRepo.findAccessiblePageIds).toHaveBeenCalledWith(ACTOR_ID, WORKSPACE_ID, [
      TARGET_SOURCE_PAGE_ID,
      TARGET_PAGE_ID,
    ])
    expect(databaseRepo.replaceRelationLinks).toHaveBeenCalledWith({
      propertyId: PROPERTY_ID,
      rowId: ROW_ID,
      targetRowIds: [TARGET_ROW_ID],
    })
  })

  it('validates 500 RELATION targets with one role, creator, and share batch per authority pass', async () => {
    const targetIds = Array.from({ length: 500 }, (_, index) => `target-${index}`)
    const schema = formDocument([
      propertyQuestion('relation', PROPERTY_ID, 'RELATION', {
        kind: 'RELATION',
        maxSelections: 500,
      }),
    ])
    const findWorkspaceRole = vi.fn(async () => 'VIEWER' as const)
    const isSourcePageCreatedBy = vi.fn(async () => false)
    const findItemPageShareLevels = vi.fn(async () => new Map())
    const findItemPageShareLevel = vi.fn(async () => null)
    const { service } = makeValidationHarness({
      storedForm: publicForm(schema, { audience: 'WORKSPACE_MEMBERS_WITH_LINK' }),
      properties: [
        {
          id: PROPERTY_ID,
          type: 'RELATION',
          name: 'Relation',
          position: 1,
          settings: { relation: { targetSourceId: TARGET_SOURCE_ID } },
        },
      ],
      databaseRepo: {
        findRowsAccessMetaByIds: vi.fn(async (ids: string[]) =>
          ids.map((id, index) => ({
            id,
            sourceId: TARGET_SOURCE_ID,
            workspaceId: WORKSPACE_ID,
            pageId: `page-${index}`,
            createdById: OWNER_ID,
            cellsByProperty: new Map<string, unknown>(),
          })),
        ),
        findWorkspaceRole,
        isSourcePageCreatedBy,
        findItemPageShareLevels,
        findItemPageShareLevel,
      },
    })

    await service.submit(ACTOR_ID, submissionInput({ relation: targetIds }), tokenContext())

    expect(findWorkspaceRole).toHaveBeenCalledTimes(2)
    expect(isSourcePageCreatedBy).toHaveBeenCalledTimes(2)
    expect(findItemPageShareLevels).toHaveBeenCalledTimes(2)
    expect(findItemPageShareLevel).not.toHaveBeenCalled()
  })

  it('keeps a near-1MiB 500-question RELATION submission at constant authority queries', async () => {
    const questions = Array.from({ length: 500 }, (_, questionIndex) =>
      propertyQuestion(`relation-${questionIndex}`, PROPERTY_ID, 'RELATION', {
        kind: 'RELATION',
        maxSelections: 4,
      }),
    )
    const answers = Object.fromEntries(
      questions.map((question, questionIndex) => [
        question.id,
        Array.from(
          { length: 4 },
          (_, targetIndex) =>
            `${questionIndex}-${targetIndex}-${'x'.repeat(465 - questionIndex.toString().length)}`,
        ),
      ]),
    )
    expect(Buffer.byteLength(JSON.stringify({ answers }), 'utf8')).toBeGreaterThan(900_000)

    const findSourceMetaById = vi.fn(async () => ({
      id: TARGET_SOURCE_ID,
      workspaceId: WORKSPACE_ID,
      pageId: TARGET_SOURCE_PAGE_ID,
    }))
    const findRowsAccessMetaByIds = vi.fn(async (ids: string[]) =>
      ids.map((id) => ({
        id,
        sourceId: TARGET_SOURCE_ID,
        workspaceId: WORKSPACE_ID,
        pageId: TARGET_PAGE_ID,
        createdById: OWNER_ID,
        cellsByProperty: new Map<string, unknown>(),
      })),
    )
    const findEnabledAccessRulesForSources = vi.fn(async () => new Map())
    const findWorkspaceRole = vi.fn(async () => 'VIEWER' as const)
    const isSourcePageCreatedBy = vi.fn(async () => false)
    const findItemPageShareLevels = vi.fn(async () => new Map())
    const findAccessiblePageIds = vi.fn(
      async (_user: string, _workspace: string, ids: string[]) => new Set(ids),
    )
    const { service } = makeValidationHarness({
      storedForm: publicForm(formDocument(questions), {
        audience: 'WORKSPACE_MEMBERS_WITH_LINK',
      }),
      properties: [
        {
          id: PROPERTY_ID,
          type: 'RELATION',
          name: 'Relation',
          position: 1,
          settings: { relation: { targetSourceId: TARGET_SOURCE_ID } },
        },
      ],
      databaseRepo: {
        findSourceMetaById,
        findRowsAccessMetaByIds,
        findEnabledAccessRulesForSources,
        findWorkspaceRole,
        isSourcePageCreatedBy,
        findItemPageShareLevels,
      },
      pageRepo: { findAccessiblePageIds },
    })

    await service.submit(ACTOR_ID, submissionInput(answers), tokenContext())

    for (const query of [
      findSourceMetaById,
      findRowsAccessMetaByIds,
      findEnabledAccessRulesForSources,
      findWorkspaceRole,
      isSourcePageCreatedBy,
      findItemPageShareLevels,
      findAccessiblePageIds,
    ]) {
      expect(query).toHaveBeenCalledTimes(2)
    }
  })

  it.each([
    [
      'target source is in another workspace',
      {
        databaseRepo: {
          findSourceMetaById: vi.fn(async () => ({
            id: TARGET_SOURCE_ID,
            workspaceId: '00000000-0000-7000-8000-000000000099',
            pageId: TARGET_SOURCE_PAGE_ID,
          })),
        },
      },
    ],
    [
      'target row is missing or belongs to another source',
      { databaseRepo: { findRowsAccessMetaByIds: vi.fn(async () => []) } },
    ],
    [
      'target source page is hidden',
      {
        pageRepo: { findAccessiblePageIds: vi.fn(async () => new Set([TARGET_PAGE_ID])) },
      },
    ],
    [
      'target item page is hidden',
      {
        pageRepo: {
          findAccessiblePageIds: vi.fn(async () => new Set([TARGET_SOURCE_PAGE_ID])),
        },
      },
    ],
    [
      'target row ACL does not match',
      {
        databaseRepo: {
          findEnabledAccessRulesForSources: vi.fn(
            async () =>
              new Map([
                [
                  TARGET_SOURCE_ID,
                  [
                    {
                      propertyId: SECOND_PROPERTY_ID,
                      propertyType: 'PERSON',
                      accessLevel: 'CAN_VIEW',
                      enabled: true,
                    },
                  ],
                ],
              ]),
          ),
        },
      },
    ],
  ])('rejects RELATION when the %s', async (_label, overrides) => {
    const schema = formDocument([
      titleQuestion(),
      propertyQuestion('relation', PROPERTY_ID, 'RELATION', {
        kind: 'RELATION',
        maxSelections: 1,
      }),
    ])
    const { service, uow } = makeValidationHarness({
      storedForm: publicForm(schema, { audience: 'WORKSPACE_MEMBERS_WITH_LINK' }),
      properties: [
        {
          id: PROPERTY_ID,
          type: 'RELATION',
          name: 'Связь',
          position: 1,
          settings: { relation: { targetSourceId: TARGET_SOURCE_ID } },
        },
      ],
      ...overrides,
    })

    await expect(
      service.submit(
        ACTOR_ID,
        submissionInput({ title: 'Ответ', relation: [TARGET_ROW_ID] }),
        tokenContext(),
      ),
    ).rejects.toMatchObject({
      message: 'FORM_ANSWERS_INVALID',
      fieldErrors: { relation: ['FORM_TARGET_INACCESSIBLE'] },
    })
    expect(uow.transaction).not.toHaveBeenCalled()
  })

  it('writes a PAGE_LINK only after canonical page visibility succeeds', async () => {
    const schema = formDocument([
      titleQuestion(),
      propertyQuestion('page', PROPERTY_ID, 'PAGE_LINK', { kind: 'PAGE_LINK' }),
    ])
    const { service, databaseRepo, pageRepo } = makeValidationHarness({
      storedForm: publicForm(schema, { audience: 'WORKSPACE_MEMBERS_WITH_LINK' }),
      properties: [
        { id: PROPERTY_ID, type: 'PAGE_LINK', name: 'Страница', position: 1, settings: null },
      ],
    })

    await service.submit(
      ACTOR_ID,
      submissionInput({ title: 'Ответ', page: TARGET_PAGE_ID }),
      tokenContext(),
    )

    expect(pageRepo.findAccessiblePageLinkIds).toHaveBeenCalledWith(ACTOR_ID, WORKSPACE_ID, [
      TARGET_PAGE_ID,
    ])
    expect(databaseRepo.upsertCellValue).toHaveBeenCalledWith(ROW_ID, PROPERTY_ID, TARGET_PAGE_ID)
  })

  it('rejects an inaccessible PAGE_LINK before opening the transaction', async () => {
    const schema = formDocument([
      titleQuestion(),
      propertyQuestion('page', PROPERTY_ID, 'PAGE_LINK', { kind: 'PAGE_LINK' }),
    ])
    const { service, uow } = makeValidationHarness({
      storedForm: publicForm(schema, { audience: 'WORKSPACE_MEMBERS_WITH_LINK' }),
      properties: [
        { id: PROPERTY_ID, type: 'PAGE_LINK', name: 'Страница', position: 1, settings: null },
      ],
      pageRepo: { findAccessiblePageLinkIds: vi.fn(async () => new Set()) },
    })

    await expect(
      service.submit(
        ACTOR_ID,
        submissionInput({ title: 'Ответ', page: TARGET_PAGE_ID }),
        tokenContext(),
      ),
    ).rejects.toMatchObject({
      message: 'FORM_ANSWERS_INVALID',
      fieldErrors: { page: ['FORM_TARGET_INACCESSIBLE'] },
    })
    expect(uow.transaction).not.toHaveBeenCalled()
  })

  it('hashes and resolves bound FILE leases without consuming them before the response transaction', async () => {
    const leaseToken = 'lease-token-secret'
    const schema = formDocument([
      titleQuestion(),
      propertyQuestion('files', PROPERTY_ID, 'FILE', {
        kind: 'FILE',
        allowedMimeTypes: ['text/plain'],
        maxBytesPerFile: 1_000,
        maxFiles: 2,
      }),
    ])
    const lease = uploadLease()
    const { service, formRepo, databaseRepo } = makeValidationHarness({
      storedForm: publicForm(schema),
      properties: [{ id: PROPERTY_ID, type: 'FILE', name: 'Файлы', position: 1, settings: null }],
      formRepo: { resolveUploadLeases: vi.fn(async () => [lease]) },
    })

    await service.submit(
      null,
      submissionInput({ title: 'Ответ', files: [leaseToken] }),
      tokenContext(),
    )

    expect(formRepo.resolveUploadLeases).toHaveBeenCalledWith({
      formId: FORM_ID,
      versionId: VERSION_ID,
      questionId: 'files',
      tokenHashes: [createHash('sha256').update(leaseToken).digest('hex')],
      now: NOW,
    })
    expect(formRepo.consumeUploadLeases).toHaveBeenCalledWith({
      formId: FORM_ID,
      versionId: VERSION_ID,
      questionId: 'files',
      workspaceId: WORKSPACE_ID,
      uploads: [lease],
      pageId: ITEM_PAGE_ID,
      consumedAt: NOW,
    })
    expect(databaseRepo.upsertFileCellValue).toHaveBeenCalledWith(ROW_ID, PROPERTY_ID, [FILE_ID])
  })

  it.each([
    ['cross-form binding', { formId: '00000000-0000-7000-8000-000000000099' }],
    ['cross-version binding', { versionId: '00000000-0000-7000-8000-000000000099' }],
    ['cross-question binding', { questionId: 'other' }],
    ['expired lease', { expiresAt: NOW }],
    ['consumed lease', { consumedAt: NOW }],
  ])('rejects a FILE %s without consuming the lease', async (_label, leaseOverride) => {
    const schema = formDocument([
      titleQuestion(),
      propertyQuestion('files', PROPERTY_ID, 'FILE', {
        kind: 'FILE',
        allowedMimeTypes: ['text/plain'],
        maxBytesPerFile: 1_000,
        maxFiles: 1,
      }),
    ])
    const lease = uploadLease(leaseOverride)
    const { service, formRepo, uow } = makeValidationHarness({
      storedForm: publicForm(schema),
      properties: [{ id: PROPERTY_ID, type: 'FILE', name: 'Файлы', position: 1, settings: null }],
      formRepo: { resolveUploadLeases: vi.fn(async () => [lease]) },
    })

    await expect(
      service.submit(
        null,
        submissionInput({ title: 'Ответ', files: ['lease-token'] }),
        tokenContext(),
      ),
    ).rejects.toMatchObject({
      message: 'FORM_ANSWERS_INVALID',
      fieldErrors: { files: ['FORM_UPLOAD_INVALID'] },
    })
    expect(formRepo.consumeUploadLeases).not.toHaveBeenCalled()
    expect(uow.transaction).not.toHaveBeenCalled()
  })

  it('rejects FILE maxFiles before lease resolution', async () => {
    const schema = formDocument([
      titleQuestion(),
      propertyQuestion('files', PROPERTY_ID, 'FILE', {
        kind: 'FILE',
        allowedMimeTypes: ['text/plain'],
        maxBytesPerFile: 1_000,
        maxFiles: 1,
      }),
    ])
    const { service, formRepo } = makeValidationHarness({
      storedForm: publicForm(schema),
      properties: [{ id: PROPERTY_ID, type: 'FILE', name: 'Файлы', position: 1, settings: null }],
    })

    await expect(
      service.submit(
        null,
        submissionInput({ title: 'Ответ', files: ['lease-one', 'lease-two'] }),
        tokenContext(),
      ),
    ).rejects.toMatchObject({ message: 'FORM_ANSWERS_INVALID' })
    expect(formRepo.resolveUploadLeases).not.toHaveBeenCalled()
  })
})

describe('DatabaseFormRepository submission transaction primitives', () => {
  it('locks form, page, policy, and relevant membership rows before transactional revalidation', async () => {
    const client = {
      $executeRaw: vi.fn(async () => 0),
      $queryRaw: vi.fn(async () => [{ id: FORM_ID }]),
    }
    const uow = { client: vi.fn(() => client) } as unknown as UnitOfWork
    const repository = new DatabaseFormRepository(uow)

    await expect(
      repository.lockSubmissionContext({
        formId: FORM_ID,
        workspaceId: WORKSPACE_ID,
        pageId: SOURCE_PAGE_ID,
        actorUserId: ACTOR_ID,
      }),
    ).resolves.toBe(true)

    expect(client.$executeRaw).not.toHaveBeenCalled()
    const locks = client.$queryRaw.mock.calls.map(([query]) =>
      (query as { strings: readonly string[] }).strings.join('?'),
    )
    expect(locks[0]).toContain('workspaces')
    expect(locks[0]).toContain('FOR UPDATE')
    expect(locks[0]).not.toContain('NO KEY')
    expect(locks[1]).toContain('workspace_security_policies')
    expect(locks[2]).toContain('workspace_members')
    expect(locks[3]).toContain('pages')
    expect(locks[4]).toContain('database_forms')
    expect(locks.slice(1).every((sql) => sql.includes('FOR UPDATE'))).toBe(true)
  })

  it('locks submission authorities in a deterministic table and sorted-id order', async () => {
    const client = {
      $queryRaw: vi.fn(async (query: { strings: readonly string[] }) => {
        const sql = query.strings.join('')
        if (sql.includes('workspace_members')) {
          return [{ user_id: ACTOR_ID }, { user_id: OWNER_ID }]
        }
        if (sql.includes('database_properties')) {
          return [{ id: PROPERTY_ID }, { id: THIRD_PROPERTY_ID }]
        }
        if (sql.includes('database_sources') && sql.includes(' IN ')) {
          return [{ id: TARGET_SOURCE_ID }]
        }
        if (sql.includes('database_rows')) return [{ id: ROW_ID }, { id: TARGET_ROW_ID }]
        if (sql.includes('FROM pages')) return [{ id: SOURCE_PAGE_ID }, { id: TARGET_PAGE_ID }]
        if (sql.includes('database_form_uploads')) return [{ id: UPLOAD_ID }]
        if (sql.includes('FROM files')) return [{ id: FILE_ID }]
        return [{ id: FORM_ID }]
      }),
    }
    const repository = new DatabaseFormRepository({
      client: vi.fn(() => client),
    } as unknown as UnitOfWork)

    await expect(
      repository.lockFormSubmissionAuthorities({
        formId: FORM_ID,
        workspaceId: WORKSPACE_ID,
        formSourceId: SOURCE_ID,
        actorUserId: ACTOR_ID,
        personUserIds: [OWNER_ID, ACTOR_ID],
        sourceIds: [TARGET_SOURCE_ID, SOURCE_ID],
        propertyIds: [THIRD_PROPERTY_ID, PROPERTY_ID],
        rowIds: [TARGET_ROW_ID, ROW_ID],
        pageIds: [TARGET_PAGE_ID, SOURCE_PAGE_ID],
        uploadIds: [UPLOAD_ID],
        fileIds: [FILE_ID],
      }),
    ).resolves.toBe(true)

    const queries = client.$queryRaw.mock.calls.map(
      ([query]) =>
        query as {
          strings: readonly string[]
          values: unknown[]
        },
    )
    const sql = queries.map(({ strings }) => strings.join('?'))
    expect(sql.map((query) => /FROM\s+(\w+)/u.exec(query)?.[1])).toEqual([
      'workspace_members',
      'workspace_blocked_users',
      'database_sources',
      'database_sources',
      'database_properties',
      'database_page_access_rules',
      'database_rows',
      'database_cell_values',
      'pages',
      'collections',
      'page_shares',
      'page_share_users',
      'database_form_uploads',
      'files',
    ])
    expect(sql.every((query) => query.includes('ORDER BY') && query.includes('FOR UPDATE'))).toBe(
      true,
    )
    expect(queries[0]!.values.slice(1)).toEqual([ACTOR_ID, OWNER_ID].sort())
    expect(queries[3]!.values).toEqual([TARGET_SOURCE_ID])
    expect(queries[6]!.values).toEqual([ROW_ID, TARGET_ROW_ID].sort())
    expect(queries[8]!.values).toEqual([SOURCE_PAGE_ID, TARGET_PAGE_ID].sort())
  })

  it('reserves a slot with one conditional update covering state, schedule, and the live limit', async () => {
    const client = { $queryRaw: vi.fn(async () => [{ id: FORM_ID }]) }
    const uow = { client: vi.fn(() => client) } as unknown as UnitOfWork
    const repository = new DatabaseFormRepository(uow)

    await expect(
      repository.reserveResponseSlot({
        formId: FORM_ID,
        now: NOW,
        expectedLinkRevision: 4,
        expectedAudience: 'SIGNED_IN_WITH_LINK',
      }),
    ).resolves.toBe(true)

    const query = client.$queryRaw.mock.calls[0]![0] as {
      strings: readonly string[]
      values: unknown[]
    }
    const sql = query.strings.join('?')
    expect(sql).toContain('state =')
    expect(sql).toContain('link_revision =')
    expect(sql).toContain('audience =')
    expect(sql).toContain('opens_at IS NULL OR opens_at <=')
    expect(sql).toContain('closes_at IS NULL OR closes_at >')
    expect(sql).toContain('response_limit IS NULL OR accepted_responses < response_limit')
    expect(sql).toContain('accepted_responses = accepted_responses + 1')
    expect(query.values).toEqual([FORM_ID, 'OPEN', 4, 'SIGNED_IN_WITH_LINK', NOW, NOW])
  })

  it('creates submission provenance and enqueues an identifier-only form event on the active client', async () => {
    const created = submission()
    const client = {
      databaseFormSubmission: { create: vi.fn(async () => created) },
      outboxEvent: { create: vi.fn(async () => ({ id: 1n })) },
    }
    const uow = { client: vi.fn(() => client) } as unknown as UnitOfWork
    const repository = new DatabaseFormRepository(uow)

    await repository.createSubmission({
      formId: FORM_ID,
      versionId: VERSION_ID,
      rowId: ROW_ID,
      respondentUserId: null,
      endingId: 'server-ending',
      idempotencyKey: IDEMPOTENCY_KEY,
      submittedAt: NOW,
    })
    await repository.enqueueFormSubmittedEvent({
      formId: FORM_ID,
      versionNumber: 3,
      sourceId: SOURCE_ID,
      sourcePageId: SOURCE_PAGE_ID,
      workspaceId: WORKSPACE_ID,
      rowId: ROW_ID,
      itemPageId: ITEM_PAGE_ID,
      submissionId: SUBMISSION_ID,
      respondentUserId: null,
      submittedAt: NOW,
    })

    expect(client.databaseFormSubmission.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ endingId: 'server-ending', respondentUserId: null }),
      }),
    )
    expect(client.outboxEvent.create).toHaveBeenCalledWith({
      data: {
        eventType: 'database.form.submitted',
        aggregateType: 'webhook_event',
        aggregateId: SOURCE_PAGE_ID,
        workspaceId: WORKSPACE_ID,
        payload: {
          resourceType: 'page',
          actorId: null,
          hints: {
            formId: FORM_ID,
            versionNumber: 3,
            sourceId: SOURCE_ID,
            rowId: ROW_ID,
            itemPageId: ITEM_PAGE_ID,
            submissionId: SUBMISSION_ID,
            submittedAt: NOW.toISOString(),
            respondentKind: 'anonymous',
          },
        },
      },
    })
    expect(JSON.stringify(client.outboxEvent.create.mock.calls[0]![0])).not.toContain(
      'Server title',
    )
    expect(JSON.stringify(client.outboxEvent.create.mock.calls[0]![0])).not.toContain(
      'prepared value',
    )
  })

  it('resolves only hashed upload leases bound to the form, version, question, expiry, and pending file', async () => {
    const lease = uploadLease()
    const client = {
      databaseFormUpload: { findMany: vi.fn(async () => [lease]) },
    }
    const repository = new DatabaseFormRepository({
      client: vi.fn(() => client),
    } as unknown as UnitOfWork)
    const tokenHash = createHash('sha256').update('lease-token').digest('hex')

    await expect(
      repository.resolveUploadLeases({
        formId: FORM_ID,
        versionId: VERSION_ID,
        questionId: 'files',
        tokenHashes: [tokenHash],
        now: NOW,
      }),
    ).resolves.toEqual([lease])

    expect(client.databaseFormUpload.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          formId: FORM_ID,
          versionId: VERSION_ID,
          questionId: 'files',
          uploadTokenHash: { in: [tokenHash] },
          expiresAt: { gt: NOW },
          consumedAt: null,
          file: { is: { status: 'PENDING' } },
        },
      }),
    )
  })

  it('consumes each lease once while attaching PageFile and activating File on the active transaction client', async () => {
    const lease = uploadLease()
    const client = {
      databaseFormUpload: { updateMany: vi.fn(async () => ({ count: 1 })) },
      file: { updateMany: vi.fn(async () => ({ count: 1 })) },
      pageFile: { create: vi.fn(async () => ({ pageId: ITEM_PAGE_ID, fileId: FILE_ID })) },
    }
    const repository = new DatabaseFormRepository({
      client: vi.fn(() => client),
    } as unknown as UnitOfWork)

    await repository.consumeUploadLeases({
      formId: FORM_ID,
      versionId: VERSION_ID,
      questionId: 'files',
      workspaceId: WORKSPACE_ID,
      uploads: [lease],
      pageId: ITEM_PAGE_ID,
      consumedAt: NOW,
    })

    expect(client.databaseFormUpload.updateMany).toHaveBeenCalledWith({
      where: {
        id: UPLOAD_ID,
        formId: FORM_ID,
        versionId: VERSION_ID,
        questionId: 'files',
        fileId: FILE_ID,
        expiresAt: { gt: NOW },
        consumedAt: null,
      },
      data: { consumedAt: NOW },
    })
    expect(client.file.updateMany).toHaveBeenCalledWith({
      where: { id: FILE_ID, workspaceId: WORKSPACE_ID, status: 'PENDING' },
      data: { status: 'ACTIVE', expiresAt: null },
    })
    expect(client.pageFile.create).toHaveBeenCalledWith({
      data: { pageId: ITEM_PAGE_ID, fileId: FILE_ID },
    })
  })

  it('fails closed on a concurrently consumed lease before attaching or activating its file', async () => {
    const client = {
      databaseFormUpload: { updateMany: vi.fn(async () => ({ count: 0 })) },
      file: { updateMany: vi.fn(async () => ({ count: 1 })) },
      pageFile: { create: vi.fn() },
    }
    const repository = new DatabaseFormRepository({
      client: vi.fn(() => client),
    } as unknown as UnitOfWork)

    await expect(
      repository.consumeUploadLeases({
        formId: FORM_ID,
        versionId: VERSION_ID,
        questionId: 'files',
        workspaceId: WORKSPACE_ID,
        uploads: [uploadLease()],
        pageId: ITEM_PAGE_ID,
        consumedAt: NOW,
      }),
    ).rejects.toMatchObject({ message: 'FORM_UPLOAD_INVALID' })
    expect(client.file.updateMany).not.toHaveBeenCalled()
    expect(client.pageFile.create).not.toHaveBeenCalled()
  })
})

describe('submission target repository boundaries', () => {
  it('treats a blocked workspace member as an invalid PERSON target', async () => {
    const client = {
      workspaceMember: { findUnique: vi.fn(async () => ({ id: 'member' })) },
      workspaceBlockedUser: { findUnique: vi.fn(async () => ({ id: 'block' })) },
    }
    const repository = new DatabaseRepository({
      client: vi.fn(() => client),
    } as unknown as UnitOfWork)

    await expect(repository.isWorkspaceMember(ACTOR_ID, WORKSPACE_ID)).resolves.toBe(false)
    expect(client.workspaceBlockedUser.findUnique).toHaveBeenCalledWith({
      where: { workspaceId_userId: { workspaceId: WORKSPACE_ID, userId: ACTOR_ID } },
      select: { id: true },
    })
  })

  it('keeps database row pages eligible for canonical RELATION target checks', async () => {
    const client = {
      page: { findMany: vi.fn(async () => [{ id: TARGET_PAGE_ID }]) },
    }
    const repository = new PageRepository({
      client: vi.fn(() => client),
    } as unknown as UnitOfWork)

    await expect(
      repository.findAccessiblePageIds(ACTOR_ID, WORKSPACE_ID, [TARGET_PAGE_ID]),
    ).resolves.toEqual(new Set([TARGET_PAGE_ID]))
    expect(client.page.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: [TARGET_PAGE_ID] },
          workspaceId: WORKSPACE_ID,
          archivedAt: null,
          deletedAt: null,
          workspace: {
            members: { some: { userId: ACTOR_ID } },
            blockedUsers: { none: { userId: ACTOR_ID } },
          },
          AND: [expect.objectContaining({ OR: expect.any(Array) })],
        }),
      }),
    )
  })

  it('excludes templates and database row pages from canonical PAGE_LINK targets', async () => {
    const client = {
      page: { findMany: vi.fn(async () => [{ id: TARGET_PAGE_ID }]) },
    }
    const repository = new PageRepository({
      client: vi.fn(() => client),
    } as unknown as UnitOfWork)

    await expect(
      repository.findAccessiblePageLinkIds(ACTOR_ID, WORKSPACE_ID, [TARGET_PAGE_ID]),
    ).resolves.toEqual(new Set([TARGET_PAGE_ID]))
    expect(client.page.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          isTemplate: null,
          AND: [
            expect.objectContaining({ OR: expect.any(Array) }),
            expect.objectContaining({ OR: expect.any(Array) }),
          ],
        }),
      }),
    )
  })
})

describe('nullable response actor type boundary', () => {
  it('widens only the focused item-page creation port', () => {
    expectTypeOf<ItemPageCreator['createItemPageTx']>().parameter(2).toEqualTypeOf<string | null>()
    expectTypeOf<PageRepository['createPageTx']>().parameter(0).toEqualTypeOf<string>()
  })
})
