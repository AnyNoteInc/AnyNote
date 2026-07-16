import { createHmac, timingSafeEqual } from 'node:crypto'

import { z } from 'zod'

const TOKEN_DOMAIN = 'form-own-response-v1.'
const MINIMUM_SECRET_BYTES = 32
const BASE64URL = /^[A-Za-z0-9_-]+$/u
const SHA256_HEX = /^[a-f0-9]{64}$/u

const payloadSchema = z
  .object({
    locatorHash: z.string().regex(SHA256_HEX),
    submissionId: z.string().uuid(),
    actorUserId: z.string().uuid(),
    versionNumber: z.number().int().positive(),
    schemaHash: z.string().regex(SHA256_HEX),
    questionId: z.string().min(1).max(64),
    issuedAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().positive(),
  })
  .strict()

export type FormOwnResponseTokenPayload = z.infer<typeof payloadSchema>

const assertSecret = (secret: string): void => {
  if (Buffer.byteLength(secret, 'utf8') < MINIMUM_SECRET_BYTES) {
    throw new Error('FORM_TOKEN_SECRET_INVALID')
  }
}

const signature = (body: string, secret: string): Buffer =>
  createHmac('sha256', secret).update(`${TOKEN_DOMAIN}${body}`).digest()

const decode = (value: string): Buffer => {
  if (!BASE64URL.test(value)) throw new Error('FORM_OWN_RESPONSE_TOKEN_INVALID')
  const decoded = Buffer.from(value, 'base64url')
  if (decoded.toString('base64url') !== value) throw new Error('FORM_OWN_RESPONSE_TOKEN_INVALID')
  return decoded
}

export function signFormOwnResponseToken(
  payload: FormOwnResponseTokenPayload,
  secret: string,
): string {
  assertSecret(secret)
  const parsed = payloadSchema.parse(payload)
  const body = Buffer.from(JSON.stringify(parsed)).toString('base64url')
  return `${body}.${signature(body, secret).toString('base64url')}`
}

export function verifyFormOwnResponseToken(
  token: string,
  secret: string,
  now = Date.now(),
): FormOwnResponseTokenPayload {
  assertSecret(secret)
  const [body, encodedSignature, extra] = token.split('.')
  if (!body || !encodedSignature || extra !== undefined) {
    throw new Error('FORM_OWN_RESPONSE_TOKEN_INVALID')
  }
  const received = decode(encodedSignature)
  const expected = signature(body, secret)
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    throw new Error('FORM_OWN_RESPONSE_TOKEN_INVALID')
  }
  let payload: FormOwnResponseTokenPayload
  try {
    payload = payloadSchema.parse(JSON.parse(decode(body).toString('utf8')))
  } catch {
    throw new Error('FORM_OWN_RESPONSE_TOKEN_INVALID')
  }
  if (now >= payload.expiresAt) throw new Error('FORM_OWN_RESPONSE_TOKEN_EXPIRED')
  return payload
}
