import { describe, expect, it, jest } from '@jest/globals'
import { HttpException } from '@nestjs/common'
import type { PrismaClient } from '@repo/db'
import type { Domain } from '@repo/domain'
import { DomainError } from '@repo/domain'

import type { AuthContext } from '../../api/auth/auth-context.js'
import { makeFakeDomain } from '../services/__testutils__/fake-domain.js'
import type { FileUploader } from '../services/file-uploader.service.js'
import type { PagePdfService } from '../services/page-pdf.service.js'
import type { YjsPageEditor } from '../services/yjs-page-editor.service.js'
import { PagePdfTools, pdfFileName } from './page-pdf.tools.js'

const WS = '11111111-1111-4111-8111-111111111111'
const PAGE = '22222222-2222-4222-8222-222222222222'
const USER = 'user-1'

const auth: AuthContext = { userId: USER, scopes: ['files:write'] } as unknown as AuthContext

type Overrides = {
  page?: unknown
  live?: unknown
  exportAllowed?: () => Promise<void>
}

function makeTools(overrides: Overrides = {}) {
  const prisma = {
    workspaceMember: {
      findUnique: jest.fn<() => Promise<unknown>>(async () => ({ workspaceId: WS })),
    },
    workspaceBlockedUser: {
      findUnique: jest.fn<() => Promise<unknown>>(async () => null),
    },
    page: {
      findFirst: jest.fn<() => Promise<unknown>>(async () =>
        'page' in overrides
          ? overrides.page
          : { title: 'Моя страница', icon: '📄', content: { type: 'doc', content: [] }, type: 'TEXT' },
      ),
    },
  } as unknown as PrismaClient
  const domain = makeFakeDomain({
    security: {
      assertExportAllowed:
        overrides.exportAllowed ?? jest.fn<() => Promise<void>>(async () => undefined),
    } as unknown as Domain['security'],
  })
  const renderPagePdf = jest.fn<(input: unknown) => Promise<Buffer>>(async () =>
    Buffer.from('%PDF-1.7 fake'),
  )
  const pdf = { renderPagePdf } as unknown as PagePdfService
  const uploadGenerated = jest.fn<(input: unknown) => Promise<string>>(async () => 'file-123')
  const uploader = { uploadGenerated } as unknown as FileUploader
  const readLiveContent = jest.fn<() => Promise<unknown>>(async () => overrides.live ?? null)
  const yjs = { readLiveContent } as unknown as YjsPageEditor
  const tools = new PagePdfTools(prisma, domain, pdf, uploader, yjs)
  return { tools, prisma, renderPagePdf, uploadGenerated, readLiveContent }
}

describe('exportPageToPdf', () => {
  it('renders, attaches and returns the download url on the happy path', async () => {
    const { tools, renderPagePdf, uploadGenerated } = makeTools()
    const result = await tools.doExportPageToPdf(auth, { workspaceId: WS, pageId: PAGE })

    expect(renderPagePdf).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Моя страница', icon: '📄' }),
    )
    expect(uploadGenerated).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER,
        workspaceId: WS,
        pageId: PAGE,
        fileName: 'Моя страница.pdf',
        mimeType: 'application/pdf',
      }),
    )
    expect(result).toEqual(
      expect.objectContaining({
        fileId: 'file-123',
        url: '/api/files/file-123',
        name: 'Моя страница.pdf',
      }),
    )
    expect(result.size).toBeGreaterThan(0)
  })

  it('prefers the LIVE yjs content over the DB snapshot', async () => {
    const live = { type: 'doc', content: [{ type: 'paragraph' }] }
    const { tools, renderPagePdf } = makeTools({ live })
    await tools.doExportPageToPdf(auth, { workspaceId: WS, pageId: PAGE })
    expect(renderPagePdf).toHaveBeenCalledWith(expect.objectContaining({ content: live }))
  })

  it('404s (no oracle) when the page is invisible to the caller', async () => {
    const { tools } = makeTools({ page: null })
    await expect(tools.doExportPageToPdf(auth, { workspaceId: WS, pageId: PAGE })).rejects.toThrow(
      /PAGE_NOT_FOUND/,
    )
  })

  it('rejects non-TEXT pages with PDF_EXPORT_UNSUPPORTED_PAGE_TYPE', async () => {
    const { tools } = makeTools({
      page: { title: 'Доска', icon: null, content: null, type: 'EXCALIDRAW' },
    })
    await expect(tools.doExportPageToPdf(auth, { workspaceId: WS, pageId: PAGE })).rejects.toThrow(
      /PDF_EXPORT_UNSUPPORTED_PAGE_TYPE/,
    )
  })

  it('maps the 8C disableExport policy to an HttpException (no export bypass)', async () => {
    const { tools, renderPagePdf } = makeTools({
      exportAllowed: async () => {
        throw new DomainError('EXPORT_DISABLED', 'Экспорт запрещён политикой безопасности', 403)
      },
    })
    await expect(
      tools.doExportPageToPdf(auth, { workspaceId: WS, pageId: PAGE }),
    ).rejects.toBeInstanceOf(HttpException)
    expect(renderPagePdf).not.toHaveBeenCalled()
  })
})

describe('pdfFileName', () => {
  it('appends .pdf and falls back for empty titles', () => {
    expect(pdfFileName('Отчёт за июль')).toBe('Отчёт за июль.pdf')
    expect(pdfFileName('')).toBe('Без названия.pdf')
    expect(pdfFileName(null)).toBe('Без названия.pdf')
  })

  it('strips path separators and control characters', () => {
    expect(pdfFileName('a/b\\c\0d')).toBe('a b c d.pdf')
  })
})
