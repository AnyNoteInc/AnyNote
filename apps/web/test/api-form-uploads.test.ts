import { createHash } from 'node:crypto'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  FORM_SCHEMA_VERSION,
  type FormQuestion,
  type FormVersionDocument,
} from '@repo/domain/database/forms'
import { verifyOwnResponseUploadToken } from '@repo/domain'
import { hashFormLocator, signFormVersionToken } from '@repo/trpc/helpers/form-version-token'
import { signFormOwnResponseToken } from '@repo/trpc/helpers/form-own-response-token'

import { createFormUploadHandler } from '../src/app/api/forms/[locator]/uploads/route'

const NOW = new Date('2026-07-16T12:00:00.000Z')
const SECRET = 'form-upload-test-secret-that-is-at-least-32-bytes'
const FORM_ID = '11111111-1111-7111-8111-111111111111'
const VERSION_ID = '22222222-2222-7222-8222-222222222222'
const OLD_VERSION_ID = '33333333-3333-7333-8333-333333333333'
const WORKSPACE_ID = '44444444-4444-7444-8444-444444444444'
const OWNER_ID = '55555555-5555-7555-8555-555555555555'
const RESPONDENT_ID = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa'
const SUBMISSION_ID = 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb'
const FILE_ID = '66666666-6666-7666-8666-666666666666'
const QUESTION_ID = 'files'
const LOCATOR = 'anf_upload-form'
const SCHEMA_HASH = 'a'.repeat(64)
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])

type FileInput = Extract<FormQuestion['input'], { kind: 'FILE' }>

const document = (overrides: Partial<Omit<FileInput, 'kind'>> = {}): FormVersionDocument => ({
  schemaVersion: FORM_SCHEMA_VERSION,
  firstSectionId: 'section',
  presentation: { title: 'Upload form', submitButtonText: 'Send', hideAnyNoteBranding: false },
  sections: [{ id: 'section', title: 'Files', questionIds: [QUESTION_ID] }],
  questions: [
    {
      id: QUESTION_ID,
      sectionId: 'section',
      property: {
        kind: 'PROPERTY',
        propertyId: '77777777-7777-7777-8777-777777777777',
        propertyType: 'FILE',
      },
      label: 'Files',
      required: false,
      syncWithPropertyName: false,
      input: {
        kind: 'FILE',
        allowedMimeTypes: ['image/png'],
        maxBytesPerFile: 1_024,
        maxFiles: 2,
        ...overrides,
      },
    },
  ],
  transitions: [
    {
      id: 'transition',
      fromSectionId: 'section',
      priority: 0,
      when: null,
      target: { kind: 'ENDING', endingId: 'done' },
    },
  ],
  endings: [{ id: 'done', title: 'Done' }],
})

const version = (overrides: Record<string, unknown> = {}) => ({
  id: VERSION_ID,
  formId: FORM_ID,
  versionNumber: 2,
  schema: document(),
  schemaVersion: FORM_SCHEMA_VERSION,
  schemaHash: SCHEMA_HASH,
  acceptUntil: null,
  ...overrides,
})

const form = () => ({
  id: FORM_ID,
  sourceId: '88888888-8888-7888-8888-888888888888',
  routeKey: LOCATOR,
  customSlug: null,
  createdById: OWNER_ID,
  state: 'OPEN',
  audience: 'ANYONE_WITH_LINK',
  respondentAccess: 'NONE',
  opensAt: null,
  closesAt: null,
  responseLimit: null,
  acceptedResponses: 0,
  linkRevision: 3,
  publishedVersionId: VERSION_ID,
  source: {
    workspaceId: WORKSPACE_ID,
    pageId: '99999999-9999-7999-8999-999999999999',
    page: { archivedAt: null, deletedAt: null },
    workspace: { id: WORKSPACE_ID, securityPolicy: null },
  },
  publishedVersion: version(),
})

function tokenFor(value = version()) {
  return signFormVersionToken(
    {
      locatorHash: hashFormLocator(LOCATOR),
      versionNumber: value.versionNumber,
      schemaHash: value.schemaHash,
      linkRevision: 3,
      issuedAt: NOW.getTime() - 1_000,
      expiresAt: NOW.getTime() + 60_000,
    },
    SECRET,
  )
}

function uploadRequest(
  overrides: { file?: File; versionToken?: string; questionId?: string; captcha?: string } = {},
) {
  const data = new FormData()
  data.set('versionToken', overrides.versionToken ?? tokenFor())
  data.set('questionId', overrides.questionId ?? QUESTION_ID)
  data.set('file', overrides.file ?? new File([PNG], 'pixel.png', { type: 'image/png' }))
  return new Request(`http://localhost/api/forms/${LOCATOR}/uploads`, {
    method: 'POST',
    headers: {
      'x-captcha-response': overrides.captcha ?? 'captcha-token',
      'x-forwarded-for': '203.0.113.7',
    },
    body: data,
  })
}

function ownUploadRequest(overrides: { file?: File; token?: string; questionId?: string } = {}) {
  const questionId = overrides.questionId ?? QUESTION_ID
  const data = new FormData()
  data.set(
    'ownResponseToken',
    overrides.token ??
      signFormOwnResponseToken(
        {
          locatorHash: hashFormLocator(LOCATOR),
          submissionId: SUBMISSION_ID,
          actorUserId: RESPONDENT_ID,
          versionNumber: 2,
          schemaHash: SCHEMA_HASH,
          questionId,
          issuedAt: NOW.getTime() - 1_000,
          expiresAt: NOW.getTime() + 60_000,
        },
        SECRET,
      ),
  )
  data.set('questionId', questionId)
  data.set('file', overrides.file ?? new File([PNG], 'pixel.png', { type: 'image/png' }))
  return new Request(`http://localhost/api/forms/${LOCATOR}/responses/${SUBMISSION_ID}/uploads`, {
    method: 'POST',
    headers: {
      'x-captcha-response': 'captcha-token',
      'x-forwarded-for': '203.0.113.7',
    },
    body: data,
  })
}

function makeHarness(
  options: {
    resolved?: Record<string, unknown>
    lockedResolved?: Record<string, unknown>
    storedVersion?: Record<string, unknown> | null
    liveLeaseCount?: number
    usedBytes?: bigint
    maxFileBytes?: bigint
    limiterAllowed?: boolean
    limiterResults?: boolean[]
    transactionError?: Error
    storagePutError?: Error
    storageDeleteError?: Error
    sharedPathCount?: number
    ownResolved?: Record<string, unknown>
    lockedOwnResolved?: Record<string, unknown>
    actorUserId?: string | null
  } = {},
) {
  const fileCreate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
    id: FILE_ID,
    createdAt: NOW,
    ...data,
  }))
  const uploadCreate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
    id: 'lease',
    ...data,
  }))
  const aggregate = vi.fn(async () => ({ _sum: { fileSize: options.usedBytes ?? 0n } }))
  const leaseCount = vi.fn(async () => options.liveLeaseCount ?? 0)
  const limits = vi.fn(async () => ({ maxFileBytes: options.maxFileBytes ?? 10_000n }))
  const pathCount = vi.fn(async () => options.sharedPathCount ?? 0)
  const tx = {
    $queryRaw: vi.fn(async () => [{ id: WORKSPACE_ID }]),
    file: { aggregate, count: pathCount, create: fileCreate },
    databaseFormUpload: { count: leaseCount, create: uploadCreate },
    workspaceLimit: { findUnique: limits },
  }
  const prisma = {
    file: {
      aggregate: vi.fn(async () => ({ _sum: { fileSize: options.usedBytes ?? 0n } })),
      count: vi.fn(async () => options.sharedPathCount ?? 0),
    },
    databaseFormUpload: { count: vi.fn(async () => options.liveLeaseCount ?? 0) },
    workspaceLimit: {
      findUnique: vi.fn(async () => ({ maxFileBytes: options.maxFileBytes ?? 10_000n })),
    },
    $transaction: vi.fn(
      async (
        callback: (client: typeof tx) => Promise<unknown>,
        transactionOptions?: { maxWait: number; timeout: number },
      ) => {
        void transactionOptions
        const result = await callback(tx)
        if (options.transactionError && prisma.$transaction.mock.calls.length === 1) {
          throw options.transactionError
        }
        return result
      },
    ),
  }
  const storage = {
    put: vi.fn(async () => {
      if (options.storagePutError) throw options.storagePutError
    }),
    delete: vi.fn(async () => {
      if (options.storageDeleteError) throw options.storageDeleteError
    }),
  }
  const verifyCaptcha = vi.fn(async () => {})
  const limiterResults = [...(options.limiterResults ?? [])]
  const consume = vi.fn(() => limiterResults.shift() ?? options.limiterAllowed ?? true)
  const current = version()
  const openResolved = options.resolved ?? {
    status: 'OPEN',
    locator: LOCATOR,
    form: form(),
    version: current,
    respondentUserId: null,
  }
  const resolvePublished = vi.fn(async () => openResolved)
  if (options.lockedResolved !== undefined) {
    resolvePublished
      .mockResolvedValueOnce(openResolved)
      .mockResolvedValueOnce(options.lockedResolved)
  }
  const formAccess = {
    resolvePublished,
    resolveOwnResponse: vi.fn(async () => options.ownResolved ?? { status: 'UNAVAILABLE' }),
    resolveVersion: vi.fn(async () =>
      options.storedVersion === undefined ? current : options.storedVersion,
    ),
  }
  const handler = createFormUploadHandler({
    prisma: prisma as never,
    storage: storage as never,
    formAccess: formAccess as never,
    verifyCaptcha,
    rateLimiter: { consume },
    getActorUserId: vi.fn(async () => options.actorUserId ?? null),
    now: () => NOW,
    tokenSecret: () => SECRET,
  })
  const call = (request = uploadRequest(), locator = LOCATOR) =>
    handler(request, { params: Promise.resolve({ locator }) })
  const callOwn = (request = ownUploadRequest(), locator = LOCATOR) => {
    if (options.lockedOwnResolved !== undefined) {
      formAccess.resolveOwnResponse
        .mockResolvedValueOnce(options.ownResolved ?? { status: 'UNAVAILABLE' })
        .mockResolvedValueOnce(options.lockedOwnResolved)
    }
    return handler(request, { params: Promise.resolve({ locator, submissionId: SUBMISSION_ID }) })
  }
  return {
    call,
    callOwn,
    handler,
    prisma,
    tx,
    storage,
    verifyCaptcha,
    consume,
    formAccess,
    fileCreate,
    uploadCreate,
  }
}

describe('public database form upload route', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates a private pending file and returns one unpersisted bearer token', async () => {
    const harness = makeHarness()
    const response = await harness.call()
    const body = (await response.json()) as { uploadToken: string; file: Record<string, string> }

    expect(response.status).toBe(201)
    expect(body.uploadToken).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(body.file).toEqual({
      name: 'pixel.png',
      mimeType: 'image/png',
      fileSize: PNG.length.toString(),
      expiresAt: '2026-07-17T12:00:00.000Z',
    })
    expect(JSON.stringify(body)).not.toContain(FORM_ID)
    expect(harness.verifyCaptcha).toHaveBeenCalledWith({
      token: 'captcha-token',
      action: 'form_upload',
      headers: expect.any(Headers),
    })
    expect(harness.consume).toHaveBeenCalledWith('upload-ip', 'probe:203.0.113.7', NOW.getTime())
    expect(harness.consume).toHaveBeenCalledWith(
      'upload-ip',
      `form:${FORM_ID}:203.0.113.7`,
      NOW.getTime(),
    )
    expect(harness.storage.put).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp(`^forms/${FORM_ID}/[a-f0-9]{2}/[a-f0-9]{64}\\.png$`)),
      expect.any(Buffer),
      { contentType: 'image/png', size: PNG.length },
    )
    const fileData = harness.fileCreate.mock.calls[0]![0].data
    expect(fileData).toMatchObject({
      userId: OWNER_ID,
      workspaceId: WORKSPACE_ID,
      status: 'PENDING',
      isPublic: false,
      fileSize: BigInt(PNG.length),
    })
    const leaseData = harness.uploadCreate.mock.calls[0]![0].data
    expect(leaseData).toMatchObject({
      formId: FORM_ID,
      versionId: VERSION_ID,
      questionId: QUESTION_ID,
      fileId: FILE_ID,
    })
    expect(leaseData.uploadTokenHash).toBe(
      createHash('sha256').update(body.uploadToken).digest('hex'),
    )
    expect(JSON.stringify(leaseData)).not.toContain(body.uploadToken)
    expect(harness.tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      harness.tx.file.aggregate.mock.invocationCallOrder[0]!,
    )
    expect(harness.tx.file.count.mock.invocationCallOrder[0]).toBeLessThan(
      harness.storage.put.mock.invocationCallOrder[0]!,
    )
    expect(harness.storage.put.mock.invocationCallOrder[0]).toBeLessThan(
      harness.fileCreate.mock.invocationCallOrder[0]!,
    )
    expect(harness.prisma.$transaction.mock.calls[0]![1]).toEqual({
      maxWait: 10_000,
      timeout: 120_000,
    })
  })

  it('accepts a still-live grace version bound to the same form', async () => {
    const old = version({
      id: OLD_VERSION_ID,
      versionNumber: 1,
      acceptUntil: new Date(NOW.getTime() + 60_000),
    })
    const harness = makeHarness({ storedVersion: old })
    const response = await harness.call(uploadRequest({ versionToken: tokenFor(old) }))

    expect(response.status).toBe(201)
    expect(harness.uploadCreate.mock.calls[0]![0].data).toMatchObject({ versionId: OLD_VERSION_ID })
  })

  it.each([
    ['invalid locator', 'not/valid', undefined],
    ['unavailable form', LOCATOR, { status: 'POLICY_DISABLED' }],
    ['wrong audience', LOCATOR, { status: 'AUTH_REQUIRED' }],
  ])('rejects %s before storage', async (_label, locator, resolved) => {
    const harness = makeHarness(resolved ? { resolved } : {})
    const response = await harness.call(uploadRequest(), locator)
    expect(response.status).toBeGreaterThanOrEqual(400)
    expect(harness.storage.put).not.toHaveBeenCalled()
  })

  it('uses one bounded unavailable bucket for different unknown locators', async () => {
    const harness = makeHarness({ resolved: { status: 'UNAVAILABLE' } })
    await harness.call(uploadRequest(), 'anf_missing_one')
    await harness.call(uploadRequest(), 'anf_missing_two')
    expect(harness.consume).toHaveBeenNthCalledWith(
      1,
      'upload-ip',
      'probe:203.0.113.7',
      NOW.getTime(),
    )
    expect(harness.consume).toHaveBeenNthCalledWith(
      2,
      'upload-ip',
      'form:unavailable:203.0.113.7',
      NOW.getTime(),
    )
    expect(harness.consume).toHaveBeenNthCalledWith(
      3,
      'upload-ip',
      'probe:203.0.113.7',
      NOW.getTime(),
    )
    expect(harness.consume).toHaveBeenNthCalledWith(
      4,
      'upload-ip',
      'form:unavailable:203.0.113.7',
      NOW.getTime(),
    )
  })

  it('accepts exactly one file and leaves per-response maxFiles to final submit', async () => {
    const data = new FormData()
    data.set('versionToken', tokenFor())
    data.set('questionId', QUESTION_ID)
    data.append('file', new File([PNG], 'one.png', { type: 'image/png' }))
    data.append('file', new File([PNG], 'two.png', { type: 'image/png' }))
    const request = new Request(`http://localhost/api/forms/${LOCATOR}/uploads`, {
      method: 'POST',
      headers: {
        'x-captcha-response': 'captcha-token',
        'x-forwarded-for': '203.0.113.7',
      },
      body: data,
    })
    const harness = makeHarness()
    expect((await harness.call(request)).status).toBe(400)
    expect(harness.storage.put).not.toHaveBeenCalled()
  })

  it.each([
    ['forged version', { versionToken: 'forged' }],
    ['unknown question', { questionId: 'unknown' }],
  ])('rejects %s before storage', async (_label, overrides) => {
    const harness = makeHarness()
    const response = await harness.call(uploadRequest(overrides))
    expect(response.status).toBeGreaterThanOrEqual(400)
    expect(harness.storage.put).not.toHaveBeenCalled()
  })

  it('rejects a FILE question in a structurally unreachable section', async () => {
    const unreachable = version({
      schema: {
        ...document(),
        firstSectionId: 'start',
        sections: [
          { id: 'start', title: 'Start', questionIds: [] },
          { id: 'section', title: 'Files', questionIds: [QUESTION_ID] },
        ],
        transitions: [
          {
            id: 'end-now',
            fromSectionId: 'start',
            priority: 0,
            when: null,
            target: { kind: 'ENDING', endingId: 'done' },
          },
        ],
      },
    })
    const harness = makeHarness({ storedVersion: unreachable })
    const response = await harness.call(uploadRequest({ versionToken: tokenFor(unreachable) }))
    expect(response.status).toBe(404)
    expect(harness.storage.put).not.toHaveBeenCalled()
  })

  it('rejects an expired grace version before storage', async () => {
    const old = version({
      id: OLD_VERSION_ID,
      versionNumber: 1,
      acceptUntil: new Date(NOW.getTime() - 1),
    })
    const harness = makeHarness({ storedVersion: old })
    const response = await harness.call(uploadRequest({ versionToken: tokenFor(old) }))
    expect(response.status).toBe(412)
    expect(harness.storage.put).not.toHaveBeenCalled()
  })

  it('rejects a version returned from another form before storage', async () => {
    const foreign = version({ formId: 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa' })
    const harness = makeHarness({ storedVersion: foreign })
    const response = await harness.call(uploadRequest({ versionToken: tokenFor(foreign) }))
    expect(response.status).toBe(412)
    expect(harness.storage.put).not.toHaveBeenCalled()
  })

  it('revalidates access after the workspace lock and before storage', async () => {
    const harness = makeHarness({ lockedResolved: { status: 'POLICY_DISABLED' } })
    const response = await harness.call()
    expect(response.status).toBe(404)
    expect(harness.formAccess.resolvePublished).toHaveBeenCalledTimes(2)
    expect(harness.storage.put).not.toHaveBeenCalled()
    expect(harness.fileCreate).not.toHaveBeenCalled()
  })

  it('rate-limits probes before lookup and the canonical form before CAPTCHA', async () => {
    const limited = makeHarness({ limiterAllowed: false })
    expect((await limited.call()).status).toBe(403)
    expect(limited.verifyCaptcha).not.toHaveBeenCalled()
    expect(limited.formAccess.resolvePublished).not.toHaveBeenCalled()

    const canonicalLimited = makeHarness({ limiterResults: [true, false] })
    expect((await canonicalLimited.call()).status).toBe(403)
    expect(canonicalLimited.formAccess.resolvePublished).toHaveBeenCalledOnce()
    expect(canonicalLimited.verifyCaptcha).not.toHaveBeenCalled()

    const captcha = makeHarness()
    captcha.verifyCaptcha.mockRejectedValueOnce(new Error('captcha'))
    expect((await captcha.call()).status).toBe(403)
    expect(captcha.formAccess.resolvePublished).toHaveBeenCalledOnce()
    expect(captcha.consume).toHaveBeenCalledTimes(2)
    expect(captcha.storage.put).not.toHaveBeenCalled()
  })

  it.each([
    ['declared MIME', new File([PNG], 'pixel.png', { type: 'image/jpeg' })],
    ['sniffed MIME', new File([Buffer.from('<html>')], 'pixel.png', { type: 'image/png' })],
    ['byte limit', new File([Buffer.alloc(2_000)], 'pixel.png', { type: 'image/png' })],
  ])('rejects a %s violation before storage', async (_label, file) => {
    const harness = makeHarness()
    const response = await harness.call(uploadRequest({ file }))
    expect(response.status).toBeGreaterThanOrEqual(400)
    expect(harness.storage.put).not.toHaveBeenCalled()
  })

  it('checks active plus nonexpired pending quota before storage', async () => {
    const quota = makeHarness({ usedBytes: 9_995n, maxFileBytes: 10_000n })
    expect((await quota.call()).status).toBe(413)
    expect(quota.prisma.file.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ workspaceId: WORKSPACE_ID, OR: expect.any(Array) }),
      }),
    )
    expect(quota.storage.put).not.toHaveBeenCalled()
  })

  it('allows only genuinely opaque configured binary bytes', async () => {
    const binaryVersion = version({
      schema: document({ allowedMimeTypes: ['application/octet-stream'] }),
    })
    const harness = makeHarness({ storedVersion: binaryVersion })
    const response = await harness.call(
      uploadRequest({
        versionToken: tokenFor(binaryVersion),
        file: new File([Buffer.from([0xff, 0x00, 0x80, 0x81])], 'blob.bin', {
          type: 'application/octet-stream',
        }),
      }),
    )
    expect(response.status).toBe(201)

    const disguised = makeHarness({ storedVersion: binaryVersion })
    const rejected = await disguised.call(
      uploadRequest({
        versionToken: tokenFor(binaryVersion),
        file: new File([Buffer.from('<html><script>alert(1)</script>')], 'blob.bin', {
          type: 'application/octet-stream',
        }),
      }),
    )
    expect(rejected.status).toBe(400)
    expect(disguised.storage.put).not.toHaveBeenCalled()
  })

  it('bounds chunked multipart input even without Content-Length', async () => {
    const harness = makeHarness()
    const request = new Request(`http://localhost/api/forms/${LOCATOR}/uploads`, {
      method: 'POST',
      headers: {
        'content-type': 'multipart/form-data; boundary=x',
        'x-captcha-response': 'captcha',
      },
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(101 * 1_024 * 1_024))
          controller.close()
        },
      }),
      duplex: 'half',
    } as RequestInit)
    const response = await harness.call(request)
    expect(response.status).toBe(413)
    expect(harness.consume).toHaveBeenCalledTimes(2)
    expect(harness.storage.put).not.toHaveBeenCalled()
  })

  it('deletes a just-stored object after DB failure only when its path is unreferenced', async () => {
    const failure = new Error('DB unavailable')
    const unshared = makeHarness({ transactionError: failure, sharedPathCount: 0 })
    const failed = await unshared.call()
    expect(failed.status).toBe(500)
    await expect(failed.json()).resolves.toEqual({ error: 'FORM_UPLOAD_FAILED' })
    expect(unshared.storage.delete).toHaveBeenCalledOnce()
    expect(unshared.tx.$queryRaw).toHaveBeenCalledTimes(2)
    expect(unshared.tx.$queryRaw.mock.invocationCallOrder[1]).toBeLessThan(
      unshared.storage.delete.mock.invocationCallOrder[0]!,
    )

    const shared = makeHarness({ transactionError: failure, sharedPathCount: 1 })
    expect((await shared.call()).status).toBe(500)
    expect(shared.storage.delete).not.toHaveBeenCalled()

    const cleanupFailure = makeHarness({
      transactionError: failure,
      sharedPathCount: 0,
      storageDeleteError: new Error('delete secret'),
    })
    const safe = await cleanupFailure.call()
    expect(safe.status).toBe(500)
    await expect(safe.json()).resolves.toEqual({ error: 'FORM_UPLOAD_FAILED' })
  })

  it('returns a safe failure and never starts persistence when storage.put fails', async () => {
    const harness = makeHarness({ storagePutError: new Error('s3.internal secret') })
    const response = await harness.call()
    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'FORM_UPLOAD_FAILED' })
    expect(harness.prisma.$transaction).toHaveBeenCalledOnce()
    expect(harness.fileCreate).not.toHaveBeenCalled()
    expect(harness.storage.delete).not.toHaveBeenCalled()
  })
})

describe('own-response database form upload route', () => {
  const editable = () => ({
    status: 'EDIT',
    locator: LOCATOR,
    form: { ...form(), state: 'CLOSED', respondentAccess: 'EDIT' },
    version: version(),
    submission: { id: SUBMISSION_ID },
    respondentUserId: RESPONDENT_ID,
  })

  beforeEach(() => vi.clearAllMocks())

  it('creates a lease for the submitted version while the form is CLOSED', async () => {
    const harness = makeHarness({ ownResolved: editable(), actorUserId: RESPONDENT_ID })
    const response = await harness.callOwn()
    const body = (await response.json()) as { uploadToken: string }

    expect(response.status).toBe(201)
    expect(harness.formAccess.resolveOwnResponse).toHaveBeenCalledWith(
      LOCATOR,
      SUBMISSION_ID,
      RESPONDENT_ID,
    )
    expect(harness.formAccess.resolvePublished).not.toHaveBeenCalled()
    expect(harness.uploadCreate.mock.calls[0]![0].data).toMatchObject({
      formId: FORM_ID,
      versionId: VERSION_ID,
      questionId: QUESTION_ID,
    })
    expect(
      verifyOwnResponseUploadToken(body.uploadToken, SECRET, {
        formId: FORM_ID,
        versionId: VERSION_ID,
        questionId: QUESTION_ID,
        submissionId: SUBMISSION_ID,
        actorUserId: RESPONDENT_ID,
      }),
    ).toBe(true)
    expect(
      verifyOwnResponseUploadToken(body.uploadToken, SECRET, {
        formId: FORM_ID,
        versionId: VERSION_ID,
        questionId: QUESTION_ID,
        submissionId: 'cccccccc-cccc-7ccc-8ccc-cccccccccccc',
        actorUserId: RESPONDENT_ID,
      }),
    ).toBe(false)
    expect(
      verifyOwnResponseUploadToken(body.uploadToken, SECRET, {
        formId: FORM_ID,
        versionId: VERSION_ID,
        questionId: QUESTION_ID,
        submissionId: SUBMISSION_ID,
        actorUserId: OWNER_ID,
      }),
    ).toBe(false)
    expect(harness.uploadCreate.mock.calls[0]![0].data.uploadTokenHash).toBe(
      createHash('sha256').update(body.uploadToken).digest('hex'),
    )
    expect(harness.fileCreate.mock.calls[0]![0].data).toMatchObject({ userId: RESPONDENT_ID })
  })

  it.each([
    ['anonymous actor', null, editable(), undefined],
    ['inaccessible response', RESPONDENT_ID, { status: 'UNAVAILABLE' }, undefined],
    ['forged context token', RESPONDENT_ID, editable(), 'forged'],
  ])('rejects %s without storage', async (_label, actorUserId, ownResolved, token) => {
    const harness = makeHarness({ ownResolved, actorUserId })
    const response = await harness.callOwn(ownUploadRequest({ token }))

    expect(response.status).toBe(404)
    expect(harness.storage.put).not.toHaveBeenCalled()
  })

  it('rechecks EDIT access after the workspace lock', async () => {
    const harness = makeHarness({
      ownResolved: editable(),
      lockedOwnResolved: { status: 'UNAVAILABLE' },
      actorUserId: RESPONDENT_ID,
    })
    const response = await harness.callOwn()

    expect(response.status).toBe(404)
    expect(harness.formAccess.resolveOwnResponse).toHaveBeenCalledTimes(2)
    expect(harness.storage.put).not.toHaveBeenCalled()
  })
})
