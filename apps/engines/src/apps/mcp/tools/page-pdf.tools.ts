import { HttpException, Inject, Injectable, UnauthorizedException } from '@nestjs/common'
import type { Context } from '@rekog/mcp-nest'
import { Tool } from '@rekog/mcp-nest'
import type { PrismaClient } from '@repo/db'
import type { Domain } from '@repo/domain'
import { isDomainError } from '@repo/domain'
import {
  GotenbergTimeoutError,
  GotenbergUnreachableError,
  GotenbergUpstreamError,
} from '@repo/page-export'
import { z } from 'zod'

import { PRISMA } from '../../../infra/db/db.providers.js'
import { DOMAIN } from '../../../infra/domain/domain.providers.js'
import { assertMember } from '../../api/auth/membership.js'
import { assertPageBindingAllows } from '../../api/auth/page-binding.js'
import type { AuthContext, AuthedRequest } from '../../api/auth/auth-context.js'
import {
  PageNotFoundError,
  PdfExportUnsupportedPageTypeError,
  PdfRenderFailedError,
} from '../errors/mcp.errors.js'
import { pageVisibilityWhere } from '../page-visibility.js'
import { FileUploader } from '../services/file-uploader.service.js'
import { PagePdfService } from '../services/page-pdf.service.js'
import { YjsPageEditor } from '../services/yjs-page-editor.service.js'
import { mcpUuid } from '../utils/mcp-input.js'

const ExportInput = z.object({
  workspaceId: z.string().uuid(),
  pageId: mcpUuid(),
})

type ExportArgs = z.infer<typeof ExportInput>

const FILENAME_MAX = 200

function requireAuth(req: AuthedRequest | undefined): AuthContext {
  if (!req?.auth) throw new UnauthorizedException('Unauthenticated MCP request')
  return req.auth
}

/** Page title → a safe *.pdf attachment name (path separators and control
 *  chars stripped; the download route sets its own Content-Disposition). */
export function pdfFileName(title: string | null): string {
  const base = (title ?? '')
    .replace(/[\p{Cc}/\\]+/gu, ' ')
    .trim()
    .slice(0, FILENAME_MAX)
  return `${base || 'Без названия'}.pdf`
}

@Injectable()
export class PagePdfTools {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(DOMAIN) private readonly domain: Domain,
    private readonly pdf: PagePdfService,
    private readonly uploader: FileUploader,
    private readonly yjsEditor: YjsPageEditor,
  ) {}

  @Tool({
    name: 'exportPageToPdf',
    description:
      'Сформировать PDF из страницы: рендерит содержимое страницы в PDF, ' +
      'прикрепляет файл к этой же странице и возвращает ссылку на скачивание. ' +
      'Вызывай когда пользователь просит «сформируй/сделай/экспортируй PDF из ' +
      'страницы». В ответе пользователю всегда давай markdown-ссылку на `url` ' +
      'из результата, например: [Скачать PDF](/api/files/…).',
    parameters: ExportInput,
  })
  exportPageToPdf(args: ExportArgs, _context: Context, req: AuthedRequest) {
    return this.doExportPageToPdf(requireAuth(req), args)
  }

  async doExportPageToPdf(auth: AuthContext, args: ExportArgs) {
    await assertMember(this.prisma, auth.userId, args.workspaceId)
    assertPageBindingAllows(auth, args.pageId)

    // Security policy (8C §4): disableExport blocks EVERY export surface —
    // skipping it here would make the chat tool an export-ban bypass.
    try {
      await this.domain.security.assertExportAllowed(args.workspaceId)
    } catch (e) {
      if (isDomainError(e)) throw new HttpException({ code: `EXPORT_${e.code}`, message: e.message }, e.httpStatus)
      throw e
    }

    // findFirst + visibility predicate: a private page owned by another user
    // must read as not-found (the getPageMarkdown precedent).
    const page = await this.prisma.page.findFirst({
      where: {
        id: args.pageId,
        workspaceId: args.workspaceId,
        AND: [pageVisibilityWhere(auth.userId)],
      },
      select: { title: true, icon: true, content: true, type: true },
    })
    if (!page) throw new PageNotFoundError(args.pageId)
    if (page.type !== 'TEXT') throw new PdfExportUnsupportedPageTypeError(page.type)

    // Prefer the LIVE collaborative doc — the DB snapshot lags the yjs server's
    // debounced store, and «сформируй pdf» right after chat edits must include them.
    let content = page.content
    const live = await this.yjsEditor.readLiveContent({
      pageId: args.pageId,
      actorUserId: auth.userId,
    })
    if (live) content = live as never

    const title = (page.title ?? '').trim() || 'Без названия'
    let buffer: Buffer
    try {
      buffer = await this.pdf.renderPagePdf({
        title,
        icon: page.icon,
        content,
        workspaceId: args.workspaceId,
      })
    } catch (e) {
      if (
        e instanceof GotenbergTimeoutError ||
        e instanceof GotenbergUnreachableError ||
        e instanceof GotenbergUpstreamError
      ) {
        throw new PdfRenderFailedError(e.message)
      }
      throw e
    }

    const name = pdfFileName(page.title)
    const fileId = await this.uploader.uploadGenerated({
      userId: auth.userId,
      workspaceId: args.workspaceId,
      pageId: args.pageId,
      fileName: name,
      mimeType: 'application/pdf',
      buffer,
    })
    return { fileId, url: `/api/files/${fileId}`, name, size: buffer.length }
  }
}
