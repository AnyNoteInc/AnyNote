import { afterEach, describe, expect, it } from 'vitest'

import { resolveDrawioUrl } from '../src/lib/drawio-config'

describe('resolveDrawioUrl', () => {
  const original = process.env.NEXT_PUBLIC_DRAWIO_URL

  afterEach(() => {
    if (original === undefined) delete process.env.NEXT_PUBLIC_DRAWIO_URL
    else process.env.NEXT_PUBLIC_DRAWIO_URL = original
  })

  it('falls back to embed.diagrams.net when unset', () => {
    delete process.env.NEXT_PUBLIC_DRAWIO_URL
    expect(resolveDrawioUrl()).toBe('https://embed.diagrams.net')
  })

  it('returns the configured url when set', () => {
    process.env.NEXT_PUBLIC_DRAWIO_URL = 'https://draw.example.com'
    expect(resolveDrawioUrl()).toBe('https://draw.example.com')
  })
})
