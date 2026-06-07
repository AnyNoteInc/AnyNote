import { z } from 'zod'
import type { NextRequest } from 'next/server'
import { prisma } from '@repo/db'
import { storage } from '@repo/storage'
import { domain } from '@/lib/domain'
import { isDomainError } from '@repo/domain/errors.ts'

import { getSession } from '@/lib/get-session'
import {
  buildFilename,
  contentDisposition,
  GotenbergTimeoutError,
  GotenbergUnreachableError,
  GotenbergUpstreamError,
  htmlToMarkdown,
  htmlToPdf,
  renderPageBodyHtml,
  wrapHtmlDocument,
} from '@/server/page-export'

export const runtime = 'nodejs'

const FormatSchema = z.enum(['pdf', 'html', 'md'])
const ParamsSchema = z.object({
  pageId: z.string().uuid(),
  format: FormatSchema,
})

const NOT_FOUND = new Response(null, { status: 404 })
const FORBIDDEN = Response.json({ error: 'Forbidden' }, { status: 403 })

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ pageId: string; format: string }> },
) {
  const parsed = ParamsSchema.safeParse(await ctx.params)
  if (!parsed.success) return NOT_FOUND
  const { pageId, format } = parsed.data

  const session = await getSession()
  if (!session) {
    const next = new URL(req.url).pathname
    return Response.redirect(new URL(`/sign-in?next=${encodeURIComponent(next)}`, req.url), 302)
  }

  const page = await prisma.page.findFirst({
    where: { id: pageId, deletedAt: null, type: 'TEXT' },
    select: { id: true, title: true, icon: true, content: true, workspaceId: true },
  })
  if (!page) return NOT_FOUND

  try {
    await domain.workspace.assertMembership(session.user.id, page.workspaceId)
  } catch (e) {
    if (isDomainError(e) && e.httpStatus === 403) return FORBIDDEN
    throw e
  }

  const titleForOutput = (page.title ?? '').trim() || 'Без названия'
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? new URL(req.url).origin
  const bodyHtml = await renderPageBodyHtml(page, { prisma, storage, baseUrl })
  const filename = buildFilename(page.title, format)

  if (format === 'html') {
    const fullHtml = wrapHtmlDocument({ bodyHtml, title: titleForOutput, icon: page.icon })
    return new Response(fullHtml, {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'content-disposition': contentDisposition(filename),
        'cache-control': 'private, no-store',
      },
    })
  }

  if (format === 'md') {
    const md = `# ${titleForOutput}\n\n${htmlToMarkdown(bodyHtml)}`
    return new Response(md, {
      headers: {
        'content-type': 'text/markdown; charset=utf-8',
        'content-disposition': contentDisposition(filename),
        'cache-control': 'private, no-store',
      },
    })
  }

  const fullHtml = wrapHtmlDocument({ bodyHtml, title: titleForOutput, icon: page.icon })
  try {
    const pdfStream = await htmlToPdf(fullHtml)
    return new Response(pdfStream, {
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': contentDisposition(filename),
        'cache-control': 'private, no-store',
      },
    })
  } catch (e) {
    if (e instanceof GotenbergTimeoutError) {
      return Response.json({ error: 'PDF generation timed out' }, { status: 504 })
    }
    if (e instanceof GotenbergUpstreamError || e instanceof GotenbergUnreachableError) {
      return Response.json({ error: 'PDF service unavailable' }, { status: 502 })
    }
    throw e
  }
}
