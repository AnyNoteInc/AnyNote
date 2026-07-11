import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  GotenbergTimeoutError,
  GotenbergUnreachableError,
  GotenbergUpstreamError,
} from './errors.ts'
import { htmlToPdf } from './html-to-pdf.ts'

describe('htmlToPdf', () => {
  it('maps a missing GOTENBERG_URL to GotenbergUnreachableError (no raw env error)', async () => {
    delete process.env.GOTENBERG_URL
    await expect(htmlToPdf('<p>x</p>')).rejects.toBeInstanceOf(GotenbergUnreachableError)
  })

  const originalFetch = globalThis.fetch
  beforeEach(() => {
    process.env.GOTENBERG_URL = 'http://gotenberg.test'
    process.env.GOTENBERG_TIMEOUT_MS = '5000'
  })
  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('POSTs multipart/form-data to /forms/chromium/convert/html', async () => {
    let capturedUrl: string | undefined
    let capturedInit: RequestInit | undefined
    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      capturedUrl = url
      capturedInit = init
      const stream = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(new Uint8Array([0x25, 0x50, 0x44, 0x46]))
          c.close()
        },
      })
      return new Response(stream, { status: 200, headers: { 'content-type': 'application/pdf' } })
    }) as typeof fetch

    const out = await htmlToPdf('<html></html>')
    expect(capturedUrl).toBe('http://gotenberg.test/forms/chromium/convert/html')
    expect(capturedInit?.method).toBe('POST')
    expect(capturedInit?.body).toBeInstanceOf(FormData)
    const body = capturedInit?.body as FormData
    expect(body.get('paperWidth')).toBe('8.27')
    expect(body.get('paperHeight')).toBe('11.69')
    expect(body.get('marginTop')).toBe('0.79')
    expect(body.get('marginBottom')).toBe('0.79')
    expect(body.get('marginLeft')).toBe('0.79')
    expect(body.get('marginRight')).toBe('0.79')
    expect(body.get('printBackground')).toBe('true')
    expect(out).toBeInstanceOf(ReadableStream)
  })

  it('throws GotenbergTimeoutError on AbortError/TimeoutError', async () => {
    globalThis.fetch = vi.fn(async () => {
      const e = new Error('aborted')
      e.name = 'TimeoutError'
      throw e
    }) as typeof fetch
    await expect(htmlToPdf('<html></html>')).rejects.toBeInstanceOf(GotenbergTimeoutError)
  })

  it('throws GotenbergUnreachableError on generic network errors', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('ECONNREFUSED')
    }) as typeof fetch
    await expect(htmlToPdf('<html></html>')).rejects.toBeInstanceOf(GotenbergUnreachableError)
  })

  it('throws GotenbergUpstreamError on non-2xx', async () => {
    globalThis.fetch = vi.fn(async () => new Response('boom', { status: 503 })) as typeof fetch
    await expect(htmlToPdf('<html></html>')).rejects.toBeInstanceOf(GotenbergUpstreamError)
  })

  it('throws GotenbergUpstreamError when 200 has no body', async () => {
    globalThis.fetch = vi.fn(async () => new Response(null, { status: 200 })) as typeof fetch
    await expect(htmlToPdf('<html></html>')).rejects.toBeInstanceOf(GotenbergUpstreamError)
  })
})
