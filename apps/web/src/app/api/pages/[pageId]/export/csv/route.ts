import type { NextRequest } from 'next/server'
import { prisma } from '@repo/db'
import { buildPageVisibilityWhere, isDomainError } from '@repo/domain'
import { z } from 'zod'

import { domain } from '@/lib/domain'
import { getSession } from '@/lib/get-session'
import { contentDisposition } from '@/server/page-export'
import { buildCsv, type CsvProperty, type CsvRow } from '@/server/page-export/csv-stringify'

export const runtime = 'nodejs'

/** Guard against pathological large databases being fully materialised in-request. */
const CSV_EXPORT_MAX_ROWS = 50_000

const NOT_FOUND = new Response(null, { status: 404 })

/**
 * Synchronous view-aware CSV export of a DATABASE page. The effective view's
 * filters/sorts are applied by `listRows` (the row-access authority — row
 * access rules already filter there); its `visibleProperties` narrows the
 * exported columns. Existence is never leaked: every failure mode after the
 * auth check is a uniform 404.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ pageId: string }> }) {
  const { pageId } = await ctx.params
  if (!z.string().uuid().safeParse(pageId).success) return NOT_FOUND
  const viewIdRaw = new URL(req.url).searchParams.get('viewId')
  const viewId =
    viewIdRaw && z.string().uuid().safeParse(viewIdRaw).success ? viewIdRaw : undefined

  const session = await getSession()
  if (!session) return new Response('Unauthorized', { status: 401 })

  // DATABASE page, in a workspace the caller can see the page in (visibility
  // predicate — NOT just membership), not trashed/archived. Uniform 404.
  const page = await prisma.page.findFirst({
    where: {
      id: pageId,
      type: 'DATABASE',
      deletedAt: null,
      archivedAt: null,
      workspace: { members: { some: { userId: session.user.id } } },
      AND: [buildPageVisibilityWhere(session.user.id)],
    },
    select: { id: true, title: true, workspaceId: true },
  })
  if (!page) return NOT_FOUND

  // Security policy (8C §4): disableExport blocks every export surface,
  // database CSV included. The page is already known-visible to the caller, so
  // the denial is an honest 403 naming the policy — deliberately NOT folded
  // into the uniform 404 of the pre-visibility access chain above.
  try {
    await domain.security.assertExportAllowed(page.workspaceId)
  } catch (e) {
    if (isDomainError(e) && e.httpStatus === 403) {
      return Response.json({ error: e.message }, { status: 403 })
    }
    throw e
  }

  // Resolve the effective view: the requested one, else the default (first by
  // position) — resolveViewContext treats undefined as "no settings", so the
  // route supplies the default itself to honor the view's filters/visibility.
  let effectiveViewId = viewId
  let visible: string[] | undefined
  try {
    const views = await domain.database.listViews(session.user.id, pageId)
    const sorted = [...views].sort((a, b) => a.position - b.position)
    const view = (viewId ? sorted.find((v) => v.id === viewId) : undefined) ?? sorted[0]
    effectiveViewId = view?.id
    const settings = view?.settings
    if (settings && typeof settings === 'object' && !Array.isArray(settings)) {
      const vp = (settings as { visibleProperties?: unknown }).visibleProperties
      if (Array.isArray(vp)) visible = vp.filter((v): v is string => typeof v === 'string')
    }
  } catch {
    return NOT_FOUND
  }

  try {
    const all = (await domain.database.listProperties(
      session.user.id,
      pageId,
    )) as unknown as CsvProperty[]
    // `visible` can only NARROW the columns (set intersection with the real
    // properties); the `'__title__'` sentinel matches no property id and the
    // title column is always emitted first by buildCsv.
    const props = visible ? all.filter((p) => visible.includes(p.id)) : all

    const rows: CsvRow[] = []
    let cursor: string | undefined
    let truncated = false
    do {
      const batch = await domain.database.listRows(session.user.id, {
        pageId,
        ...(effectiveViewId ? { viewId: effectiveViewId } : {}),
        limit: 200,
        ...(cursor ? { cursor } : {}),
      })
      rows.push(...batch.rows)
      cursor = batch.nextCursor ?? undefined
      if (rows.length >= CSV_EXPORT_MAX_ROWS) {
        truncated = true
        break
      }
    } while (cursor)

    const csv = buildCsv(props, rows)
    const filename = `${(page.title ?? '').trim() || 'database'}.csv`
    const headers: Record<string, string> = {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': contentDisposition(filename),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    }
    if (truncated) headers['X-Export-Truncated'] = 'true'
    return new Response(csv, { headers })
  } catch {
    return NOT_FOUND
  }
}
