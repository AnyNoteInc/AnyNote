import { createHash } from 'node:crypto'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  FormSubmissionService,
  FormAccessResolver,
  bindOwnResponseUploadToken,
  sealOwnResponseSelection,
  type FormSubmissionRecord,
  type FormVersionRecord,
  type PublicFormRecord,
} from '@repo/domain'
import type { DatabaseRepository, FormRepositoryContract } from '@repo/domain'
import type { UnitOfWork } from '@repo/domain'

import { createFormRouter } from '../src/routers/form'
import { verifyFormOwnResponseToken } from '../src/helpers/form-own-response-token'
import { createCallerFactory } from '../src/trpc'

const USER_ID = '00000000-0000-7000-8000-000000000001'
const OTHER_USER_ID = '00000000-0000-7000-8000-000000000002'
const SUBMISSION_ID = '00000000-0000-7000-8000-000000000003'
const FORM_ID = '00000000-0000-7000-8000-000000000004'
const VERSION_ID = '00000000-0000-7000-8000-000000000005'
const ROW_ID = '00000000-0000-7000-8000-000000000006'
const PAGE_ID = '00000000-0000-7000-8000-000000000007'

afterEach(() => vi.unstubAllEnvs())

const version: FormVersionRecord = {
  id: VERSION_ID,
  formId: FORM_ID,
  versionNumber: 1,
  schemaVersion: 1,
  schema: { schemaVersion: 1 },
  schemaHash: 'a'.repeat(64),
  publishedById: USER_ID,
  publishedAt: new Date('2026-07-16T10:00:00Z'),
  acceptUntil: null,
}

function form(overrides: Partial<PublicFormRecord> = {}): PublicFormRecord {
  return {
    id: FORM_ID,
    sourceId: '00000000-0000-7000-8000-000000000008',
    routeKey: 'anf_public',
    customSlug: null,
    linkRevision: 1,
    state: 'OPEN',
    audience: 'ANYONE_WITH_LINK',
    respondentAccess: 'VIEW',
    publishedVersionId: VERSION_ID,
    opensAt: null,
    closesAt: null,
    responseLimit: null,
    acceptedResponses: 1,
    createdById: USER_ID,
    source: {
      workspaceId: '00000000-0000-7000-8000-000000000009',
      pageId: '00000000-0000-7000-8000-00000000000a',
      page: { archivedAt: null, deletedAt: null },
      workspace: {
        id: '00000000-0000-7000-8000-000000000009',
        securityPolicy: { disablePublicLinksSitesForms: false },
      },
    },
    publishedVersion: version,
    ...overrides,
  }
}

function submission(overrides: Partial<FormSubmissionRecord> = {}): FormSubmissionRecord {
  return {
    id: SUBMISSION_ID,
    formId: FORM_ID,
    versionId: VERSION_ID,
    rowId: ROW_ID,
    respondentUserId: USER_ID,
    endingId: 'ending',
    idempotencyKey: '00000000-0000-7000-8000-00000000000b',
    submittedAt: new Date('2026-07-16T10:01:00Z'),
    row: { pageId: PAGE_ID },
    ...overrides,
  }
}

function makeCaller(userId: string | null, ownResponse?: Record<string, unknown>) {
  const defaultOwnResponse = {
    status: 'VIEW' as const,
    revision: 'b'.repeat(64),
    versionNumber: 1,
    versionFingerprint: 'a'.repeat(64),
    version: {
      schemaVersion: 1,
      firstSectionId: 'main',
      presentation: {
        title: 'Форма',
        submitButtonText: 'Отправить',
        hideAnyNoteBranding: false,
      },
      sections: [],
      questions: [],
      transitions: [],
      endings: [],
    },
    answers: {},
    files: {},
  }
  const getOwnResponse = vi.fn(async () => ownResponse ?? defaultOwnResponse)
  const updateOwnResponse = vi.fn(async () => ({ status: 'UPDATED' as const }))
  const router = createFormRouter({
    domain: {
      database: { listRows: vi.fn() },
      formAccess: { resolvePublished: vi.fn(), resolveVersion: vi.fn() },
      formSubmissions: {
        findReplay: vi.fn(),
        submit: vi.fn(),
        getOwnResponse,
        updateOwnResponse,
      },
    } as never,
  })
  const api = createCallerFactory(router)({
    prisma: {} as never,
    user:
      userId === null
        ? null
        : ({
            id: userId,
            email: 'respondent@example.test',
            firstName: 'Response',
            lastName: 'Owner',
            emailVerified: true,
          } as never),
    headers: new Headers(),
    resHeaders: new Headers(),
    yookassa: {} as never,
    returnUrlBase: 'http://localhost',
    jobs: { kick: vi.fn() },
  })
  return { api, getOwnResponse, updateOwnResponse }
}

describe('database form own-response API', () => {
  it('requires authentication for reading an own response', async () => {
    const { api, getOwnResponse } = makeCaller(null)

    await expect(
      (api as never as { getOwnResponse(input: unknown): Promise<unknown> }).getOwnResponse({
        locator: 'anf_public',
        submissionId: SUBMISSION_ID,
      }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    expect(getOwnResponse).not.toHaveBeenCalled()
  })

  it('passes only the authenticated actor and public identifiers to the authority service', async () => {
    const { api, getOwnResponse } = makeCaller(USER_ID)

    await expect(
      (api as never as { getOwnResponse(input: unknown): Promise<unknown> }).getOwnResponse({
        locator: 'anf_public',
        submissionId: SUBMISSION_ID,
      }),
    ).resolves.toMatchObject({ status: 'VIEW', questionTokens: {} })
    expect(getOwnResponse).toHaveBeenCalledWith(USER_ID, {
      locator: 'anf_public',
      submissionId: SUBMISSION_ID,
    })
  })

  it('passes an exact edit envelope and clear confirmation to the domain service', async () => {
    const { api, updateOwnResponse } = makeCaller(OTHER_USER_ID)
    const input = {
      locator: 'anf_public',
      submissionId: SUBMISSION_ID,
      expectedRevision: 'b'.repeat(64),
      answers: { 'q-name': 'Обновлено' },
      confirmClearUnreachable: true,
    }

    await expect(
      (api as never as { updateOwnResponse(input: unknown): Promise<unknown> }).updateOwnResponse(
        input,
      ),
    ).resolves.toEqual({ status: 'UPDATED' })
    expect(updateOwnResponse).toHaveBeenCalledWith(OTHER_USER_ID, input)
  })

  it('issues a question-bound own-response token for FILE editing without exposing internals', async () => {
    const secret = 'own-response-router-token-secret-at-least-32-bytes'
    vi.stubEnv('FORM_TOKEN_SECRET', secret)
    const ownResponse = {
      status: 'EDIT',
      revision: 'b'.repeat(64),
      versionNumber: 1,
      versionFingerprint: 'a'.repeat(64),
      version: {
        schemaVersion: 1,
        firstSectionId: 'main',
        presentation: {
          title: 'Форма',
          submitButtonText: 'Сохранить',
          hideAnyNoteBranding: false,
        },
        sections: [{ id: 'main', title: 'Файлы', questionIds: ['files'] }],
        questions: [
          {
            id: 'files',
            sectionId: 'main',
            label: 'Файлы',
            required: false,
            syncWithPropertyName: false,
            valueType: 'FILE',
            input: {
              kind: 'FILE',
              allowedMimeTypes: ['text/plain'],
              maxBytesPerFile: 1_024,
              maxFiles: 2,
            },
            available: true,
          },
        ],
        transitions: [],
        endings: [],
      },
      answers: { files: [] },
      files: { files: [] },
    }
    const { api } = makeCaller(USER_ID, ownResponse)

    const result = await api.getOwnResponse({ locator: 'anf_public', submissionId: SUBMISSION_ID })
    const token = result.questionTokens.files
    expect(token).toEqual(expect.any(String))
    expect(verifyFormOwnResponseToken(token!, secret)).toMatchObject({
      submissionId: SUBMISSION_ID,
      actorUserId: USER_ID,
      versionNumber: 1,
      schemaHash: 'a'.repeat(64),
      questionId: 'files',
    })
    expect(JSON.stringify(result)).not.toContain(FORM_ID)
  })

  it('applies the public answer-count and serialized-size bounds before own-response update', async () => {
    const { api, updateOwnResponse } = makeCaller(USER_ID)
    const base = {
      locator: 'anf_public',
      submissionId: SUBMISSION_ID,
      expectedRevision: 'b'.repeat(64),
    }
    await expect(
      api.updateOwnResponse({
        ...base,
        answers: Object.fromEntries(
          Array.from({ length: 501 }, (_, index) => [`q-${index}`, 'value']),
        ),
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(
      api.updateOwnResponse({
        ...base,
        answers: { text: 'x'.repeat(1_048_576) },
      }),
    ).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' })
    expect(updateOwnResponse).not.toHaveBeenCalled()
  })
})

describe('own-response authority resolution', () => {
  function resolver(
    storedForm: PublicFormRecord | null,
    storedSubmission: FormSubmissionRecord | null = submission(),
  ) {
    const ownSubmission =
      storedSubmission === null
        ? null
        : {
            ...storedSubmission,
            version,
            row: {
              pageId: storedSubmission.row.pageId,
              deletedAt: null,
              page: { title: 'Ответ', files: [] },
              cells: [],
              relationLinks: [],
            },
          }
    return new FormAccessResolver(
      {
        findByLocator: vi.fn(async () => storedForm),
        findVersion: vi.fn(async () => version),
        findOwnResponseSubmission: vi.fn(async () => ownSubmission),
      } as never,
      { assertMembership: vi.fn() } as never,
    ) as FormAccessResolver & {
      resolveOwnResponse(
        locator: string,
        submissionId: string,
        actorUserId: string | null,
      ): Promise<{ status: string }>
    }
  }

  it.each([
    ['anonymous actor', form(), submission(), null],
    ['another owner', form(), submission(), OTHER_USER_ID],
    ['NONE access', form({ respondentAccess: 'NONE' }), submission(), USER_ID],
    ['archived form', form({ state: 'ARCHIVED' }), submission(), USER_ID],
    [
      'workspace public-link policy disabled',
      form({
        source: {
          ...form().source,
          workspace: {
            ...form().source.workspace,
            securityPolicy: { disablePublicLinksSitesForms: true },
          },
        },
      }),
      submission(),
      USER_ID,
    ],
    ['submission from another form', form(), submission({ formId: OTHER_USER_ID }), USER_ID],
  ])('returns one unavailable state for %s', async (_name, storedForm, storedSubmission, actor) => {
    await expect(
      resolver(
        storedForm as PublicFormRecord,
        storedSubmission as FormSubmissionRecord,
      ).resolveOwnResponse('anf_public', SUBMISSION_ID, actor as string | null),
    ).resolves.toEqual({ status: 'UNAVAILABLE' })
  })

  it.each([
    ['VIEW', 'OPEN'],
    ['EDIT', 'OPEN'],
    ['VIEW', 'CLOSED'],
    ['EDIT', 'CLOSED'],
  ] as const)('keeps %s own-response access while the form is %s', async (access, state) => {
    await expect(
      resolver(form({ respondentAccess: access, state })).resolveOwnResponse(
        'anf_public',
        SUBMISSION_ID,
        USER_ID,
      ),
    ).resolves.toMatchObject({ status: access, locator: 'anf_public' })
  })
})

describe('own-response read and edit semantics', () => {
  const TEXT_PROPERTY_ID = '00000000-0000-7000-8000-000000000011'
  const REMOVED_PROPERTY_ID = '00000000-0000-7000-8000-000000000012'
  const DETAILS_PROPERTY_ID = '00000000-0000-7000-8000-000000000013'
  const SECRET = 'own-response-test-secret-at-least-thirty-two-bytes'

  const document = {
    schemaVersion: 1,
    firstSectionId: 'main',
    presentation: {
      title: 'Форма',
      submitButtonText: 'Сохранить',
      hideAnyNoteBranding: false,
    },
    sections: [
      { id: 'main', title: 'Основное', questionIds: ['title', 'choice', 'removed'] },
      { id: 'details', title: 'Детали', questionIds: ['details'] },
    ],
    questions: [
      {
        id: 'title',
        sectionId: 'main',
        property: { kind: 'TITLE' },
        label: 'Название',
        required: false,
        syncWithPropertyName: false,
        input: { kind: 'TEXT', multiline: false, maxLength: 200 },
      },
      {
        id: 'choice',
        sectionId: 'main',
        property: { kind: 'PROPERTY', propertyId: TEXT_PROPERTY_ID, propertyType: 'SELECT' },
        label: 'Нужны детали?',
        required: true,
        syncWithPropertyName: false,
        input: {
          kind: 'SINGLE_CHOICE',
          appearance: 'RADIO',
          options: [
            { id: 'yes', label: 'Да' },
            { id: 'no', label: 'Нет' },
          ],
        },
      },
      {
        id: 'removed',
        sectionId: 'main',
        property: { kind: 'PROPERTY', propertyId: REMOVED_PROPERTY_ID, propertyType: 'TEXT' },
        label: 'Удалено',
        required: true,
        syncWithPropertyName: false,
        input: { kind: 'TEXT', multiline: false, maxLength: 200 },
      },
      {
        id: 'details',
        sectionId: 'details',
        property: { kind: 'PROPERTY', propertyId: DETAILS_PROPERTY_ID, propertyType: 'TEXT' },
        label: 'Детали',
        required: false,
        syncWithPropertyName: false,
        input: { kind: 'TEXT', multiline: true, maxLength: 2_000 },
      },
    ],
    transitions: [
      {
        id: 'to-details',
        fromSectionId: 'main',
        priority: 0,
        when: {
          kind: 'ALL',
          members: [{ questionId: 'choice', kind: 'OPTION_IS', optionId: 'yes' }],
        },
        target: { kind: 'SECTION', sectionId: 'details' },
      },
      {
        id: 'skip-details',
        fromSectionId: 'main',
        priority: 1,
        when: null,
        target: { kind: 'ENDING', endingId: 'done' },
      },
      {
        id: 'finish',
        fromSectionId: 'details',
        priority: 0,
        when: null,
        target: { kind: 'ENDING', endingId: 'done' },
      },
    ],
    endings: [{ id: 'done', title: 'Готово' }],
  }

  function semanticHarness(access: 'VIEW' | 'EDIT' = 'EDIT') {
    const storedVersion = { ...version, schema: document, schemaHash: 'c'.repeat(64) }
    const storedForm = form({
      respondentAccess: access,
      publishedVersion: storedVersion,
      publishedVersionId: storedVersion.id,
    })
    const ownSubmission = {
      ...submission(),
      version: storedVersion,
      row: {
        pageId: PAGE_ID,
        deletedAt: null,
        updatedAt: new Date('2026-07-16T10:02:00Z'),
        page: { title: 'Первый ответ', files: [] },
        cells: [
          { propertyId: TEXT_PROPERTY_ID, value: 'yes' },
          { propertyId: DETAILS_PROPERTY_ID, value: 'Старые детали' },
          { propertyId: REMOVED_PROPERTY_ID, value: 'Скрытое значение' },
        ],
        relationLinks: [],
      },
    }
    const resolution = {
      status: access,
      locator: 'anf_public',
      form: storedForm,
      version: storedVersion,
      submission: ownSubmission,
      respondentUserId: USER_ID,
    }
    const transaction = vi.fn(async (run: () => Promise<unknown>) => run())
    const uow = { transaction, client: vi.fn() } as never as UnitOfWork
    const formRepo = {
      lockOwnResponseContext: vi.fn(async () => true),
      lockFormSubmissionAuthorities: vi.fn(async () => true),
      resolveUploadLeasesBatch: vi.fn(async () => []),
      consumeUploadLeases: vi.fn(async () => undefined),
      detachPageFiles: vi.fn(async () => undefined),
      touchOwnResponseRow: vi.fn(async () => undefined),
    } as never as FormRepositoryContract
    const databaseRepo = {
      listProperties: vi.fn(async () => [
        {
          id: TEXT_PROPERTY_ID,
          type: 'SELECT',
          name: 'Нужны детали?',
          position: 1,
          settings: {
            options: [
              { id: 'yes', label: 'Да' },
              { id: 'no', label: 'Нет' },
            ],
          },
        },
        { id: DETAILS_PROPERTY_ID, type: 'TEXT', name: 'Детали', position: 2, settings: null },
      ]),
      findActiveWorkspaceMemberIds: vi.fn(async () => new Set()),
      findSourceMetasByIds: vi.fn(async () => new Map()),
      findRowsAccessMetaByIds: vi.fn(async () => []),
      findEnabledAccessRulesForSources: vi.fn(async () => new Map()),
      findWorkspaceRole: vi.fn(async () => null),
      findSourcePageIdsCreatedBy: vi.fn(async () => new Set()),
      findItemPageShareLevels: vi.fn(async () => new Map()),
      isWorkspaceMember: vi.fn(async () => true),
      findUserNames: vi.fn(async () => new Map()),
      findPageLabelsByIds: vi.fn(async () => new Map()),
      findRowsByIds: vi.fn(async (ids: string[]) =>
        ids.map((id) => ({ id, pageId: PAGE_ID, title: `Строка ${id}`, icon: null })),
      ),
      upsertCellValue: vi.fn(async () => undefined),
      upsertFileCellValue: vi.fn(async () => undefined),
      replaceRelationLinks: vi.fn(async () => undefined),
      findRelationLinks: vi.fn(async () => new Map()),
      updatePageTitle: vi.fn(async () => undefined),
    } as never as DatabaseRepository
    const pageRepo = {
      findAccessiblePageLinkIds: vi.fn(async () => new Set()),
      findAccessiblePageIds: vi.fn(async () => new Set()),
      findSubmissionAuthorityPageMetadata: vi.fn(
        async () =>
          new Map([
            [
              storedForm.source.pageId,
              { collectionId: null, parentCollectionId: null, parentId: null },
            ],
          ]),
      ),
    }
    const formAccess = {
      resolveOwnResponse: vi.fn(async () => resolution),
    }
    const service = new FormSubmissionService(
      formRepo,
      databaseRepo,
      pageRepo as never,
      uow,
      formAccess as never,
      () => new Date('2026-07-16T10:03:00Z'),
      () => SECRET,
    )
    return { service, formRepo, databaseRepo, formAccess, pageRepo, resolution }
  }

  it('returns submitted-version labels and values while marking a deleted property unavailable', async () => {
    const { service } = semanticHarness('VIEW')

    const response = await service.getOwnResponse(USER_ID, {
      locator: 'anf_public',
      submissionId: SUBMISSION_ID,
    })

    expect(response.status).toBe('VIEW')
    expect(response.answers).toEqual({
      title: 'Первый ответ',
      choice: 'yes',
      details: 'Старые детали',
    })
    expect(response.version.questions.find(({ id }) => id === 'removed')).toMatchObject({
      label: 'Удалено',
      available: false,
    })
    expect(JSON.stringify(response)).not.toContain(REMOVED_PROPERTY_ID)
    expect(response.revision).toMatch(/^[a-f0-9]{64}$/u)
  })

  it('preserves a branch selected by a deleted controller without exposing its value', async () => {
    const { service, databaseRepo } = semanticHarness('VIEW')
    vi.mocked(databaseRepo.listProperties).mockResolvedValue([
      { id: DETAILS_PROPERTY_ID, type: 'TEXT', name: 'Детали', position: 2, settings: null },
    ])

    const response = await service.getOwnResponse(USER_ID, {
      locator: 'anf_public',
      submissionId: SUBMISSION_ID,
    })

    expect(response.answers).not.toHaveProperty('choice')
    expect(response.version.sections.find(({ id }) => id === 'main')?.questionIds).toContain(
      'choice',
    )
    expect(response.version.questions.find(({ id }) => id === 'choice')).toMatchObject({
      available: false,
    })
    expect(response.version.transitions).toContainEqual(
      expect.objectContaining({ id: 'to-details', when: null }),
    )
    expect(response.version.transitions).not.toContainEqual(
      expect.objectContaining({ id: 'skip-details' }),
    )
    expect(JSON.stringify(response.version)).not.toContain('"questionId":"choice"')
  })

  it('rejects forged question keys through the shared dynamic server schema', async () => {
    const { service } = semanticHarness()
    const current = await service.getOwnResponse(USER_ID, {
      locator: 'anf_public',
      submissionId: SUBMISSION_ID,
    })

    await expect(
      service.updateOwnResponse(USER_ID, {
        locator: 'anf_public',
        submissionId: SUBMISSION_ID,
        expectedRevision: current.revision,
        answers: { title: 'Ответ', choice: 'yes', details: 'Ок', forged: 'internal' },
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('requires explicit confirmation before clearing a newly unreachable stored answer', async () => {
    const { service, databaseRepo, formRepo } = semanticHarness()
    const current = await service.getOwnResponse(USER_ID, {
      locator: 'anf_public',
      submissionId: SUBMISSION_ID,
    })
    const input = {
      locator: 'anf_public',
      submissionId: SUBMISSION_ID,
      expectedRevision: current.revision,
      answers: { title: 'Ответ', choice: 'no' },
    }

    await expect(service.updateOwnResponse(USER_ID, input)).resolves.toEqual({
      status: 'CONFIRM_CLEAR_REQUIRED',
      questionIds: ['details'],
    })
    expect(databaseRepo.upsertCellValue).not.toHaveBeenCalled()
    expect(formRepo.consumeUploadLeases).not.toHaveBeenCalled()

    await expect(
      service.updateOwnResponse(USER_ID, { ...input, confirmClearUnreachable: true }),
    ).resolves.toMatchObject({ status: 'UPDATED' })
    expect(databaseRepo.upsertCellValue).toHaveBeenCalledWith(ROW_ID, DETAILS_PROPERTY_ID, null)
  })

  it('returns uniform not-found when VIEW access attempts an edit', async () => {
    const { service } = semanticHarness('VIEW')
    const current = await service.getOwnResponse(USER_ID, {
      locator: 'anf_public',
      submissionId: SUBMISSION_ID,
    })
    await expect(
      service.updateOwnResponse(USER_ID, {
        locator: 'anf_public',
        submissionId: SUBMISSION_ID,
        expectedRevision: current.revision,
        answers: {},
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'FORM_RESPONSE_NOT_FOUND' })
  })

  it('rebuilds the authority snapshot after locking and rejects a TOCTOU change', async () => {
    const { service, pageRepo, databaseRepo } = semanticHarness()
    const current = await service.getOwnResponse(USER_ID, {
      locator: 'anf_public',
      submissionId: SUBMISSION_ID,
    })
    let authorityReads = 0
    vi.mocked(pageRepo.findSubmissionAuthorityPageMetadata).mockImplementation(async () => {
      authorityReads += 1
      return new Map([
        [
          form().source.pageId,
          {
            collectionId: authorityReads >= 3 ? '00000000-0000-7000-8000-000000000030' : null,
            parentCollectionId: null,
            parentId: null,
          },
        ],
      ])
    })

    await expect(
      service.updateOwnResponse(USER_ID, {
        locator: 'anf_public',
        submissionId: SUBMISSION_ID,
        expectedRevision: current.revision,
        answers: { title: 'Ответ', choice: 'yes', details: 'Обновлено' },
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT', message: 'FORM_RESPONSE_CHANGED' })
    expect(databaseRepo.upsertCellValue).not.toHaveBeenCalled()
  })

  it('marks a type-drifted property unavailable and reflects current owner edits on every VIEW', async () => {
    const { service, databaseRepo, resolution } = semanticHarness('VIEW')
    vi.mocked(databaseRepo.listProperties).mockResolvedValue([
      { id: TEXT_PROPERTY_ID, type: 'TEXT', name: 'Изменено', position: 1, settings: null },
      { id: DETAILS_PROPERTY_ID, type: 'TEXT', name: 'Детали', position: 2, settings: null },
    ])

    const first = await service.getOwnResponse(USER_ID, {
      locator: 'anf_public',
      submissionId: SUBMISSION_ID,
    })
    expect(first.version.questions.find(({ id }) => id === 'choice')?.available).toBe(false)
    expect(first.answers).not.toHaveProperty('choice')

    resolution.submission.row.page.title = 'Изменено владельцем'
    resolution.submission.row.cells = [
      ...resolution.submission.row.cells.filter(
        ({ propertyId }) => propertyId !== DETAILS_PROPERTY_ID,
      ),
      { propertyId: DETAILS_PROPERTY_ID, value: 'Новое значение владельца' },
    ]
    const second = await service.getOwnResponse(USER_ID, {
      locator: 'anf_public',
      submissionId: SUBMISSION_ID,
    })
    expect(second.answers).toMatchObject({
      title: 'Изменено владельцем',
      details: 'Новое значение владельца',
    })
    expect(second.revision).not.toBe(first.revision)
  })

  it('rejects attempts to submit a value for an unavailable question', async () => {
    const { service } = semanticHarness()
    const current = await service.getOwnResponse(USER_ID, {
      locator: 'anf_public',
      submissionId: SUBMISSION_ID,
    })
    await expect(
      service.updateOwnResponse(USER_ID, {
        locator: 'anf_public',
        submissionId: SUBMISSION_ID,
        expectedRevision: current.revision,
        answers: {
          title: 'Ответ',
          choice: 'yes',
          details: 'Ок',
          removed: 'Подмена',
        },
      }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      fieldErrors: { removed: ['FORM_FIELD_UNAVAILABLE'] },
    })
  })

  it('revalidates relation targets, maintains mirror links and atomically replaces retained files', async () => {
    const RELATION_PROPERTY_ID = '00000000-0000-7000-8000-000000000021'
    const BACK_PROPERTY_ID = '00000000-0000-7000-8000-000000000022'
    const FILE_PROPERTY_ID = '00000000-0000-7000-8000-000000000023'
    const TARGET_SOURCE_ID = '00000000-0000-7000-8000-000000000024'
    const TARGET_SOURCE_PAGE_ID = '00000000-0000-7000-8000-000000000025'
    const OLD_TARGET_ID = '00000000-0000-7000-8000-000000000026'
    const NEW_TARGET_ID = '00000000-0000-7000-8000-000000000027'
    const TARGET_PAGE_ID = '00000000-0000-7000-8000-000000000028'
    const OLD_FILE_ID = '00000000-0000-7000-8000-000000000029'
    const NEW_FILE_ID = '00000000-0000-7000-8000-00000000002a'
    const UPLOAD_ID = '00000000-0000-7000-8000-00000000002b'
    const leaseToken = bindOwnResponseUploadToken('new-file-lease-token', SECRET, {
      formId: FORM_ID,
      versionId: VERSION_ID,
      questionId: 'files',
      submissionId: SUBMISSION_ID,
      actorUserId: USER_ID,
    })
    const specialDocument = {
      ...document,
      sections: [{ id: 'main', title: 'Основное', questionIds: ['relation', 'files'] }],
      questions: [
        {
          id: 'relation',
          sectionId: 'main',
          property: {
            kind: 'PROPERTY',
            propertyId: RELATION_PROPERTY_ID,
            propertyType: 'RELATION',
          },
          label: 'Связь',
          required: false,
          syncWithPropertyName: false,
          input: { kind: 'RELATION', maxSelections: 5 },
        },
        {
          id: 'files',
          sectionId: 'main',
          property: {
            kind: 'PROPERTY',
            propertyId: FILE_PROPERTY_ID,
            propertyType: 'FILE',
          },
          label: 'Файлы',
          required: false,
          syncWithPropertyName: false,
          input: {
            kind: 'FILE',
            allowedMimeTypes: ['text/plain'],
            maxBytesPerFile: 1_024,
            maxFiles: 3,
          },
        },
      ],
      transitions: [
        {
          id: 'finish',
          fromSectionId: 'main',
          priority: 0,
          when: null,
          target: { kind: 'ENDING', endingId: 'done' },
        },
      ],
    }
    const { service, databaseRepo, formRepo, pageRepo, resolution } = semanticHarness()
    resolution.version.schema = specialDocument
    if (resolution.form.publishedVersion !== null) {
      resolution.form.publishedVersion.schema = specialDocument
    }
    resolution.submission.version.schema = specialDocument
    resolution.submission.row.cells = [{ propertyId: FILE_PROPERTY_ID, value: [OLD_FILE_ID] }]
    resolution.submission.row.relationLinks = [
      { propertyId: RELATION_PROPERTY_ID, targetRowId: OLD_TARGET_ID },
    ]
    resolution.submission.row.page.files = [
      {
        fileId: OLD_FILE_ID,
        file: {
          name: 'old.txt',
          mimeType: 'text/plain',
          fileSize: 100n,
          status: 'ACTIVE',
        },
      },
    ]
    vi.mocked(databaseRepo.listProperties).mockResolvedValue([
      {
        id: RELATION_PROPERTY_ID,
        type: 'RELATION',
        name: 'Связь',
        position: 1,
        settings: {
          relation: { targetSourceId: TARGET_SOURCE_ID, backRelationPropertyId: BACK_PROPERTY_ID },
        },
      },
      { id: FILE_PROPERTY_ID, type: 'FILE', name: 'Файлы', position: 2, settings: null },
    ])
    vi.mocked(databaseRepo.findSourceMetasByIds).mockResolvedValue(
      new Map([
        [
          TARGET_SOURCE_ID,
          {
            id: TARGET_SOURCE_ID,
            workspaceId: form().source.workspaceId,
            pageId: TARGET_SOURCE_PAGE_ID,
          },
        ],
      ]),
    )
    vi.mocked(databaseRepo.findRowsAccessMetaByIds).mockImplementation(async (ids) =>
      ids.map((id) => ({
        id,
        sourceId: TARGET_SOURCE_ID,
        workspaceId: form().source.workspaceId,
        pageId: TARGET_PAGE_ID,
        createdById: USER_ID,
        cellsByProperty: new Map(),
      })),
    )
    vi.mocked(databaseRepo.findWorkspaceRole).mockResolvedValue('VIEWER')
    vi.mocked(databaseRepo.findRelationLinks).mockImplementation(async (propertyId) => {
      if (propertyId === RELATION_PROPERTY_ID) return new Map([[ROW_ID, [OLD_TARGET_ID]]])
      return new Map([
        [OLD_TARGET_ID, [ROW_ID]],
        [NEW_TARGET_ID, []],
      ])
    })
    vi.mocked(pageRepo.findAccessiblePageIds).mockResolvedValue(
      new Set([TARGET_SOURCE_PAGE_ID, TARGET_PAGE_ID]),
    )
    vi.mocked(pageRepo.findSubmissionAuthorityPageMetadata).mockResolvedValue(
      new Map(
        [resolution.form.source.pageId, TARGET_SOURCE_PAGE_ID, TARGET_PAGE_ID].map((pageId) => [
          pageId,
          { collectionId: null, parentCollectionId: null, parentId: null },
        ]),
      ),
    )
    vi.mocked(formRepo.resolveUploadLeasesBatch).mockResolvedValue([
      {
        id: UPLOAD_ID,
        formId: FORM_ID,
        versionId: VERSION_ID,
        questionId: 'files',
        fileId: NEW_FILE_ID,
        uploadTokenHash: createHash('sha256').update(leaseToken).digest('hex'),
        expiresAt: new Date('2026-07-17T10:00:00Z'),
        consumedAt: null,
        file: {
          workspaceId: resolution.form.source.workspaceId,
          status: 'PENDING',
          mimeType: 'text/plain',
          fileSize: 200n,
        },
      },
    ])

    const current = await service.getOwnResponse(USER_ID, {
      locator: 'anf_public',
      submissionId: SUBMISSION_ID,
    })
    const retainedHandle = current.files.files?.[0]?.handle
    const newTargetToken = sealOwnResponseSelection(NEW_TARGET_ID, SECRET, {
      locator: 'anf_public',
      submissionId: SUBMISSION_ID,
      actorUserId: USER_ID,
      versionId: VERSION_ID,
      questionId: 'relation',
      kind: 'RELATION',
    })
    expect(retainedHandle).toMatch(/^rf_/u)
    expect(JSON.stringify(current)).not.toContain(OLD_FILE_ID)

    const crossOwnerToken = bindOwnResponseUploadToken('cross-owner-token', SECRET, {
      formId: FORM_ID,
      versionId: VERSION_ID,
      questionId: 'files',
      submissionId: SUBMISSION_ID,
      actorUserId: OTHER_USER_ID,
    })
    await expect(
      service.updateOwnResponse(USER_ID, {
        locator: 'anf_public',
        submissionId: SUBMISSION_ID,
        expectedRevision: current.revision,
        answers: { relation: [newTargetToken], files: [crossOwnerToken] },
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(formRepo.resolveUploadLeasesBatch).not.toHaveBeenCalled()

    await expect(
      service.updateOwnResponse(USER_ID, {
        locator: 'anf_public',
        submissionId: SUBMISSION_ID,
        expectedRevision: current.revision,
        answers: { relation: [newTargetToken], files: [leaseToken] },
      }),
    ).resolves.toMatchObject({ status: 'UPDATED' })

    expect(formRepo.consumeUploadLeases).toHaveBeenCalledWith(
      expect.objectContaining({
        pageId: PAGE_ID,
        uploads: [expect.objectContaining({ id: UPLOAD_ID })],
      }),
    )
    expect(formRepo.detachPageFiles).toHaveBeenCalledWith(PAGE_ID, [OLD_FILE_ID])
    expect(databaseRepo.upsertFileCellValue).toHaveBeenCalledWith(ROW_ID, FILE_PROPERTY_ID, [
      NEW_FILE_ID,
    ])
    expect(databaseRepo.replaceRelationLinks).toHaveBeenCalledWith({
      propertyId: RELATION_PROPERTY_ID,
      rowId: ROW_ID,
      targetRowIds: [NEW_TARGET_ID],
    })
    expect(databaseRepo.replaceRelationLinks).toHaveBeenCalledWith({
      propertyId: BACK_PROPERTY_ID,
      rowId: OLD_TARGET_ID,
      targetRowIds: [],
    })
    expect(databaseRepo.replaceRelationLinks).toHaveBeenCalledWith({
      propertyId: BACK_PROPERTY_ID,
      rowId: NEW_TARGET_ID,
      targetRowIds: [ROW_ID],
    })
  })
})
