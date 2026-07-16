import { createHmac, timingSafeEqual } from 'node:crypto'

import { z } from 'zod'

const MINIMUM_SECRET_BYTES = 32
const TOKEN_DOMAIN = 'form-v1.'
const BASE64URL = /^[A-Za-z0-9_-]+$/
const SHA256_HEX = /^[a-f0-9]{64}$/

const formVersionTokenPayloadSchema = z
  .object({
    locatorHash: z.string().regex(SHA256_HEX),
    versionNumber: z.number().int().positive(),
    schemaHash: z.string().regex(SHA256_HEX),
    linkRevision: z.number().int().positive(),
    issuedAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().positive(),
  })
  .strict()

export type FormVersionTokenPayload = z.infer<typeof formVersionTokenPayloadSchema>

export type FormVersionContext = Pick<
  FormVersionTokenPayload,
  'locatorHash' | 'versionNumber' | 'schemaHash' | 'linkRevision'
> & {
  isCurrent: boolean
  acceptUntil: Date | null
}

function assertSecret(secret: string): void {
  if (Buffer.byteLength(secret, 'utf8') < MINIMUM_SECRET_BYTES) {
    throw new Error('FORM_TOKEN_SECRET_INVALID')
  }
}

function invalidToken(): Error {
  return new Error('FORM_TOKEN_INVALID')
}

function decodeCanonicalBase64Url(encoded: string): Buffer {
  if (!BASE64URL.test(encoded)) throw invalidToken()

  const decoded = Buffer.from(encoded, 'base64url')
  if (decoded.toString('base64url') !== encoded) throw invalidToken()
  return decoded
}

function signatureFor(body: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(`${TOKEN_DOMAIN}${body}`).digest()
}

export function signFormVersionToken(payload: FormVersionTokenPayload, secret: string): string {
  assertSecret(secret)
  formVersionTokenPayloadSchema.parse(payload)
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signature = signatureFor(body, secret).toString('base64url')
  return `${body}.${signature}`
}

export function verifyFormVersionToken(
  token: string,
  secret: string,
  now = Date.now(),
): FormVersionTokenPayload {
  assertSecret(secret)
  const segments = token.split('.')
  if (segments.length !== 2) throw invalidToken()

  const [body, encodedSignature] = segments
  if (!body || !encodedSignature) throw invalidToken()

  let signature: Buffer
  try {
    signature = decodeCanonicalBase64Url(encodedSignature)
  } catch {
    throw invalidToken()
  }

  const expectedSignature = signatureFor(body, secret)
  if (
    signature.length !== expectedSignature.length ||
    !timingSafeEqual(signature, expectedSignature)
  ) {
    throw invalidToken()
  }

  let payload: FormVersionTokenPayload
  try {
    const decoded = decodeCanonicalBase64Url(body)
    payload = formVersionTokenPayloadSchema.parse(JSON.parse(decoded.toString('utf8')))
  } catch {
    throw invalidToken()
  }

  if (now >= payload.expiresAt) throw new Error('FORM_TOKEN_EXPIRED')
  return payload
}

export function assertFormVersionContext(
  payload: FormVersionTokenPayload,
  context: FormVersionContext,
  now = Date.now(),
): void {
  if (
    payload.locatorHash !== context.locatorHash ||
    payload.versionNumber !== context.versionNumber ||
    payload.schemaHash !== context.schemaHash ||
    payload.linkRevision !== context.linkRevision
  ) {
    throw new Error('FORM_TOKEN_CONTEXT_MISMATCH')
  }

  if (!context.isCurrent) {
    const acceptUntil = context.acceptUntil?.getTime()
    if (acceptUntil === undefined || !Number.isFinite(acceptUntil) || acceptUntil <= now) {
      throw new Error('FORM_VERSION_STALE')
    }
  }
}
