import { createHash } from 'node:crypto'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  conflict,
  FormValidationError,
  type FormSubmissionResult,
  type FormVersionRecord,
  type PublicFormRecord,
  type PublishedFormResolution,
} from '@repo/domain'

import { createFormRouter } from '../src/routers/form'
import { hashFormLocator, signFormVersionToken } from '../src/helpers/form-version-token'
import { createCallerFactory } from '../src/trpc'

const NOW = Date.UTC(2026, 6, 16, 9)
const SECRET = 'task-11-submit-token-secret-at-least-32-bytes'
const USER_ID = '00000000-0000-7000-8000-000000000001'
const WORKSPACE_ID = '00000000-0000-7000-8000-000000000002'
const SOURCE_ID = '00000000-0000-7000-8000-000000000003'
const SOURCE_PAGE_ID = '00000000-0000-7000-8000-000000000004'
const FORM_ID = '00000000-0000-7000-8000-000000000005'
const VERSION_ID = '00000000-0000-7000-8000-000000000006'
const SUBMISSION_ID = '00000000-0000-7000-8000-000000000007'
const ROW_ID = '00000000-0000-7000-8000-000000000008'
const RESPONSE_PAGE_ID = '00000000-0000-7000-8000-000000000009'
const IDEMPOTENCY_KEY = '00000000-0000-7000-8000-00000000000a'
const MAX_SERIALIZED_ANSWERS_BYTES = 1_048_576

const versionSchema = { schemaVersion: 1, questions: [] }
const schemaHash = createHash('sha256').update(JSON.stringify(versionSchema)).digest('hex')

const version: FormVersionRecord = {
  id: VERSION_ID,
  formId: FORM_ID,
  versionNumber: 3,
  schemaVersion: 1,
  schema: versionSchema,
  schemaHash,
  publishedById: USER_ID,
  publishedAt: new Date(NOW - 60_000),
  acceptUntil: null,
}

const form: PublicFormRecord = {
  id: FORM_ID,
  sourceId: SOURCE_ID,
  routeKey: 'anf_submit-key',
  customSlug: 'submit-form',
  linkRevision: 2,
  state: 'OPEN',
  audience: 'ANYONE_WITH_LINK',
  respondentAccess: 'NONE',
  publishedVersionId: VERSION_ID,
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
}

const openResolution: PublishedFormResolution = {
  status: 'OPEN',
  locator: 'anf_submit-key',
  form,
  version,
  respondentUserId: null,
}

const createdResult: FormSubmissionResult = {
  submissionId: SUBMISSION_ID,
  endingId: 'ending-1',
  ownResponseUrl: null,
  created: true,
}

const replayResult: FormSubmissionResult = { ...createdResult, created: false }
const domainCreatedResult = {
  ...createdResult,
  rowId: ROW_ID,
  pageId: RESPONSE_PAGE_ID,
  submittedAt: new Date(NOW),
}
const domainReplayResult = { ...domainCreatedResult, created: false }
const ownResponseUrl = `/f/anf_submit-key/responses/${SUBMISSION_ID}`
const authenticatedCreatedResult: FormSubmissionResult = {
  ...createdResult,
  ownResponseUrl,
}
const domainAuthenticatedCreatedResult = {
  ...domainCreatedResult,
  ownResponseUrl,
}

function tokenFor(overrides: Partial<Parameters<typeof signFormVersionToken>[0]> = {}): string {
  return signFormVersionToken(
    {
      locatorHash: hashFormLocator('anf_submit-key'),
      versionNumber: version.versionNumber,
      schemaHash: version.schemaHash,
      linkRevision: form.linkRevision,
      issuedAt: NOW - 1_000,
      expiresAt: NOW + 60_000,
      ...overrides,
    },
    SECRET,
  )
}

type HarnessOptions = {
  replay?: FormSubmissionResult | null
  submitResult?: FormSubmissionResult
  replayError?: Error
  limiterResults?: readonly boolean[]
  captchaError?: Error
  resolved?: PublishedFormResolution
  resolveError?: Error
  submitError?: Error
  headers?: Headers
  userId?: string | null
  limiterDecision?: (scope: string, key: string, now: number) => boolean
}

function makeHarness(options: HarnessOptions = {}) {
  const order: string[] = []
  const resolvePublished = vi.fn(async () => {
    order.push('lookup')
    if (options.resolveError) throw options.resolveError
    return options.resolved ?? openResolution
  })
  const resolveVersion = vi.fn(async () => {
    order.push('version-context')
    return version
  })
  const findReplay = vi.fn(async () => {
    order.push('replay')
    if (options.replayError) throw options.replayError
    return options.replay ?? null
  })
  const submit = vi.fn(async () => {
    order.push('submit')
    if (options.submitError) throw options.submitError
    return options.submitResult ?? domainCreatedResult
  })
  const consume = vi.fn((scope: string, key: string, now: number) => {
    order.push(`limit:${scope}`)
    if (options.limiterDecision) return options.limiterDecision(scope, key, now)
    const result = options.limiterResults?.[consume.mock.calls.length - 1]
    return result ?? true
  })
  const verifyCaptcha = vi.fn(async () => {
    order.push('captcha')
    if (options.captchaError) throw options.captchaError
  })

  const router = createFormRouter({
    domain: {
      formAccess: { resolvePublished, resolveVersion },
      formSubmissions: { findReplay, submit },
      database: { listRows: vi.fn() },
    } as never,
    rateLimiter: { consume },
    verifyCaptcha,
    now: () => NOW,
  })
  const api = createCallerFactory(router)({
    prisma: {} as never,
    user:
      options.userId === undefined || options.userId === null
        ? null
        : ({
            id: options.userId,
            email: 'respondent@example.test',
            firstName: 'Response',
            lastName: 'Owner',
            emailVerified: true,
          } as never),
    headers:
      options.headers ??
      new Headers({
        'x-captcha-response': 'captcha-header-token',
        'x-forwarded-for': '203.0.113.10',
      }),
    resHeaders: new Headers(),
    yookassa: {} as never,
    returnUrlBase: 'http://localhost',
    jobs: { kick: vi.fn() },
  })

  return {
    api,
    order,
    resolvePublished,
    resolveVersion,
    findReplay,
    submit,
    consume,
    verifyCaptcha,
  }
}

function validInput(overrides: Record<string, unknown> = {}) {
  return {
    locator: 'anf_submit-key',
    versionToken: tokenFor(),
    idempotencyKey: IDEMPOTENCY_KEY,
    answers: { question: 'answer' },
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

describe('public database form submission', () => {
  it('applies lookup, replay-probe limit, submit limits, CAPTCHA and domain submit in order', async () => {
    const harness = makeHarness()

    await expect(harness.api.submit(validInput())).resolves.toEqual(createdResult)

    expect(harness.order).toEqual([
      'lookup',
      'limit:replay-ip',
      'replay',
      'limit:submit-ip',
      'limit:submit-form',
      'captcha',
      'submit',
    ])
    expect(harness.consume).toHaveBeenNthCalledWith(1, 'replay-ip', '203.0.113.10', NOW)
    expect(harness.consume).toHaveBeenNthCalledWith(2, 'submit-ip', `${FORM_ID}:203.0.113.10`, NOW)
    expect(harness.consume).toHaveBeenNthCalledWith(3, 'submit-form', FORM_ID, NOW)
    expect(harness.verifyCaptcha).toHaveBeenCalledWith({
      token: 'captcha-header-token',
      action: 'form_submit',
      headers: expect.any(Headers),
    })
    expect(harness.submit).toHaveBeenCalledWith(
      null,
      {
        locator: 'anf_submit-key',
        idempotencyKey: IDEMPOTENCY_KEY,
        answers: { question: 'answer' },
      },
      expect.objectContaining({
        locatorHash: hashFormLocator('anf_submit-key'),
        versionNumber: 3,
        schemaHash,
        linkRevision: 2,
      }),
    )
  })

  it('returns an exact replay only after signed and stored context revalidation', async () => {
    const harness = makeHarness({ replay: domainReplayResult })

    await expect(harness.api.submit(validInput())).resolves.toEqual(replayResult)

    expect(harness.order).toEqual(['lookup', 'limit:replay-ip', 'replay'])
    expect(harness.findReplay).toHaveBeenCalledWith(
      null,
      {
        locator: 'anf_submit-key',
        idempotencyKey: IDEMPOTENCY_KEY,
        answers: { question: 'answer' },
      },
      expect.objectContaining({ locatorHash: hashFormLocator('anf_submit-key') }),
    )
    expect(harness.consume).toHaveBeenCalledWith('replay-ip', '203.0.113.10', NOW)
    expect(harness.verifyCaptcha).not.toHaveBeenCalled()
    expect(harness.submit).not.toHaveBeenCalled()
  })

  it('returns a capped-form replay before limiter and CAPTCHA without leaking row internals', async () => {
    const harness = makeHarness({ resolved: { status: 'CAPPED' }, replay: domainReplayResult })

    await expect(harness.api.submit(validInput())).resolves.toEqual(replayResult)

    expect(harness.order).toEqual(['lookup', 'limit:replay-ip', 'replay'])
    expect(harness.consume).toHaveBeenCalledWith('replay-ip', '203.0.113.10', NOW)
    expect(harness.verifyCaptcha).not.toHaveBeenCalled()
    expect(harness.submit).not.toHaveBeenCalled()
  })

  it('returns the first success for the same key after that response caps the form', async () => {
    const harness = makeHarness()
    harness.findReplay.mockResolvedValueOnce(null).mockResolvedValueOnce(domainReplayResult)
    harness.resolvePublished
      .mockResolvedValueOnce(openResolution)
      .mockResolvedValueOnce({ status: 'CAPPED' })

    await expect(harness.api.submit(validInput())).resolves.toEqual(createdResult)
    await expect(harness.api.submit(validInput())).resolves.toEqual(replayResult)

    expect(harness.submit).toHaveBeenCalledOnce()
    expect(harness.verifyCaptcha).toHaveBeenCalledOnce()
    expect(harness.consume).toHaveBeenCalledTimes(4)
    expect(harness.findReplay).toHaveBeenCalledTimes(2)
  })

  it('bounds early replay probes globally per client IP across random idempotency keys', async () => {
    let remainingReplayProbes = 30
    const harness = makeHarness({
      limiterDecision: (scope) => scope !== 'replay-ip' || remainingReplayProbes-- > 0,
    })

    for (let index = 0; index < 35; index += 1) {
      const idempotencyKey = `00000000-0000-7000-8000-${index.toString(16).padStart(12, '0')}`
      await expect(harness.api.submit(validInput({ idempotencyKey }))).resolves.toEqual(
        createdResult,
      )
    }

    expect(harness.findReplay).toHaveBeenCalledTimes(30)
    expect(harness.consume.mock.calls.filter(([scope]) => scope === 'replay-ip')).toHaveLength(35)
    expect(harness.verifyCaptcha).toHaveBeenCalledTimes(35)
    expect(harness.submit).toHaveBeenCalledTimes(35)
  })

  it('falls back through CAPTCHA and atomic submit when the early replay budget is exhausted', async () => {
    const harness = makeHarness({
      replay: domainReplayResult,
      submitResult: domainReplayResult,
      limiterDecision: (scope) => scope !== 'replay-ip',
    })

    await expect(harness.api.submit(validInput())).resolves.toEqual(replayResult)

    expect(harness.order).toEqual([
      'lookup',
      'limit:replay-ip',
      'limit:submit-ip',
      'limit:submit-form',
      'captcha',
      'submit',
    ])
    expect(harness.findReplay).not.toHaveBeenCalled()
    expect(harness.verifyCaptcha).toHaveBeenCalledOnce()
    expect(harness.submit).toHaveBeenCalledOnce()
  })

  it('normalizes the locator before binding an early replay to the signed token', async () => {
    const harness = makeHarness({ replay: domainReplayResult })

    await expect(
      harness.api.submit(
        validInput({
          locator: ' SUBMIT-FORM ',
          versionToken: tokenFor({ locatorHash: hashFormLocator('submit-form') }),
        }),
      ),
    ).resolves.toEqual(replayResult)

    expect(harness.order).toEqual(['lookup', 'limit:replay-ip', 'replay'])
    expect(harness.findReplay).toHaveBeenCalledOnce()
    expect(harness.verifyCaptcha).not.toHaveBeenCalled()
    expect(harness.submit).not.toHaveBeenCalled()
  })

  it('skips the early replay probe when the locator does not match the signed token', async () => {
    const harness = makeHarness({
      replay: domainReplayResult,
      submitError: conflict('FORM_VERSION_STALE'),
    })

    await expect(harness.api.submit(validInput({ locator: 'other-form' }))).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'FORM_VERSION_STALE',
    })

    expect(harness.order).toEqual([
      'lookup',
      'limit:submit-ip',
      'limit:submit-form',
      'captcha',
      'submit',
    ])
    expect(harness.findReplay).not.toHaveBeenCalled()
    expect(harness.verifyCaptcha).toHaveBeenCalledOnce()
    expect(harness.submit).toHaveBeenCalledOnce()
    expect(harness.consume).not.toHaveBeenCalledWith(
      'replay-ip',
      expect.any(String),
      expect.any(Number),
    )
  })

  it('shares one unavailable-form limiter bucket across locator variants', async () => {
    const harness = makeHarness({
      resolved: { status: 'CLOSED' },
      submitError: conflict('FORM_NOT_ACCEPTING'),
    })

    for (const locator of ['missing-form', 'MISSING-FORM', 'candidate-form']) {
      await expect(harness.api.submit(validInput({ locator }))).rejects.toMatchObject({
        code: 'CONFLICT',
        message: 'FORM_NOT_ACCEPTING',
      })
    }

    const submitIpKeys = harness.consume.mock.calls
      .filter(([scope]) => scope === 'submit-ip')
      .map(([, key]) => key)
    const submitFormKeys = harness.consume.mock.calls
      .filter(([scope]) => scope === 'submit-form')
      .map(([, key]) => key)
    expect(new Set(submitIpKeys)).toHaveProperty('size', 1)
    expect(new Set(submitFormKeys)).toHaveProperty('size', 1)
  })

  it('sanitizes an infrastructure failure during the public form lookup', async () => {
    const databaseFailure = new Error('relation forms does not exist at db.internal:5432')
    const harness = makeHarness({ resolveError: databaseFailure })

    await expect(harness.api.submit(validInput())).rejects.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'FORM_SUBMISSION_FAILED',
      cause: databaseFailure,
    })

    expect(harness.order).toEqual(['lookup'])
    expect(harness.consume).not.toHaveBeenCalled()
    expect(harness.verifyCaptcha).not.toHaveBeenCalled()
    expect(harness.submit).not.toHaveBeenCalled()
  })

  it('sanitizes an infrastructure failure during the early replay lookup', async () => {
    const databaseFailure = new Error('database unavailable for submission secret-row-id')
    const harness = makeHarness({ replayError: databaseFailure })

    await expect(harness.api.submit(validInput())).rejects.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'FORM_SUBMISSION_FAILED',
      cause: databaseFailure,
    })

    expect(harness.order).toEqual(['lookup', 'limit:replay-ip', 'replay'])
    expect(harness.consume).toHaveBeenCalledWith('replay-ip', '203.0.113.10', NOW)
    expect(harness.verifyCaptcha).not.toHaveBeenCalled()
    expect(harness.submit).not.toHaveBeenCalled()
  })

  it('sanitizes an infrastructure failure during the final atomic submit', async () => {
    const databaseFailure = new Error('duplicate key value exposes private-row-id')
    const harness = makeHarness({ submitError: databaseFailure })

    await expect(harness.api.submit(validInput())).rejects.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'FORM_SUBMISSION_FAILED',
      cause: databaseFailure,
    })

    expect(harness.order).toEqual([
      'lookup',
      'limit:replay-ip',
      'replay',
      'limit:submit-ip',
      'limit:submit-form',
      'captcha',
      'submit',
    ])
  })

  it('never probes replay with a forged token and rejects it only after protection checks', async () => {
    const harness = makeHarness({ replay: replayResult })

    await expect(
      harness.api.submit(validInput({ versionToken: 'forged.token' })),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED', message: 'FORM_REFRESH_REQUIRED' })

    expect(harness.findReplay).not.toHaveBeenCalled()
    expect(harness.order).toEqual(['lookup', 'limit:submit-ip', 'limit:submit-form', 'captcha'])
    expect(harness.submit).not.toHaveBeenCalled()
  })

  it('never returns replay when the domain rejects its stored version context', async () => {
    const harness = makeHarness({ replayError: conflict('FORM_VERSION_STALE') })

    await expect(harness.api.submit(validInput())).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: 'FORM_REFRESH_REQUIRED',
    })

    expect(harness.findReplay).toHaveBeenCalledOnce()
    expect(harness.order).toEqual([
      'lookup',
      'limit:replay-ip',
      'replay',
      'limit:submit-ip',
      'limit:submit-form',
      'captcha',
    ])
    expect(harness.submit).not.toHaveBeenCalled()
  })

  it('lets the domain return the authoritative unavailable state after protection checks', async () => {
    const harness = makeHarness({
      resolved: { status: 'CLOSED' },
      submitError: conflict('FORM_NOT_ACCEPTING'),
    })

    await expect(harness.api.submit(validInput())).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'FORM_NOT_ACCEPTING',
    })

    expect(harness.findReplay).toHaveBeenCalledOnce()
    expect(harness.order).toEqual([
      'lookup',
      'limit:replay-ip',
      'replay',
      'limit:submit-ip',
      'limit:submit-form',
      'captcha',
      'submit',
    ])
  })

  it('accepts answers at the exact 1 MiB serialized boundary', async () => {
    const harness = makeHarness()
    const answers = { q: 'a'.repeat(MAX_SERIALIZED_ANSWERS_BYTES - 8) }
    expect(Buffer.byteLength(JSON.stringify(answers), 'utf8')).toBe(MAX_SERIALIZED_ANSWERS_BYTES)

    await expect(harness.api.submit(validInput({ answers }))).resolves.toEqual(createdResult)

    expect(harness.submit).toHaveBeenCalledOnce()
  })

  it('rejects answers over 1 MiB before lookup or dynamic validation', async () => {
    const harness = makeHarness()
    const answers = { q: 'a'.repeat(MAX_SERIALIZED_ANSWERS_BYTES - 7) }

    await expect(harness.api.submit(validInput({ answers }))).rejects.toMatchObject({
      code: 'PAYLOAD_TOO_LARGE',
      message: 'FORM_ANSWERS_TOO_LARGE',
    })

    expect(harness.resolvePublished).not.toHaveBeenCalled()
    expect(harness.submit).not.toHaveBeenCalled()
  })

  it('rejects more than 500 top-level answer keys before lookup or protection work', async () => {
    const harness = makeHarness()
    const answers = Object.fromEntries(
      Array.from({ length: 501 }, (_, index) => [`q${index}`, null]),
    )

    await expect(harness.api.submit(validInput({ answers }))).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    })

    expect(harness.order).toEqual([])
    expect(harness.resolvePublished).not.toHaveBeenCalled()
    expect(harness.findReplay).not.toHaveBeenCalled()
    expect(harness.consume).not.toHaveBeenCalled()
    expect(harness.verifyCaptcha).not.toHaveBeenCalled()
  })

  it('measures the serialized payload in UTF-8 bytes rather than JavaScript characters', async () => {
    const harness = makeHarness()
    const answers = { q: 'é'.repeat(MAX_SERIALIZED_ANSWERS_BYTES / 2) }
    expect(JSON.stringify(answers).length).toBeLessThan(MAX_SERIALIZED_ANSWERS_BYTES)
    expect(Buffer.byteLength(JSON.stringify(answers), 'utf8')).toBeGreaterThan(
      MAX_SERIALIZED_ANSWERS_BYTES,
    )

    await expect(harness.api.submit(validInput({ answers }))).rejects.toMatchObject({
      code: 'PAYLOAD_TOO_LARGE',
      message: 'FORM_ANSWERS_TOO_LARGE',
    })

    expect(harness.resolvePublished).not.toHaveBeenCalled()
  })

  it('rejects a non-empty honeypot uniformly before any form work', async () => {
    const harness = makeHarness()

    await expect(harness.api.submit(validInput({ honeypot: '  bot  ' }))).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'FORM_PROTECTED',
    })

    expect(harness.order).toEqual([])
    expect(harness.submit).not.toHaveBeenCalled()
  })

  it('treats whitespace-only honeypot content as bot input', async () => {
    const harness = makeHarness()

    await expect(harness.api.submit(validInput({ honeypot: '   ' }))).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'FORM_PROTECTED',
    })

    expect(harness.order).toEqual([])
  })

  it('short-circuits an IP limit without consuming the global form budget', async () => {
    const ipLimited = makeHarness({ limiterResults: [true, false] })

    await expect(ipLimited.api.submit(validInput())).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'FORM_PROTECTED',
    })

    expect(ipLimited.order).toEqual(['lookup', 'limit:replay-ip', 'replay', 'limit:submit-ip'])
    expect(ipLimited.verifyCaptcha).not.toHaveBeenCalled()
    expect(ipLimited.submit).not.toHaveBeenCalled()
  })

  it('uses the same protection error when the global form limiter rejects', async () => {
    const formLimited = makeHarness({ limiterResults: [true, true, false] })

    await expect(formLimited.api.submit(validInput())).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'FORM_PROTECTED',
    })

    expect(formLimited.order).toEqual([
      'lookup',
      'limit:replay-ip',
      'replay',
      'limit:submit-ip',
      'limit:submit-form',
    ])
    expect(formLimited.verifyCaptcha).not.toHaveBeenCalled()
    expect(formLimited.submit).not.toHaveBeenCalled()
  })

  it('maps CAPTCHA rejection to the uniform protection error and does not submit', async () => {
    const harness = makeHarness({ captchaError: new Error('provider details') })

    await expect(harness.api.submit(validInput())).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'FORM_PROTECTED',
    })

    expect(harness.order.at(-1)).toBe('captcha')
    expect(harness.submit).not.toHaveBeenCalled()
  })

  it('keeps safe question-keyed field errors inspectable for server callers', async () => {
    const fieldErrors = { question: ['REQUIRED_ANSWER'] }
    const harness = makeHarness({ submitError: new FormValidationError(fieldErrors) })

    await expect(harness.api.submit(validInput())).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'FORM_ANSWERS_INVALID',
      cause: { details: { fieldErrors } },
    })
  })

  it('rejects a CAPTCHA token in the body before any form work', async () => {
    const harness = makeHarness({ headers: new Headers({ 'x-real-ip': '203.0.113.11' }) })

    await expect(
      harness.api.submit(validInput({ captchaToken: 'captcha-input-token' })),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })

    expect(harness.order).toEqual([])
    expect(harness.verifyCaptcha).not.toHaveBeenCalled()
  })

  it('returns only the authenticated public result and propagates the session actor', async () => {
    const harness = makeHarness({
      userId: USER_ID,
      submitResult: domainAuthenticatedCreatedResult,
    })

    await expect(harness.api.submit(validInput())).resolves.toEqual(authenticatedCreatedResult)

    expect(harness.findReplay).toHaveBeenCalledWith(USER_ID, expect.any(Object), expect.any(Object))
    expect(harness.submit).toHaveBeenCalledWith(USER_ID, expect.any(Object), expect.any(Object))
    expect(harness.submit.mock.calls[0]?.[1]).not.toHaveProperty('actorUserId')
  })
})
