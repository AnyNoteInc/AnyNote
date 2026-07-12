import { Readable } from 'node:stream'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authorizeFileRead: vi.fn(),
  exists: vi.fn(),
  get: vi.fn(),
  put: vi.fn(),
  officeToPdf: vi.fn(),
}))

vi.mock('@/lib/file-access', () => ({ authorizeFileRead: mocks.authorizeFileRead }))
vi.mock('@repo/storage', () => ({
  storage: { exists: mocks.exists, get: mocks.get, put: mocks.put },
}))
vi.mock('@repo/page-export', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@repo/page-export')>()
  return { ...actual, officeToPdf: mocks.officeToPdf }
})

import { GotenbergTimeoutError, GotenbergUnreachableError } from '@repo/page-export'

import { GET } from '../src/app/api/files/[id]/preview-pdf/route'

const params = (id: string) => ({ params: Promise.resolve({ id }) })
const req = new Request('http://localhost/api/files/f1/preview-pdf')

const officeFile = {
  id: 'f1',
  name: 'Отчёт',
  ext: 'docx',
  hash: 'abc123',
  path: 'ab/abc123.docx',
  mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
}

const pdfStream = () =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([37, 80, 68, 70]))
      controller.close()
    },
  })

describe('GET /api/files/[id]/preview-pdf', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.authorizeFileRead.mockResolvedValue({ ok: true, file: officeFile })
    mocks.put.mockResolvedValue(undefined)
  })

  it('пробрасывает отказ авторизации как есть', async () => {
    mocks.authorizeFileRead.mockResolvedValue({
      ok: false,
      response: new Response('Forbidden', { status: 403 }),
    })
    const res = await GET(req as never, params('f1'))
    expect(res.status).toBe(403)
    expect(mocks.officeToPdf).not.toHaveBeenCalled()
  })

  it('415 для не-office файла', async () => {
    mocks.authorizeFileRead.mockResolvedValue({
      ok: true,
      file: { ...officeFile, mimeType: 'text/plain', ext: 'txt' },
    })
    const res = await GET(req as never, params('f1'))
    expect(res.status).toBe(415)
  })

  it('кэш-хит: отдаёт из S3 без конвертации', async () => {
    mocks.exists.mockResolvedValue(true)
    mocks.get.mockResolvedValue(Readable.from(Buffer.from('%PDF-cached')))
    const res = await GET(req as never, params('f1'))
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/pdf')
    expect(mocks.exists).toHaveBeenCalledWith('preview-pdf/abc123.pdf')
    expect(mocks.officeToPdf).not.toHaveBeenCalled()
  })

  it('конвертирует, кэширует и отдаёт PDF', async () => {
    mocks.exists.mockResolvedValue(false)
    mocks.get.mockResolvedValue(Readable.from(Buffer.from('docx-bytes')))
    mocks.officeToPdf.mockResolvedValue(pdfStream())
    const res = await GET(req as never, params('f1'))
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/pdf')
    expect(res.headers.get('Content-Disposition')).toContain('inline')
    expect(mocks.officeToPdf).toHaveBeenCalledWith(expect.any(Uint8Array), 'Отчёт.docx')
    expect(mocks.put).toHaveBeenCalledWith(
      'preview-pdf/abc123.pdf',
      expect.anything(),
      expect.objectContaining({ contentType: 'application/pdf' }),
    )
  })

  it('504 на таймауте Gotenberg, 502 на недоступности', async () => {
    mocks.exists.mockResolvedValue(false)
    mocks.get.mockResolvedValue(Readable.from(Buffer.from('x')))
    mocks.officeToPdf.mockRejectedValue(new GotenbergTimeoutError())
    expect((await GET(req as never, params('f1'))).status).toBe(504)

    mocks.get.mockResolvedValue(Readable.from(Buffer.from('x')))
    mocks.officeToPdf.mockRejectedValue(new GotenbergUnreachableError('down'))
    expect((await GET(req as never, params('f1'))).status).toBe(502)
  })
})
