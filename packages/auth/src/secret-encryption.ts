import crypto from 'node:crypto'

export type EncryptedPayload = {
  iv: string
  ciphertext: string
  tag: string
}

const ALGO = 'aes-256-gcm'

function getKey(): Buffer {
  const raw = process.env.SECRETS_ENCRYPTION_KEY
  if (!raw) throw new Error('SECRETS_ENCRYPTION_KEY is not set')
  const key = Buffer.from(raw, 'base64')
  if (key.length !== 32) {
    throw new Error('SECRETS_ENCRYPTION_KEY must decode to 32 bytes')
  }
  return key
}

export function encryptSecret(plaintext: string): EncryptedPayload {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return {
    iv: iv.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  }
}

export function decryptSecret(payload: EncryptedPayload): string {
  const iv = Buffer.from(payload.iv, 'base64')
  if (iv.length !== 12) {
    throw new Error('Invalid IV length: expected 12 bytes')
  }
  const tag = Buffer.from(payload.tag, 'base64')
  if (tag.length !== 16) {
    throw new Error('Invalid auth tag length: expected 16 bytes')
  }
  const decipher = crypto.createDecipheriv(ALGO, getKey(), iv)
  decipher.setAuthTag(tag)
  const plain = Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, 'base64')),
    decipher.final(),
  ])
  return plain.toString('utf8')
}
