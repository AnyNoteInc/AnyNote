const FIELD_KEY_PREFIX = 'q_'

export function encodeFormFieldKey(questionId: string): string {
  const bytes = new TextEncoder().encode(questionId)
  return `${FIELD_KEY_PREFIX}${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

export function decodeFormFieldKey(fieldKey: string): string {
  const hex = fieldKey.startsWith(FIELD_KEY_PREFIX) ? fieldKey.slice(FIELD_KEY_PREFIX.length) : ''
  if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/u.test(hex)) {
    throw new Error('INVALID_FORM_FIELD_KEY')
  }

  const bytes = new Uint8Array(hex.length / 2)
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16)
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}
