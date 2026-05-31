import { describe, expect, it } from 'vitest'
import { extractTextFromFile, isInlineTextType, MAX_INLINE_FILE_BYTES } from '../src/file-text'

describe('isInlineTextType', () => {
  it('accepts whitelisted extensions', () => {
    expect(isInlineTextType('md')).toBe(true)
    expect(isInlineTextType('ts')).toBe(true)
    expect(isInlineTextType('sql')).toBe(true)
  })
  it('rejects non-whitelisted', () => {
    expect(isInlineTextType('png')).toBe(false)
    expect(isInlineTextType('zip')).toBe(false)
  })
})

describe('extractTextFromFile', () => {
  it('returns utf-8 text for a plain text buffer', async () => {
    const buf = Buffer.from('# Hello\nworld', 'utf8')
    const out = await extractTextFromFile(buf, 'text/markdown', 'md', MAX_INLINE_FILE_BYTES)
    expect(out).toBe('# Hello\nworld')
  })
  it('truncates to maxBytes (ascii) by bytes', async () => {
    const buf = Buffer.from('a'.repeat(1000), 'utf8')
    const out = await extractTextFromFile(buf, 'text/plain', 'txt', 100)
    expect(Buffer.byteLength(out, 'utf8')).toBeLessThanOrEqual(100)
  })
  it('truncates multibyte content on a char boundary without U+FFFD', async () => {
    // 'é' is 2 bytes in UTF-8; 50 of them = 100 bytes. Cap at 5 bytes → 2 full 'é' (4 bytes).
    const buf = Buffer.from('é'.repeat(50), 'utf8')
    const out = await extractTextFromFile(buf, 'text/plain', 'txt', 5)
    expect(Buffer.byteLength(out, 'utf8')).toBeLessThanOrEqual(5)
    expect(out).not.toContain('�')
    expect(out).toBe('éé')
  })
  it('throws for unsupported binary', async () => {
    const buf = Buffer.from([0x00, 0x01, 0x02])
    await expect(extractTextFromFile(buf, 'application/zip', 'zip', 1000)).rejects.toThrow()
  })
})
