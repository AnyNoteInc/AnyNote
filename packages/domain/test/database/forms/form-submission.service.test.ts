import { createHash } from 'node:crypto'

import { describe, expect, expectTypeOf, it, vi } from 'vitest'

import type { DatabaseRepository } from '../../../src/database/repositories/database.repository.ts'
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
  type PreparedFormSubmission,
} from '../../../src/database/forms/form-submission.service.ts'
import type { PageRepository } from '../../../src/pages/repositories/pages.repository.ts'
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
const LOCATOR_HASH = createHash('sha256').update('anf_public').digest('hex')

const prepared = (overrides: Partial<PreparedFormSubmission> = {}): PreparedFormSubmission => ({
  formId: FORM_ID,
  linkRevision: 4,
  audience: 'SIGNED_IN_WITH_LINK',
  versionId: VERSION_ID,
  versionNumber: 3,
  sourceId: SOURCE_ID,
  sourcePageId: SOURCE_PAGE_ID,
  workspaceId: WORKSPACE_ID,
  respondentUserId: ACTOR_ID,
  idempotencyKey: IDEMPOTENCY_KEY,
  endingId: 'server-ending',
  title: 'Server title',
  scalarValues: [{ propertyId: PROPERTY_ID, value: 'prepared value' }],
  submittedAt: NOW,
  ...overrides,
})

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

function makeHarness(
  options: {
    formRepo?: Partial<FormRepositoryContract>
    databaseRepo?: Partial<DatabaseRepository>
    pageRepo?: Partial<ItemPageCreator>
    uow?: UnitOfWork
  } = {},
) {
  let transactionDepth = 0
  const uow =
    options.uow ??
    ({
      transaction: vi.fn(async (run: () => Promise<unknown>) => {
        transactionDepth += 1
        try {
          return await run()
        } finally {
          transactionDepth -= 1
        }
      }),
      client: vi.fn() as unknown as UnitOfWork['client'],
    } satisfies UnitOfWork)
  const assertInTransaction = () => expect(transactionDepth).toBeGreaterThan(0)
  const formRepo = {
    findSubmissionByIdempotency: vi.fn(async () => null),
    reserveResponseSlot: vi.fn(async () => {
      assertInTransaction()
      return true
    }),
    createSubmission: vi.fn(async () => {
      assertInTransaction()
      return submission()
    }),
    enqueueFormSubmittedEvent: vi.fn(async () => assertInTransaction()),
    ...options.formRepo,
  } as unknown as FormRepositoryContract
  const databaseRepo = {
    maxRowPosition: vi.fn(async () => 0),
    createRow: vi.fn(async () => {
      assertInTransaction()
      return { id: ROW_ID, pageId: ITEM_PAGE_ID, position: 1_024 }
    }),
    updatePageTitle: vi.fn(async () => assertInTransaction()),
    upsertCellValue: vi.fn(async () => assertInTransaction()),
    ...options.databaseRepo,
  } as unknown as DatabaseRepository
  const pageRepo = {
    createItemPageTx: vi.fn(async () => {
      assertInTransaction()
      return { id: ITEM_PAGE_ID }
    }),
    ...options.pageRepo,
  } as ItemPageCreator
  const service = new FormSubmissionService(
    formRepo,
    databaseRepo,
    pageRepo,
    uow,
    {} as FormAccessResolver,
  )
  return { service, formRepo, databaseRepo, pageRepo, uow }
}

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
  } as unknown as DatabaseRepository
  const pageRepo = {
    createItemPageTx: vi.fn(async () => {
      assertInTransaction()
      return { id: ITEM_PAGE_ID }
    }),
  } as ItemPageCreator
  const service = new FormSubmissionService(formRepo, databaseRepo, pageRepo, uow, formAccess, now)
  return { service, formRepo, databaseRepo, pageRepo, uow, workspace }
}

describe('FormSubmissionService server-authoritative scalar preparation', () => {
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

  it.each(['FILE', 'PERSON', 'RELATION', 'PAGE_LINK'] as const)(
    'rejects %s semantic preparation until the target/lease slice',
    async (propertyType) => {
      const inputConfig: FormQuestion['input'] =
        propertyType === 'FILE'
          ? {
              kind: 'FILE',
              allowedMimeTypes: ['text/plain'],
              maxBytesPerFile: 1_000,
              maxFiles: 1,
            }
          : propertyType === 'PAGE_LINK'
            ? { kind: 'PAGE_LINK' }
            : { kind: propertyType, maxSelections: 1 }
      const schema = formDocument([
        titleQuestion(),
        propertyQuestion('unsupported', PROPERTY_ID, propertyType, inputConfig),
      ])
      const { service, uow } = makeValidationHarness({
        storedForm: publicForm(schema, { audience: 'WORKSPACE_MEMBERS_WITH_LINK' }),
        properties: [
          { id: PROPERTY_ID, type: propertyType, name: 'Unsupported', position: 1, settings: null },
        ],
      })
      const answer = propertyType === 'PAGE_LINK' ? SOURCE_PAGE_ID : [ACTOR_ID]

      await expect(
        service.submit(
          ACTOR_ID,
          submissionInput({ title: 'Ответ', unsupported: answer }),
          tokenContext(),
        ),
      ).rejects.toMatchObject({ message: 'FORM_SEMANTIC_PREPARATION_UNSUPPORTED' })
      expect(uow.transaction).not.toHaveBeenCalled()
    },
  )
})

describe('FormSubmissionService prepared transaction core', () => {
  it('persists the server-provided title, scalar values, ending, and authenticated actor atomically', async () => {
    const { service, formRepo, databaseRepo, pageRepo, uow } = makeHarness()

    await expect(service.persistPrepared(prepared())).resolves.toEqual({
      submissionId: SUBMISSION_ID,
      rowId: ROW_ID,
      pageId: ITEM_PAGE_ID,
      endingId: 'server-ending',
      submittedAt: NOW,
      created: true,
    })

    expect(uow.transaction).toHaveBeenCalledTimes(1)
    expect(pageRepo.createItemPageTx).toHaveBeenCalledWith(SOURCE_PAGE_ID, WORKSPACE_ID, ACTOR_ID)
    expect(databaseRepo.createRow).toHaveBeenCalledWith({
      sourceId: SOURCE_ID,
      pageId: ITEM_PAGE_ID,
      position: 1_024,
      createdById: ACTOR_ID,
    })
    expect(databaseRepo.updatePageTitle).toHaveBeenCalledWith(
      ITEM_PAGE_ID,
      'Server title',
      ACTOR_ID,
    )
    expect(databaseRepo.upsertCellValue).toHaveBeenCalledWith(ROW_ID, PROPERTY_ID, 'prepared value')
    expect(formRepo.createSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ endingId: 'server-ending', respondentUserId: ACTOR_ID }),
    )
    expect(formRepo.enqueueFormSubmittedEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        submissionId: SUBMISSION_ID,
        rowId: ROW_ID,
        itemPageId: ITEM_PAGE_ID,
      }),
    )
  })

  it('propagates a null actor only through the focused response page, row, title, and submission paths', async () => {
    const { service, formRepo, databaseRepo, pageRepo } = makeHarness()

    await service.persistPrepared(prepared({ respondentUserId: null }))

    expect(pageRepo.createItemPageTx).toHaveBeenCalledWith(SOURCE_PAGE_ID, WORKSPACE_ID, null)
    expect(databaseRepo.createRow).toHaveBeenCalledWith(
      expect.objectContaining({ createdById: null }),
    )
    expect(databaseRepo.updatePageTitle).toHaveBeenCalledWith(ITEM_PAGE_ID, 'Server title', null)
    expect(formRepo.createSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ respondentUserId: null }),
    )
  })

  it('returns an exact replay without reserving capacity or creating a second page, submission, or outbox', async () => {
    const replay = submission()
    const { service, formRepo, databaseRepo, pageRepo } = makeHarness({
      formRepo: { findSubmissionByIdempotency: vi.fn(async () => replay) },
    })

    await expect(service.persistPrepared(prepared())).resolves.toEqual({
      submissionId: SUBMISSION_ID,
      rowId: ROW_ID,
      pageId: ITEM_PAGE_ID,
      endingId: 'server-ending',
      submittedAt: NOW,
      created: false,
    })

    expect(formRepo.reserveResponseSlot).not.toHaveBeenCalled()
    expect(pageRepo.createItemPageTx).not.toHaveBeenCalled()
    expect(databaseRepo.createRow).not.toHaveBeenCalled()
    expect(formRepo.createSubmission).not.toHaveBeenCalled()
    expect(formRepo.enqueueFormSubmittedEvent).not.toHaveBeenCalled()
  })

  it('admits only one concurrent response for the final slot', async () => {
    let remaining = 1
    const reserveResponseSlot = vi.fn(async () => {
      if (remaining === 0) return false
      remaining -= 1
      return true
    })
    const { service } = makeHarness({ formRepo: { reserveResponseSlot } })

    const [first, second] = await Promise.allSettled([
      service.persistPrepared(prepared()),
      service.persistPrepared(prepared({ idempotencyKey: '00000000-0000-7000-8000-000000000099' })),
    ])

    expect([first, second].filter(({ status }) => status === 'fulfilled')).toHaveLength(1)
    expect([first, second].filter(({ status }) => status === 'rejected')).toHaveLength(1)
    expect(remaining).toBe(0)
  })

  it('leaves the counter, page, row, values, submission, and outbox rolled back after a write failure', async () => {
    const state = { slots: 0, pages: 0, rows: 0, values: 0, submissions: 0, outbox: 0 }
    const uow = {
      transaction: vi.fn(async (run: () => Promise<unknown>) => {
        const before = { ...state }
        try {
          return await run()
        } catch (error) {
          Object.assign(state, before)
          throw error
        }
      }),
      client: vi.fn() as unknown as UnitOfWork['client'],
    } satisfies UnitOfWork
    const { service } = makeHarness({
      uow,
      formRepo: {
        reserveResponseSlot: vi.fn(async () => {
          state.slots += 1
          return true
        }),
        createSubmission: vi.fn(async () => {
          state.submissions += 1
          throw new Error('submission failed')
        }),
        enqueueFormSubmittedEvent: vi.fn(async () => {
          state.outbox += 1
        }),
      },
      pageRepo: {
        createItemPageTx: vi.fn(async () => {
          state.pages += 1
          return { id: ITEM_PAGE_ID }
        }),
      },
      databaseRepo: {
        createRow: vi.fn(async () => {
          state.rows += 1
          return { id: ROW_ID, pageId: ITEM_PAGE_ID, position: 1_024 }
        }),
        updatePageTitle: vi.fn(async () => undefined),
        upsertCellValue: vi.fn(async () => {
          state.values += 1
        }),
      },
    })

    await expect(service.persistPrepared(prepared())).rejects.toThrow('submission failed')
    expect(state).toEqual({ slots: 0, pages: 0, rows: 0, values: 0, submissions: 0, outbox: 0 })
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
})

describe('nullable response actor type boundary', () => {
  it('widens only the focused item-page creation port', () => {
    expectTypeOf<ItemPageCreator['createItemPageTx']>().parameter(2).toEqualTypeOf<string | null>()
    expectTypeOf<PageRepository['createPageTx']>().parameter(0).toEqualTypeOf<string>()
  })
})
