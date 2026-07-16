import { createCipheriv, createDecipheriv, createHash, createHmac } from 'node:crypto'

export type OwnResponseSelectionKind = 'PERSON' | 'RELATION' | 'PAGE_LINK'

export interface OwnResponseSelectionContext {
  locator: string
  submissionId: string
  actorUserId: string
  versionId: string
  questionId: string
  kind: OwnResponseSelectionKind
}

const PREFIX = 'ors1'
const PART = /^[A-Za-z0-9_-]+$/u

const keyFrom = (secret: string): Buffer => {
  if (Buffer.byteLength(secret, 'utf8') < 32) throw new Error('FORM_TOKEN_SECRET_INVALID')
  return createHash('sha256').update(`form-own-selection-v1\u0000${secret}`).digest()
}

const aadFor = (context: OwnResponseSelectionContext): Buffer =>
  Buffer.from(
    [
      PREFIX,
      context.locator,
      context.submissionId,
      context.actorUserId,
      context.versionId,
      context.questionId,
      context.kind,
    ].join('\u0000'),
  )

const nonceFor = (targetId: string, secret: string, context: OwnResponseSelectionContext): Buffer =>
  createHmac('sha256', keyFrom(secret))
    .update('form-own-selection-nonce-v1\u0000')
    .update(aadFor(context))
    .update('\u0000')
    .update(targetId)
    .digest()
    .subarray(0, 12)

/** AES-GCM keeps database identifiers confidential as well as tamper-proof. */
export function sealOwnResponseSelection(
  targetId: string,
  secret: string,
  context: OwnResponseSelectionContext,
): string {
  // Stable only inside this response/question context, so the picker can
  // recognize an already selected value without making IDs linkable across
  // responses. HMAC-derived nonces collide only with negligible probability.
  const nonce = nonceFor(targetId, secret, context)
  const cipher = createCipheriv('aes-256-gcm', keyFrom(secret), nonce)
  cipher.setAAD(aadFor(context))
  const encrypted = Buffer.concat([cipher.update(targetId, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [
    PREFIX,
    nonce.toString('base64url'),
    encrypted.toString('base64url'),
    tag.toString('base64url'),
  ].join('.')
}

export function openOwnResponseSelection(
  token: string,
  secret: string,
  context: OwnResponseSelectionContext,
): string | null {
  const [prefix, noncePart, encryptedPart, tagPart, extra] = token.split('.')
  if (
    prefix !== PREFIX ||
    !noncePart ||
    !encryptedPart ||
    !tagPart ||
    extra !== undefined ||
    !PART.test(noncePart) ||
    !PART.test(encryptedPart) ||
    !PART.test(tagPart)
  ) {
    return null
  }
  try {
    const nonce = Buffer.from(noncePart, 'base64url')
    const encrypted = Buffer.from(encryptedPart, 'base64url')
    const tag = Buffer.from(tagPart, 'base64url')
    if (
      nonce.toString('base64url') !== noncePart ||
      encrypted.toString('base64url') !== encryptedPart ||
      tag.toString('base64url') !== tagPart ||
      nonce.length !== 12 ||
      tag.length !== 16
    ) {
      return null
    }
    const decipher = createDecipheriv('aes-256-gcm', keyFrom(secret), nonce)
    decipher.setAAD(aadFor(context))
    decipher.setAuthTag(tag)
    const targetId = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
    return targetId.length > 0 && targetId.length <= 512 ? targetId : null
  } catch {
    return null
  }
}
