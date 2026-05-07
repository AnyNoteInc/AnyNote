import { Readable } from 'node:stream'

import { describe, expect, it, vi } from 'vitest'

import { embedImagesAndRewriteLinks } from '@/server/page-export/embed-images'

const baseUrl = 'https://anynote.test'

function makeStorage(map: Record<string, { mime: string; bytes: Buffer }>) {
  return {
    get: vi.fn(async (key: string) => {
      const entry = map[key]
      if (!entry) throw new Error('not found: ' + key)
      return Readable.from([entry.bytes])
    }),
    put: vi.fn(),
    delete: vi.fn(),
    exists: vi.fn(),
  }
}

function makePrisma(files: Array<{ id: string; path: string; mimeType: string }>) {
  return {
    file: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        files.filter((f) => where.id.in.includes(f.id)),
      ),
    },
  } as const
}

describe('embedImagesAndRewriteLinks', () => {
  it('replaces /api/files/<id> images with data: URIs', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47])
    const storage = makeStorage({ 'pages/abc/image.png': { mime: 'image/png', bytes: png } })
    const prisma = makePrisma([{ id: 'abc', path: 'pages/abc/image.png', mimeType: 'image/png' }])

    const html = '<p><img src="/api/files/abc" alt="pic"></p>'
    const out = await embedImagesAndRewriteLinks(html, { storage, prisma, baseUrl })

    expect(out).toContain('src="data:image/png;base64,')
    expect(out).toContain(png.toString('base64'))
    expect(out).not.toContain('/api/files/abc')
  })

  it('leaves data: URIs untouched', async () => {
    const html = '<img src="data:image/png;base64,AAAA">'
    const storage = makeStorage({})
    const prisma = makePrisma([])
    const out = await embedImagesAndRewriteLinks(html, { storage, prisma, baseUrl })
    expect(out).toContain('src="data:image/png;base64,AAAA"')
  })

  it('leaves external URLs untouched', async () => {
    const html = '<img src="https://example.com/x.png">'
    const storage = makeStorage({})
    const prisma = makePrisma([])
    const out = await embedImagesAndRewriteLinks(html, { storage, prisma, baseUrl })
    expect(out).toContain('src="https://example.com/x.png"')
  })

  it('leaves the <img> intact when storage fetch fails', async () => {
    const storage = {
      get: vi.fn(async () => {
        throw new Error('S3 down')
      }),
      put: vi.fn(),
      delete: vi.fn(),
      exists: vi.fn(),
    }
    const prisma = makePrisma([{ id: 'abc', path: 'pages/abc/x.png', mimeType: 'image/png' }])
    const html = '<img src="/api/files/abc">'
    const out = await embedImagesAndRewriteLinks(html, { storage, prisma, baseUrl })
    expect(out).toContain('src="/api/files/abc"')
  })

  it('rewrites internal page links to absolute URLs', async () => {
    const storage = makeStorage({})
    const prisma = makePrisma([])
    const html = '<a href="/workspaces/ws-1/pages/p-1">Link</a>'
    const out = await embedImagesAndRewriteLinks(html, { storage, prisma, baseUrl })
    expect(out).toContain('href="https://anynote.test/workspaces/ws-1/pages/p-1"')
  })

  it('rewrites file-attachment data-url + wrapping <a href>', async () => {
    const storage = makeStorage({})
    const prisma = makePrisma([])
    const html =
      '<div data-type="file-attachment" data-url="/api/files/zzz" data-name="doc.pdf"></div>'
    const out = await embedImagesAndRewriteLinks(html, { storage, prisma, baseUrl })
    expect(out).toContain('data-url="https://anynote.test/api/files/zzz"')
  })
})
