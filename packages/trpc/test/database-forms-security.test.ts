import { createHash } from 'node:crypto'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  conflict,
  DatabaseFormRepository,
  forbidden,
  FormAccessResolver,
  FormValidationError,
  notFound,
  type FormVersionDocument,
  type FormVersionRecord,
  type PublicFormRecord,
} from '@repo/domain'
import {
  buildFormAnswerSchema,
  evaluateFormPath,
  toPublicFormVersion,
} from '@repo/domain/database/forms'

import { verifyFormCaptcha } from '../src/helpers/form-captcha'
import { signFormOwnResponseToken } from '../src/helpers/form-own-response-token'
import {
  assertFormVersionContext,
  hashFormLocator,
  signFormVersionToken,
  type FormVersionTokenPayload,
} from '../src/helpers/form-version-token'
import { createFormRouter } from '../src/routers/form'
import { createCallerFactory } from '../src/trpc'

const NOW = Date.UTC(2026, 6, 16, 12)
const NOW_DATE = new Date(NOW)
const SECRET = 'task-16-adversarial-form-secret-32-bytes'
const USER_ID = '00000000-0000-7000-8000-000000000001'
const OUTSIDER_ID = '00000000-0000-7000-8000-000000000002'
const WORKSPACE_ID = '00000000-0000-7000-8000-000000000003'
const SOURCE_ID = '00000000-0000-7000-8000-000000000004'
const SOURCE_PAGE_ID = '00000000-0000-7000-8000-000000000005'
const FORM_ID = '00000000-0000-7000-8000-000000000006'
const VERSION_ID = '00000000-0000-7000-8000-000000000007'
const PROPERTY_ID = '00000000-0000-7000-8000-000000000008'
const HIDDEN_PROPERTY_ID = '00000000-0000-7000-8000-000000000009'
const PERSON_PROPERTY_ID = '00000000-0000-7000-8000-00000000000a'
const SUBMISSION_ID = '00000000-0000-7000-8000-00000000000b'
const ROW_ID = '00000000-0000-7000-8000-00000000000c'
const FILE_ID = '00000000-0000-7000-8000-00000000000d'
const UPLOAD_ID = '00000000-0000-7000-8000-00000000000e'
const IDEMPOTENCY_KEY = '00000000-0000-7000-8000-00000000000f'

const document: FormVersionDocument = {
  schemaVersion: 1,
  firstSectionId: 'main',
  presentation: {
    title: 'Security form',
    submitButtonText: 'Submit',
    hideAnyNoteBranding: false,
  },
  sections: [
    {
      id: 'main',
      title: 'Questions',
      questionIds: ['main-answer', 'hidden-answer', 'person'],
    },
  ],
  questions: [
    {
      id: 'main-answer',
      sectionId: 'main',
      property: { kind: 'PROPERTY', propertyId: PROPERTY_ID, propertyType: 'TEXT' },
      label: 'Main answer',
      required: true,
      syncWithPropertyName: false,
      input: { kind: 'TEXT', multiline: false, maxLength: 200 },
    },
    {
      id: 'hidden-answer',
      sectionId: 'main',
      property: { kind: 'PROPERTY', propertyId: HIDDEN_PROPERTY_ID, propertyType: 'TEXT' },
      label: 'Hidden answer',
      required: false,
      syncWithPropertyName: false,
      visibleWhen: {
        kind: 'ALL',
        members: [{ kind: 'TEXT_EQUALS', questionId: 'main-answer', value: 'show' }],
      },
      input: { kind: 'TEXT', multiline: false, maxLength: 200 },
    },
    {
      id: 'person',
      sectionId: 'main',
      property: { kind: 'PROPERTY', propertyId: PERSON_PROPERTY_ID, propertyType: 'PERSON' },
      label: 'Person',
      required: false,
      syncWithPropertyName: false,
      input: { kind: 'PERSON', maxSelections: 1 },
    },
  ],
  transitions: [
    {
      id: 'special',
      fromSectionId: 'main',
      priority: 0,
      when: {
        kind: 'ALL',
        members: [{ kind: 'TEXT_EQUALS', questionId: 'main-answer', value: 'special' }],
      },
      target: { kind: 'ENDING', endingId: 'special-ending' },
    },
    {
      id: 'default',
      fromSectionId: 'main',
      priority: 1,
      when: null,
      target: { kind: 'ENDING', endingId: 'default-ending' },
    },
  ],
  endings: [
    { id: 'default-ending', title: 'Done' },
    { id: 'special-ending', title: 'Special' },
  ],
}

const schemaHash = createHash('sha256').update(JSON.stringify(document)).digest('hex')

function formVersion(overrides: Partial<FormVersionRecord> = {}): FormVersionRecord {
  return {
    id: VERSION_ID,
    formId: FORM_ID,
    versionNumber: 1,
    schemaVersion: 1,
    schema: document,
    schemaHash,
    publishedById: USER_ID,
    publishedAt: new Date(NOW - 60_000),
    acceptUntil: null,
    ...overrides,
  }
}

function publicForm(overrides: Partial<PublicFormRecord> = {}): PublicFormRecord {
  const version = formVersion()
  return {
    id: FORM_ID,
    sourceId: SOURCE_ID,
    routeKey: 'anf_security-key',
    customSlug: 'security-form',
    linkRevision: 1,
    state: 'OPEN',
    audience: 'ANYONE_WITH_LINK',
    respondentAccess: 'EDIT',
    publishedVersionId: version.id,
    opensAt: null,
    closesAt: null,
    responseLimit: null,
    acceptedResponses: 0,
    createdById: USER_ID,
    source: {
      workspaceId: WORKSPACE_ID,
      pageId: SOURCE_PAGE_ID,
      page: { archivedAt: null, deletedAt: null },
      workspace: {
        id: WORKSPACE_ID,
        securityPolicy: { disablePublicLinksSitesForms: false },
      },
    },
    publishedVersion: version,
    ...overrides,
  }
}

function tokenFor(
  version: FormVersionRecord = formVersion(),
  overrides: Partial<FormVersionTokenPayload> = {},
): string {
  return signFormVersionToken(
    {
      locatorHash: hashFormLocator('anf_security-key'),
      versionNumber: version.versionNumber,
      schemaHash: version.schemaHash,
      linkRevision: 1,
      issuedAt: NOW - 1_000,
      expiresAt: NOW + 60_000,
      ...overrides,
    },
    SECRET,
  )
}

function accessHarness(initialForm: PublicFormRecord | null = publicForm()) {
  let storedForm = initialForm
  const versions = new Map<number, FormVersionRecord>()
  if (storedForm?.publishedVersion) {
    versions.set(storedForm.publishedVersion.versionNumber, storedForm.publishedVersion)
  }
  const repo = {
    findByLocator: vi.fn(async (locator: string) => {
      if (
        storedForm !== null &&
        (locator === storedForm.routeKey || locator === storedForm.customSlug)
      ) {
        return storedForm
      }
      return null
    }),
    findVersion: vi.fn(async (formId: string, versionNumber: number) => {
      const version = versions.get(versionNumber)
      return version?.formId === formId ? version : null
    }),
    findOwnResponseSubmission: vi.fn(async () => null),
  }
  const workspace = {
    assertMembership: vi.fn(async (userId: string, workspaceId: string) => {
      if (userId === OUTSIDER_ID) throw forbidden('not a member')
      return { userId, workspaceId, role: 'VIEWER' as const }
    }),
  }
  const resolver = new FormAccessResolver(repo as never, workspace, () => NOW_DATE)

  return {
    resolver,
    repo,
    workspace,
    addVersion(version: FormVersionRecord) {
      versions.set(version.versionNumber, version)
    },
    setForm(next: PublicFormRecord | null) {
      storedForm = next
      if (next?.publishedVersion) {
        versions.set(next.publishedVersion.versionNumber, next.publishedVersion)
      }
    },
  }
}

function fieldErrorsFor(answers: Record<string, unknown>): Record<string, string[]> | null {
  const result = buildFormAnswerSchema(toPublicFormVersion(document)).safeParse({ answers })
  if (result.success) return null
  const fieldErrors: Record<string, string[]> = Object.create(null)
  for (const issue of result.error.issues) {
    const questionId = issue.path[1]
    if (typeof questionId !== 'string') continue
    ;(fieldErrors[questionId] ??= []).push(issue.message)
  }
  return fieldErrors
}

function prismaMock() {
  return {
    databaseProperty: { findFirst: vi.fn() },
    databaseSource: { findFirst: vi.fn() },
    user: { findMany: vi.fn() },
    page: { findMany: vi.fn() },
    workspaceMember: { findFirst: vi.fn() },
  }
}

function routerHarness(
  access = accessHarness(),
  options: { userId?: string | null; prisma?: ReturnType<typeof prismaMock> } = {},
) {
  const submit = vi.fn(
    async (
      actorUserId: string | null,
      input: { locator: string; answers: Record<string, unknown> },
      token: FormVersionTokenPayload,
    ) => {
      const resolved = await access.resolver.resolvePublished(input.locator, actorUserId)
      if (resolved.status !== 'OPEN') throw conflict('FORM_NOT_ACCEPTING')
      const storedVersion = await access.resolver.resolveVersion(resolved.form, token.versionNumber)
      if (storedVersion === null) throw conflict('FORM_VERSION_STALE')
      try {
        assertFormVersionContext(
          token,
          {
            locatorHash: hashFormLocator(resolved.locator),
            versionNumber: storedVersion.versionNumber,
            schemaHash: storedVersion.schemaHash,
            linkRevision: resolved.form.linkRevision,
            isCurrent: storedVersion.id === resolved.form.publishedVersionId,
            acceptUntil: storedVersion.acceptUntil,
          },
          NOW,
        )
      } catch {
        throw conflict('FORM_VERSION_STALE')
      }

      const fieldErrors = fieldErrorsFor(input.answers)
      if (fieldErrors !== null) throw new FormValidationError(fieldErrors)
      const path = evaluateFormPath(toPublicFormVersion(document), input.answers)
      return {
        submissionId: SUBMISSION_ID,
        rowId: ROW_ID,
        pageId: SOURCE_PAGE_ID,
        endingId: path.endingId,
        ownResponseUrl: null,
        submittedAt: NOW_DATE,
        created: true,
      }
    },
  )
  const getOwnResponse = vi.fn(
    async (actorUserId: string, input: { locator: string; submissionId: string }) => {
      const resolved = await access.resolver.resolveOwnResponse(
        input.locator,
        input.submissionId,
        actorUserId,
      )
      if (resolved.status === 'UNAVAILABLE') throw notFound('FORM_RESPONSE_NOT_FOUND')
      throw new Error('accessible own response not configured in security harness')
    },
  )
  const updateOwnResponse = vi.fn(
    async (actorUserId: string, input: { locator: string; submissionId: string }) => {
      const resolved = await access.resolver.resolveOwnResponse(
        input.locator,
        input.submissionId,
        actorUserId,
      )
      if (resolved.status === 'UNAVAILABLE') throw notFound('FORM_RESPONSE_NOT_FOUND')
      throw new Error('accessible own response not configured in security harness')
    },
  )
  const verifyCaptcha = vi.fn(async () => undefined)
  const domain = {
    formAccess: access.resolver,
    formSubmissions: {
      findReplay: vi.fn(async () => null),
      submit,
      getOwnResponse,
      updateOwnResponse,
    },
    database: { listRows: vi.fn(async () => ({ rows: [], nextCursor: null })) },
  }
  const router = createFormRouter({
    domain: domain as never,
    rateLimiter: { consume: vi.fn(() => true) },
    verifyCaptcha,
    notifyFormManagers: vi.fn(async () => undefined),
    observeFormEvent: vi.fn(),
    captureFormOperationalFailure: vi.fn(),
    now: () => NOW,
  })
  const prisma = options.prisma ?? prismaMock()
  const userId = options.userId === undefined ? USER_ID : options.userId
  const resHeaders = new Headers()
  const api = createCallerFactory(router)({
    prisma: prisma as never,
    user:
      userId === null
        ? null
        : ({
            id: userId,
            email: 'security@example.test',
            firstName: 'Security',
            lastName: 'Test',
            emailVerified: true,
          } as never),
    headers: new Headers({
      'x-captcha-response': 'captcha-token',
      'x-forwarded-for': '192.0.2.10',
    }),
    resHeaders,
    yookassa: {} as never,
    returnUrlBase: 'http://localhost',
    jobs: { kick: vi.fn() },
  })

  return {
    api,
    access,
    prisma,
    submit,
    getOwnResponse,
    updateOwnResponse,
    verifyCaptcha,
    resHeaders,
  }
}

function validSubmit(overrides: Record<string, unknown> = {}) {
  return {
    locator: 'anf_security-key',
    versionToken: tokenFor(),
    idempotencyKey: IDEMPOTENCY_KEY,
    answers: { 'main-answer': 'normal' },
    honeypot: '',
    ...overrides,
  }
}

beforeEach(() => {
  vi.stubEnv('FORM_TOKEN_SECRET', SECRET)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('database forms adversarial submission envelope', () => {
  it.each(['sourceId', 'propertyId', 'rowId', 'endingId'])(
    'rejects forged server-owned %s before lookup or CAPTCHA',
    async (field) => {
      const harness = routerHarness()

      await expect(
        harness.api.submit({ ...validSubmit(), [field]: 'attacker-controlled' } as never),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' })

      expect(harness.access.repo.findByLocator).not.toHaveBeenCalled()
      expect(harness.verifyCaptcha).not.toHaveBeenCalled()
      expect(harness.submit).not.toHaveBeenCalled()
    },
  )

  it.each([
    ['unknown', { 'main-answer': 'normal', injected: 'secret' }, 'injected'],
    ['hidden', { 'main-answer': 'normal', 'hidden-answer': 'secret' }, 'hidden-answer'],
  ])('rejects a forged %s answer through the server compiler', async (_label, answers, field) => {
    const harness = routerHarness()

    await expect(harness.api.submit(validSubmit({ answers }))).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'FORM_ANSWERS_INVALID',
      cause: { details: { fieldErrors: { [field]: ['UNREACHABLE_ANSWER'] } } },
    })
  })

  it('derives the ending from the stored graph and exposes no client ending override', async () => {
    const harness = routerHarness(accessHarness(), { userId: null })

    await expect(
      harness.api.submit(validSubmit({ answers: { 'main-answer': 'special' } })),
    ).resolves.toMatchObject({ endingId: 'special-ending' })
    expect(harness.submit).toHaveBeenCalledWith(
      null,
      expect.not.objectContaining({ endingId: expect.anything() }),
      expect.any(Object),
    )
  })
})

describe('version-token and grace-period boundaries', () => {
  it.each([
    ['tampered token', `${tokenFor()}x`],
    ['expired token', tokenFor(formVersion(), { expiresAt: NOW })],
  ])('rejects a %s only after CAPTCHA and never reaches persistence', async (_label, token) => {
    const harness = routerHarness()

    await expect(harness.api.submit(validSubmit({ versionToken: token }))).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: 'FORM_REFRESH_REQUIRED',
    })
    expect(harness.verifyCaptcha).toHaveBeenCalledOnce()
    expect(harness.submit).not.toHaveBeenCalled()
  })

  it('invalidates the signed context after link rotation', async () => {
    const access = accessHarness()
    const staleToken = tokenFor()
    access.setForm(publicForm({ linkRevision: 2 }))
    const harness = routerHarness(access)

    await expect(
      harness.api.submit(validSubmit({ versionToken: staleToken })),
    ).rejects.toMatchObject({ code: 'CONFLICT', message: 'FORM_VERSION_STALE' })
    expect(harness.verifyCaptcha).toHaveBeenCalledOnce()
  })

  it('rejects an old version at the exact grace deadline', async () => {
    const grace = formVersion({ acceptUntil: NOW_DATE })
    const current = formVersion({
      id: '00000000-0000-7000-8000-000000000010',
      versionNumber: 2,
      schemaHash: 'b'.repeat(64),
    })
    const access = accessHarness(
      publicForm({ publishedVersionId: current.id, publishedVersion: current }),
    )
    access.addVersion(grace)
    const harness = routerHarness(access)

    await expect(
      harness.api.submit(validSubmit({ versionToken: tokenFor(grace) })),
    ).rejects.toMatchObject({ code: 'CONFLICT', message: 'FORM_VERSION_STALE' })
  })
})

describe('public picker and locator enumeration boundaries', () => {
  it('uses only the stored question mapping when forged picker IDs are supplied', async () => {
    const access = accessHarness(publicForm({ audience: 'WORKSPACE_MEMBERS_WITH_LINK' }))
    const prisma = prismaMock()
    prisma.databaseProperty.findFirst.mockResolvedValue({
      id: PERSON_PROPERTY_ID,
      type: 'PERSON',
      settings: null,
    })
    prisma.user.findMany.mockResolvedValue([])
    const harness = routerHarness(access, { prisma })
    const published = await harness.api.getPublished({ locator: 'anf_security-key' })
    if (published.status !== 'OPEN') throw new Error('expected open form')

    await expect(
      harness.api.listPickerOptions({
        locator: 'anf_security-key',
        versionToken: published.versionToken,
        questionId: 'person',
        limit: 10,
        propertyId: 'forged-property',
        sourceId: 'forged-source',
        rowId: 'forged-row',
      } as never),
    ).resolves.toEqual({ items: [], nextCursor: null })

    expect(prisma.databaseProperty.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: PERSON_PROPERTY_ID, sourceId: SOURCE_ID, type: 'PERSON' },
      }),
    )
    expect(JSON.stringify(prisma.databaseProperty.findFirst.mock.calls)).not.toMatch(
      /forged-property|forged-source|forged-row/u,
    )
  })

  it('collapses anonymous, forged-token and unknown-question picker probes', async () => {
    const access = accessHarness(publicForm({ audience: 'WORKSPACE_MEMBERS_WITH_LINK' }))
    const signedIn = routerHarness(access)
    const anonymous = routerHarness(access, { userId: null })
    const unavailable = { code: 'NOT_FOUND', message: 'FORM_PICKER_UNAVAILABLE' }

    await expect(
      anonymous.api.listPickerOptions({
        locator: 'anf_security-key',
        versionToken: tokenFor(),
        questionId: 'person',
        limit: 10,
      }),
    ).rejects.toMatchObject(unavailable)
    await expect(
      signedIn.api.listPickerOptions({
        locator: 'anf_security-key',
        versionToken: 'forged.token',
        questionId: 'person',
        limit: 10,
      }),
    ).rejects.toMatchObject(unavailable)
    await expect(
      signedIn.api.listPickerOptions({
        locator: 'anf_security-key',
        versionToken: tokenFor(),
        questionId: 'unknown-question',
        limit: 10,
      }),
    ).rejects.toMatchObject(unavailable)
  })

  it('keeps an unknown slug and an archived known slug byte-identical', async () => {
    const access = accessHarness(publicForm({ state: 'ARCHIVED' }))

    const unknown = await access.resolver.resolvePublished('unknown-form', null)
    const archived = await access.resolver.resolvePublished('security-form', null)

    expect(JSON.stringify(unknown)).toBe(JSON.stringify(archived))
    expect(unknown).toEqual({ status: 'UNAVAILABLE' })
  })
})

describe('workspace policy kill switch', () => {
  it('disables schema, picker, submit and every own-response route', async () => {
    const base = publicForm()
    const policyForm = publicForm({
      source: {
        ...base.source,
        workspace: {
          ...base.source.workspace,
          securityPolicy: { disablePublicLinksSitesForms: true },
        },
      },
    })
    const harness = routerHarness(accessHarness(policyForm))
    const ownToken = signFormOwnResponseToken(
      {
        locatorHash: hashFormLocator('anf_security-key'),
        submissionId: SUBMISSION_ID,
        actorUserId: USER_ID,
        versionNumber: 1,
        schemaHash,
        questionId: 'person',
        issuedAt: NOW - 1_000,
        expiresAt: NOW + 60_000,
      },
      SECRET,
    )

    await expect(harness.api.getPublished({ locator: 'anf_security-key' })).resolves.toEqual({
      status: 'POLICY_DISABLED',
    })
    await expect(
      harness.api.listPickerOptions({
        locator: 'anf_security-key',
        versionToken: tokenFor(),
        questionId: 'person',
        limit: 10,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'FORM_PICKER_UNAVAILABLE' })
    await expect(harness.api.submit(validSubmit())).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'FORM_NOT_ACCEPTING',
    })
    await expect(
      harness.api.getOwnResponse({ locator: 'anf_security-key', submissionId: SUBMISSION_ID }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'FORM_RESPONSE_NOT_FOUND' })
    await expect(
      harness.api.updateOwnResponse({
        locator: 'anf_security-key',
        submissionId: SUBMISSION_ID,
        expectedRevision: 'a'.repeat(64),
        answers: {},
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'FORM_RESPONSE_NOT_FOUND' })
    await expect(
      harness.api.listOwnResponsePickerOptions({
        locator: 'anf_security-key',
        submissionId: SUBMISSION_ID,
        questionId: 'person',
        ownResponseToken: ownToken,
        limit: 10,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'FORM_PICKER_UNAVAILABLE' })
  })
})

describe('CAPTCHA fail-closed matrix', () => {
  function captchaResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  }

  it.each([
    [
      'wrong action',
      { success: true, action: 'form_upload', score: 0.9, hostname: 'anynote.ru' },
      'recaptcha-secret',
    ],
    [
      'wrong hostname',
      { success: true, action: 'form_submit', score: 0.9, hostname: 'attacker.example' },
      'recaptcha-secret',
    ],
    [
      'low score',
      { success: true, action: 'form_submit', score: 0.49, hostname: 'anynote.ru' },
      'recaptcha-secret',
    ],
    ['provider failure', {}, 'recaptcha-secret'],
  ])('fails closed for %s', async (_label, body, secret) => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(captchaResponse(body, _label === 'provider failure' ? 503 : 200))

    await expect(
      verifyFormCaptcha({
        token: 'browser-token',
        action: 'form_submit',
        headers: new Headers(),
        fetchImpl,
        secret,
        nodeEnv: 'production',
        betterAuthUrl: 'https://anynote.ru',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', message: 'FORM_CAPTCHA_FAILED' })
  })

  it('fails closed before fetch when the production secret is absent', async () => {
    const fetchImpl = vi.fn<typeof fetch>()

    await expect(
      verifyFormCaptcha({
        token: 'browser-token',
        action: 'form_submit',
        headers: new Headers(),
        fetchImpl,
        secret: '',
        nodeEnv: 'production',
        betterAuthUrl: 'https://anynote.ru',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', message: 'FORM_CAPTCHA_FAILED' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('audience combinations', () => {
  it('ignores a session for ANYONE, requires one for SIGNED_IN, and enforces membership', async () => {
    const anyone = accessHarness(publicForm({ audience: 'ANYONE_WITH_LINK' }))
    await expect(
      anyone.resolver.resolvePublished('anf_security-key', USER_ID),
    ).resolves.toMatchObject({ status: 'OPEN', respondentUserId: null })

    const signed = accessHarness(publicForm({ audience: 'SIGNED_IN_WITH_LINK' }))
    await expect(signed.resolver.resolvePublished('anf_security-key', null)).resolves.toEqual({
      status: 'AUTH_REQUIRED',
    })
    await expect(
      signed.resolver.resolvePublished('anf_security-key', USER_ID),
    ).resolves.toMatchObject({ status: 'OPEN', respondentUserId: USER_ID })

    const members = accessHarness(publicForm({ audience: 'WORKSPACE_MEMBERS_WITH_LINK' }))
    await expect(members.resolver.resolvePublished('anf_security-key', null)).resolves.toEqual({
      status: 'AUTH_REQUIRED',
    })
    await expect(
      members.resolver.resolvePublished('anf_security-key', OUTSIDER_ID),
    ).resolves.toEqual({ status: 'AUTH_REQUIRED' })
    await expect(
      members.resolver.resolvePublished('anf_security-key', USER_ID),
    ).resolves.toMatchObject({ status: 'OPEN', respondentUserId: USER_ID })
  })
})

describe('upload lease binding and one-time claim', () => {
  const lease = {
    id: UPLOAD_ID,
    formId: FORM_ID,
    versionId: VERSION_ID,
    questionId: 'files',
    fileId: FILE_ID,
    uploadTokenHash: 'a'.repeat(64),
    expiresAt: new Date(NOW + 60_000),
    consumedAt: null,
    file: {
      workspaceId: WORKSPACE_ID,
      status: 'PENDING',
      mimeType: 'text/plain',
      fileSize: 12n,
    },
  }

  it('scopes a lease lookup to form, version and question while excluding consumed rows', async () => {
    const findMany = vi.fn(async () => [])
    const repository = new DatabaseFormRepository({
      client: vi.fn(() => ({ databaseFormUpload: { findMany } })),
    } as never)

    await repository.resolveUploadLeases({
      formId: FORM_ID,
      versionId: VERSION_ID,
      questionId: 'files',
      tokenHashes: [lease.uploadTokenHash],
      now: NOW_DATE,
    })

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          formId: FORM_ID,
          versionId: VERSION_ID,
          questionId: 'files',
          consumedAt: null,
          expiresAt: { gt: NOW_DATE },
        }),
      }),
    )
  })

  it('rejects consumed upload reuse before file activation or page attachment', async () => {
    const databaseFormUpload = { updateMany: vi.fn(async () => ({ count: 0 })) }
    const file = { updateMany: vi.fn(async () => ({ count: 1 })) }
    const pageFile = { create: vi.fn(async () => undefined) }
    const repository = new DatabaseFormRepository({
      client: vi.fn(() => ({ databaseFormUpload, file, pageFile })),
    } as never)

    await expect(
      repository.consumeUploadLeases({
        formId: FORM_ID,
        versionId: VERSION_ID,
        questionId: 'files',
        workspaceId: WORKSPACE_ID,
        uploads: [lease] as never,
        pageId: SOURCE_PAGE_ID,
        consumedAt: NOW_DATE,
      }),
    ).rejects.toMatchObject({ message: 'FORM_UPLOAD_INVALID' })
    expect(file.updateMany).not.toHaveBeenCalled()
    expect(pageFile.create).not.toHaveBeenCalled()
  })
})
