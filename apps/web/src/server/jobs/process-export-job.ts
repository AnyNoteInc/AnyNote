import { createHash } from 'node:crypto'

import { FileStatus, PageType, type PrismaClient } from '@repo/db'
import type { StorageClient } from '@repo/storage'
import { strToU8, zipSync } from 'fflate'

import { htmlToMarkdown } from '@/server/page-export/html-to-markdown'
import { tiptapJsonToHtml } from '@/server/page-export/tiptap-to-html'
import { wrapHtmlDocument } from '@/server/page-export/wrap-html-document'
import {
  collectExportPages,
  type ExportPageRecord,
  type ExportScope,
} from '@/server/page-export/bulk/collect-pages'
import {
  buildDatabaseTableHtml,
  buildDatabaseTableMarkdown,
} from '@/server/page-export/bulk/database-table'
import { createNameAllocator, safeEntryName } from '@/server/page-export/bulk/naming'
import { rewriteHtmlForArchive } from '@/server/page-export/bulk/rewrite-archive-html'
import { streamToBuffer } from './process-import-job'

export const ARTIFACT_TTL_MS = 7 * 24 * 60 * 60 * 1000

export type ExportDatabasePort = {
  listProperties(actorUserId: string, pageId: string): Promise<Array<{ id: string; name: string }>>
  listRows(
    actorUserId: string,
    input: { pageId: string; limit: number; cursor?: string },
  ): Promise<{
    rows: Array<{ title: string | null; cells: Record<string, unknown> }>
    nextCursor: string | null
  }>
}

export type ExportJobContext = {
  prisma: PrismaClient
  storage: Pick<StorageClient, 'get' | 'put'>
  database: ExportDatabasePort
  baseUrl: string
}

class ExportSourceError extends Error {}

export async function processExportJob(ctx: ExportJobContext, jobId: string): Promise<void> {
  const now = new Date()
  const claimed = await ctx.prisma.exportJob.updateMany({
    where: { id: jobId, status: 'QUEUED' },
    data: { status: 'PROCESSING', startedAt: now, heartbeatAt: now },
  })
  if (claimed.count === 0) return

  try {
    await run(ctx, jobId)
  } catch (err) {
    const message = err instanceof ExportSourceError ? err.message : 'Не удалось выполнить экспорт'
    console.error('[export-job] failed', { jobId, err })
    await ctx.prisma.exportJob
      .update({
        where: { id: jobId },
        data: { status: 'FAILED', error: message, finishedAt: new Date() },
      })
      .catch(() => {})
  }
}

type Placed = { rec: ExportPageRecord; filePath: string; dir: string }

async function run(ctx: ExportJobContext, jobId: string): Promise<void> {
  const job = await ctx.prisma.exportJob.findUniqueOrThrow({ where: { id: jobId } })
  const isMd = job.format === 'MARKDOWN_ZIP'
  const ext = isMd ? 'md' : 'html'

  const pages = await collectExportPages(ctx.prisma, {
    userId: job.userId,
    workspaceId: job.workspaceId,
    scope: job.scope as ExportScope,
    scopeId: job.scopeId,
  })
  if (pages.length === 0) {
    throw new ExportSourceError('Нет доступных страниц для экспорта')
  }
  await ctx.prisma.exportJob.update({
    where: { id: jobId },
    data: { total: pages.length, heartbeatAt: new Date() },
  })

  // ── Layout: Notion-style Title.ext + Title/ folder when there are children ──
  const inSet = new Set(pages.map((p) => p.id))
  const childrenOf = new Map<string, ExportPageRecord[]>()
  const roots: ExportPageRecord[] = []
  for (const p of pages) {
    if (p.parentId && inSet.has(p.parentId)) {
      const list = childrenOf.get(p.parentId) ?? []
      list.push(p)
      childrenOf.set(p.parentId, list)
    } else {
      roots.push(p)
    }
  }
  const alloc = createNameAllocator()
  const placed = new Map<string, Placed>()
  const walk = (rec: ExportPageRecord, dir: string, depth = 0) => {
    if (depth > 500) throw new ExportSourceError('Слишком глубокое дерево страниц')
    const base = alloc(dir, safeEntryName(rec.title))
    const filePath = dir ? `${dir}/${base}.${ext}` : `${base}.${ext}`
    placed.set(rec.id, { rec, filePath, dir })
    const kids = childrenOf.get(rec.id) ?? []
    if (kids.length > 0) {
      const childDir = dir ? `${dir}/${base}` : base
      for (const k of kids) walk(k, childDir, depth + 1)
    }
  }
  for (const r of roots) walk(r, '')

  // ── Pre-resolve bundled assets: every /api/files/<id> referenced by any page ──
  const rawHtmlById = new Map<string, string>()
  const referencedIds = new Set<string>()
  const FILE_ID_RE =
    /\/api\/files\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi
  for (const p of pages) {
    if (p.type !== PageType.TEXT) continue
    const raw = tiptapJsonToHtml(p.content)
    rawHtmlById.set(p.id, raw)
    for (const m of raw.matchAll(FILE_ID_RE)) referencedIds.add(m[1]!.toLowerCase())
  }
  const assetFiles = referencedIds.size
    ? await ctx.prisma.file.findMany({
        where: {
          id: { in: [...referencedIds] },
          workspaceId: job.workspaceId,
          status: FileStatus.ACTIVE,
        },
        select: { id: true, path: true, ext: true },
      })
    : []
  const assetPaths = new Map(
    assetFiles.map(
      (f) => [f.id.toLowerCase(), `assets/${f.id.toLowerCase()}.${f.ext || 'bin'}`] as const,
    ),
  )

  // ── Render entries ──
  const entries: Record<string, Uint8Array> = {}
  for (const { rec, filePath, dir } of placed.values()) {
    const title = (rec.title ?? '').trim() || 'Без названия'
    let content: string
    if (rec.type === PageType.TEXT) {
      const { html: body } = rewriteHtmlForArchive(rawHtmlById.get(rec.id) ?? '', {
        fromDir: dir,
        baseUrl: ctx.baseUrl,
        assetPathFor: (id) => assetPaths.get(id.toLowerCase()) ?? null,
        pagePathFor: (id) => placed.get(id)?.filePath ?? null,
      })
      content = isMd
        ? `# ${title}\n\n${htmlToMarkdown(body)}`
        : wrapHtmlDocument({ bodyHtml: body, title, icon: rec.icon })
    } else if (rec.type === PageType.DATABASE) {
      content = await renderDatabasePage(ctx, job.userId, rec, title, isMd)
    } else {
      const note = `Тип страницы «${rec.type}» не входит в экспорт этой версии.`
      content = isMd
        ? `# ${title}\n\n> ${note}\n`
        : wrapHtmlDocument({ bodyHtml: `<p>${note}</p>`, title, icon: rec.icon })
    }
    entries[filePath] = strToU8(content)
    await ctx.prisma.exportJob.update({
      where: { id: jobId },
      data: { processed: { increment: 1 }, heartbeatAt: new Date() },
    })
  }

  // ── Bundle assets ──
  for (const f of assetFiles) {
    try {
      const buf = await streamToBuffer(await ctx.storage.get(f.path))
      entries[assetPaths.get(f.id.toLowerCase())!] = new Uint8Array(buf)
    } catch (err) {
      console.warn('[export-job] asset fetch failed, skipping', { fileId: f.id, err })
    }
  }

  // ── Store the artifact ──
  const zipBytes = zipSync(entries)
  const key = `exports/${jobId}.zip`
  const buf = Buffer.from(zipBytes)
  await ctx.storage.put(key, buf, { contentType: 'application/zip', size: buf.byteLength })
  const hash = createHash('sha256').update(buf).digest('hex')
  await ctx.prisma.$transaction(async (tx) => {
    const file = await tx.file.create({
      data: {
        userId: job.userId,
        workspaceId: job.workspaceId,
        name: 'anynote-export',
        ext: 'zip',
        fileSize: BigInt(buf.byteLength),
        mimeType: 'application/zip',
        hash,
        path: key,
        status: FileStatus.ACTIVE,
        isPublic: false,
        expiresAt: new Date(Date.now() + ARTIFACT_TTL_MS),
      },
      select: { id: true },
    })
    await tx.exportArtifact.create({ data: { jobId, fileId: file.id } })
  })
  await ctx.prisma.exportJob.update({
    where: { id: jobId },
    data: { status: 'DONE', finishedAt: new Date(), processed: pages.length },
  })
}

// 6A: a database page exports as a simple table of the rows VISIBLE TO THE JOB
// OWNER (listRows applies the Phase-4C row-access resolver). Full CSV is 6C.
async function renderDatabasePage(
  ctx: ExportJobContext,
  actorUserId: string,
  rec: ExportPageRecord,
  title: string,
  isMd: boolean,
): Promise<string> {
  try {
    const props = await ctx.database.listProperties(actorUserId, rec.id)
    const rows: Array<{ title: string | null; cells: Record<string, unknown> }> = []
    let cursor: string | undefined
    do {
      const page = await ctx.database.listRows(actorUserId, {
        pageId: rec.id,
        limit: 200,
        ...(cursor ? { cursor } : {}),
      })
      rows.push(...page.rows)
      cursor = page.nextCursor ?? undefined
    } while (cursor)
    return isMd
      ? `# ${title}\n\n${buildDatabaseTableMarkdown(props, rows)}`
      : wrapHtmlDocument({ bodyHtml: buildDatabaseTableHtml(props, rows), title, icon: rec.icon })
  } catch (err) {
    console.warn('[export-job] database render failed, emitting stub', { pageId: rec.id, err })
    const note = 'Не удалось выгрузить таблицу базы данных.'
    return isMd
      ? `# ${title}\n\n> ${note}\n`
      : wrapHtmlDocument({ bodyHtml: `<p>${note}</p>`, title, icon: rec.icon })
  }
}
