import { createHash } from 'node:crypto'
import type { Readable } from 'node:stream'

import { FileStatus, PageType, Prisma, type PrismaClient } from '@repo/db'
import type { CreatePageExtra, CreatePageInput } from '@repo/domain'
import type { StorageClient } from '@repo/storage'

import { computeS3Key } from '@/lib/file-validation'
import { buildConfluenceImportPlan } from '@/server/page-import/confluence/confluence-plan'
import { buildImportContentYjs } from '@/server/page-import/content-yjs'
import { parseCsv } from '@/server/page-import/csv'
import {
  materializeCsvDatabase,
  type CsvDatabaseBlueprint,
  type DatabasePort,
} from '@/server/page-import/csv-to-database'
import { parseHtmlDocument } from '@/server/page-import/html-to-tiptap'
import type { InferOverrides, InferredType } from '@/server/page-import/infer-columns'
import { ImportJournal } from '@/server/page-import/journal'
import { parseMarkdownDocument, type TiptapDoc } from '@/server/page-import/markdown-to-tiptap'
import { cleanNotionPath, extractNotionIdFromHref } from '@/server/page-import/notion/notion-name'
import { buildNotionImportPlan } from '@/server/page-import/notion/notion-plan'
import { resolveSourcePath, rewriteRelativeLinks } from '@/server/page-import/rewrite-links'
import {
  buildImportPlan,
  ImportSourceError,
  type ImportAsset,
  type ImportNode,
  type ImportPlan,
} from '@/server/page-import/zip-plan'

export type PagesCreatePort = {
  create(actorUserId: string, input: CreatePageInput & CreatePageExtra): Promise<{ id: string }>
}

export type ImportJobContext = {
  prisma: PrismaClient
  storage: Pick<StorageClient, 'get' | 'put' | 'delete'>
  pages: PagesCreatePort
  database: DatabasePort
}

type ImportOptions = {
  location: 'team' | 'private'
  parentId: string | null
  /** CSV-only: per-column type pins/skips keyed by the FULL header index. */
  columnOverrides?: Record<number, InferredType | 'skip'>
  /** CSV-only: user-chosen database title (defaults to the file stem). */
  databaseTitle?: string
}

/** A CSV database blueprint + the Notion-style parent dir key ('' / absent = import root). */
type DatabaseBlueprintEntry = CsvDatabaseBlueprint & { parentKey?: string }

/** Run-scoped state threaded through the page-creation pass. */
type ImportRunState = {
  options: ImportOptions
  mapped: Map<string, string>
  assetFileIds: Map<string, string>
  aliases: Map<string, string>
  journal: ImportJournal
}

type LoadedImportJob = Prisma.ImportJobGetPayload<{
  include: { artifacts: { include: { file: true } } }
}>

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
}

/**
 * Source-path lookup chain: direct → raw alias → fully-cleaned retry. The retry
 * covers Notion's mixed paths — a RAW (id-suffixed) href resolved against the
 * doc's CLEANED dir matches neither the cleaned mappings nor the raw aliases.
 * Cleaning an already-clean segment is a no-op; gated on aliases so GENERIC
 * imports (no aliases) stay byte-identical.
 */
function lookupSourceKey(
  abs: string,
  aliases: Map<string, string>,
  lookup: (key: string) => string | undefined,
): string | undefined {
  const aliased = aliases.get(abs)
  let id = lookup(abs) ?? (aliased ? lookup(aliased) : undefined)
  if (!id && aliases.size > 0) {
    const cleaned = cleanNotionPath(abs).cleaned
    const cleanedAliased = aliases.get(cleaned)
    id = lookup(cleaned) ?? (cleanedAliased ? lookup(cleanedAliased) : undefined)
  }
  return id
}

export async function processImportJob(ctx: ImportJobContext, jobId: string): Promise<void> {
  const now = new Date()
  const claimed = await ctx.prisma.importJob.updateMany({
    where: { id: jobId, status: 'QUEUED' },
    data: { status: 'PROCESSING', startedAt: now, heartbeatAt: now },
  })
  if (claimed.count === 0) return

  let journal: ImportJournal | null = null
  try {
    const job = await ctx.prisma.importJob.findUniqueOrThrow({
      where: { id: jobId },
      include: { artifacts: { include: { file: true } } },
    })
    const source = job.artifacts.find((a) => a.kind === 'SOURCE')?.file
    if (!source) throw new ImportSourceError('Файл импорта не найден')
    journal = new ImportJournal(job.source, source.name)
    await run(ctx, job, source, journal)
    await writeReport(ctx, jobId, journal)
  } catch (err) {
    const message = err instanceof ImportSourceError ? err.message : 'Не удалось выполнить импорт'
    console.error('[import-job] failed', { jobId, err })
    await ctx.prisma.importJob
      .update({
        where: { id: jobId },
        data: { status: 'FAILED', error: message, finishedAt: new Date() },
      })
      .catch(() => {})
    if (journal) {
      journal.warn(message)
      await writeReport(ctx, jobId, journal)
    }
  }
}

async function run(
  ctx: ImportJobContext,
  job: LoadedImportJob,
  source: { name: string; path: string },
  journal: ImportJournal,
): Promise<void> {
  const bytes = await streamToBuffer(await ctx.storage.get(source.path))
  const options = parseOptions(job.options)

  // The router enforces ZIP for source-specific imports; guard defensively anyway.
  if ((job.source === 'NOTION' || job.source === 'CONFLUENCE') && job.format !== 'ZIP') {
    throw new ImportSourceError('Для этого источника нужен ZIP-архив')
  }
  let plan: ImportPlan
  let aliases = new Map<string, string>()
  let databases: DatabaseBlueprintEntry[] = []
  if (job.source === 'NOTION') {
    const notion = buildNotionImportPlan(bytes)
    plan = notion
    aliases = notion.aliases
    databases = notion.databases
  } else if (job.source === 'CONFLUENCE') {
    const confluence = buildConfluenceImportPlan(bytes)
    plan = confluence
    aliases = confluence.aliases
  } else if (job.format === 'CSV') {
    // GENERIC CSV: the whole file is one database blueprint — no page tree.
    const parsed = parseCsv(new TextDecoder('utf-8').decode(bytes))
    const header = parsed[0]
    const dataRows = parsed.slice(1)
    if (!header || header.every((c) => c.trim() === '') || dataRows.length === 0) {
      throw new ImportSourceError('CSV-файл пуст')
    }
    databases = [
      {
        sourceKey: source.name,
        title: options.databaseTitle ?? source.name.replace(/\.[^.]+$/, ''),
        header,
        rows: dataRows,
      },
    ]
    for (const key of Object.keys(options.columnOverrides ?? {})) {
      journal.action(`Колонка ${Number(key) + 1}: тип задан вручную`)
    }
    plan = { roots: [], assets: new Map(), warnings: [], totalPages: 1 + dataRows.length }
  } else {
    plan =
      job.format === 'ZIP' ? buildImportPlan(bytes) : singleFilePlan(job.format, source.name, bytes)
  }

  // Idempotent resume: already-created entries are skipped via their mapping.
  const existing = await ctx.prisma.importMapping.findMany({
    where: { jobId: job.id },
    select: { sourceKey: true, pageId: true },
  })
  const mapped = new Map(existing.map((m) => [m.sourceKey, m.pageId]))

  await ctx.prisma.importJob.update({
    where: { id: job.id },
    data: { total: plan.totalPages, processed: mapped.size, heartbeatAt: new Date() },
  })

  for (const w of plan.warnings) journal.skip(w)
  const assetFileIds = await storeAssets(ctx, job, plan, journal)

  const state: ImportRunState = { options, mapped, assetFileIds, aliases, journal }
  const rootPageIds: string[] = []
  for (const node of plan.roots) {
    const id = await createNode(ctx, job, state, node, options.parentId)
    rootPageIds.push(id)
  }

  // Overrides only apply to the user's own CSV file — Notion blueprint columns
  // keep pure inference (the wizard never offers overrides for archives).
  const inferOpts: InferOverrides | undefined =
    job.format === 'CSV' && options.columnOverrides
      ? { overrides: options.columnOverrides }
      : undefined
  await materializeDatabases(ctx, job, options, databases, mapped, rootPageIds, journal, inferOpts)

  await rewriteImportedLinks(ctx, job.workspaceId, plan, mapped, aliases, journal)

  await ctx.prisma.importJob.update({
    where: { id: job.id },
    data: {
      status: 'DONE',
      finishedAt: new Date(),
      processed: plan.totalPages,
      result: {
        pagesCreated: mapped.size,
        rootPageIds,
        warnings: journal.warnings.slice(0, 100),
      } as Prisma.InputJsonValue,
    },
  })
}

async function createNode(
  ctx: ImportJobContext,
  job: { id: string; userId: string; workspaceId: string },
  state: ImportRunState,
  node: ImportNode,
  parentPageId: string | null,
): Promise<string> {
  const { options, mapped, assetFileIds, aliases, journal } = state
  let pageId = mapped.get(node.sourceKey)
  if (!pageId) {
    const usedFileIds: string[] = []
    let title = node.name
    let doc: TiptapDoc = { type: 'doc', content: [] }
    if (node.doc) {
      const docDir = node.doc.sourceKey.includes('/')
        ? node.doc.sourceKey.slice(0, node.doc.sourceKey.lastIndexOf('/'))
        : ''
      const resolveImageSrc = (src: string): string | null => {
        let decoded = src.split('#', 2)[0] ?? ''
        try {
          decoded = decodeURIComponent(decoded)
        } catch {
          // keep raw on malformed escapes
        }
        const abs = resolveSourcePath(docDir, decoded)
        if (!abs) return null
        const fileId = lookupSourceKey(abs, aliases, (key) => assetFileIds.get(key))
        if (!fileId) return null
        usedFileIds.push(fileId)
        return `/api/files/${fileId}`
      }
      const text = new TextDecoder('utf-8').decode(node.doc.bytes)
      const parsed =
        node.doc.format === 'html'
          ? parseHtmlDocument(text, node.name, { resolveImageSrc })
          : parseMarkdownDocument(text, node.name, { resolveImageSrc })
      title = parsed.title
      doc = parsed.doc
    }

    const created = await ctx.pages.create(job.userId, {
      workspaceId: job.workspaceId,
      parentId: parentPageId,
      title,
      type: PageType.TEXT,
      ...(parentPageId === null ? { location: options.location } : {}),
      content: doc as unknown as Prisma.InputJsonValue,
      contentYjs: buildImportContentYjs(doc),
    })
    pageId = created.id

    if (usedFileIds.length > 0) {
      const createdPageId = pageId
      await ctx.prisma.pageFile.createMany({
        data: [...new Set(usedFileIds)].map((fileId) => ({ pageId: createdPageId, fileId })),
        skipDuplicates: true,
      })
    }
    let won = true
    try {
      await ctx.prisma.importMapping.create({
        data: { jobId: job.id, sourceKey: node.sourceKey, pageId },
      })
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        // A concurrent runner (stale-heartbeat reclaim race) won this node: keep
        // its page, remove ours, and continue under the winner's id.
        won = false
        const winner = await ctx.prisma.importMapping.findUniqueOrThrow({
          where: { jobId_sourceKey: { jobId: job.id, sourceKey: node.sourceKey } },
          select: { pageId: true },
        })
        await ctx.prisma.pageFile.deleteMany({ where: { pageId } })
        await ctx.prisma.page.delete({ where: { id: pageId } }).catch(() => {})
        pageId = winner.pageId
      } else {
        throw e
      }
    }
    mapped.set(node.sourceKey, pageId)
    if (won) {
      journal.action(`Страница «${title}»`)
      // The loser skips the increment — the winner's run already counted this node.
      await bumpProgress(ctx, job.id)
    }
  }

  for (const child of node.children) {
    await createNode(ctx, job, state, child, pageId)
  }
  return pageId
}

// CSV database blueprints (Notion archives or a standalone GENERIC CSV file)
// materialize AFTER the page pass so parent dirs already have pages, and
// BEFORE link rewriting so row mappings resolve.
async function materializeDatabases(
  ctx: ImportJobContext,
  job: { id: string; userId: string; workspaceId: string },
  options: ImportOptions,
  databases: DatabaseBlueprintEntry[],
  mapped: Map<string, string>,
  rootPageIds: string[],
  journal: ImportJournal,
  inferOpts?: InferOverrides,
): Promise<void> {
  for (const bp of databases) {
    // A parent folder that merged with a same-named doc (the standard Notion
    // `Раздел.md` + `Раздел/` layout) is mapped under the DOC's key, so fall
    // back to the `.md`/`.html` variants before giving up to the import root.
    // A standalone CSV has no parentKey → straight to the chosen import root.
    const parentKey = bp.parentKey ?? ''
    const parentPageId =
      parentKey === ''
        ? options.parentId
        : (mapped.get(`${parentKey}/`) ??
          mapped.get(parentKey) ??
          mapped.get(`${parentKey}.md`) ??
          mapped.get(`${parentKey}.markdown`) ??
          mapped.get(`${parentKey}.html`) ??
          mapped.get(`${parentKey}.htm`) ??
          options.parentId)
    await materializeCsvDatabase(
      { prisma: ctx.prisma, pages: ctx.pages, database: ctx.database },
      {
        actorUserId: job.userId,
        workspaceId: job.workspaceId,
        parentPageId,
        location: options.location,
        blueprint: bp,
        journal,
        existingMappings: mapped,
        ...(inferOpts ? { inferOpts } : {}),
        onDatabaseCreated: async (key, pageId) => {
          journal.action(`База данных «${bp.title}»`)
          await recordMapping(ctx, job.id, key, pageId, mapped, { cleanupOnLoss: true })
          if (parentKey === '') rootPageIds.push(pageId)
          await bumpProgress(ctx, job.id)
        },
        onRowCreated: async (key, pageId) => {
          journal.action(`Строка «${key}»`)
          await recordMapping(ctx, job.id, key, pageId, mapped, { cleanupOnLoss: true })
          await bumpProgress(ctx, job.id)
        },
      },
    )
  }
}

/**
 * P2002-tolerant mapping insert (service-created pages): the loser adopts the
 * winner's id. With `cleanupOnLoss`, the loser's just-created page is deleted
 * first so the reclaim race leaves no orphan item Page (its DatabaseRow
 * cascades via the Page FK). `createNode` keeps its own inline loser-cleanup.
 */
async function recordMapping(
  ctx: ImportJobContext,
  jobId: string,
  sourceKey: string,
  pageId: string,
  mapped: Map<string, string>,
  { cleanupOnLoss = false }: { cleanupOnLoss?: boolean } = {},
): Promise<void> {
  try {
    await ctx.prisma.importMapping.create({ data: { jobId, sourceKey, pageId } })
    mapped.set(sourceKey, pageId)
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      if (cleanupOnLoss) {
        await ctx.prisma.page.delete({ where: { id: pageId } }).catch(() => {})
      }
      const winner = await ctx.prisma.importMapping.findUniqueOrThrow({
        where: { jobId_sourceKey: { jobId, sourceKey } },
        select: { pageId: true },
      })
      mapped.set(sourceKey, winner.pageId)
    } else {
      throw e
    }
  }
}

async function bumpProgress(ctx: ImportJobContext, jobId: string): Promise<void> {
  await ctx.prisma.importJob.update({
    where: { id: jobId },
    data: { processed: { increment: 1 }, heartbeatAt: new Date() },
  })
}

// Best-effort REPORT artifact: render the journal and replace any prior report
// (idempotent resume re-renders it). Never fails the job.
async function writeReport(
  ctx: ImportJobContext,
  jobId: string,
  journal: ImportJournal,
): Promise<void> {
  try {
    // Best-effort replace: a concurrent resume may briefly produce a duplicate REPORT row; the route reads the first.
    const prior = await ctx.prisma.importArtifact.findMany({
      where: { jobId, kind: 'REPORT' },
      select: { id: true, fileId: true },
    })
    for (const a of prior) {
      await ctx.prisma.importArtifact.delete({ where: { id: a.id } }).catch(() => {})
      await ctx.prisma.file.delete({ where: { id: a.fileId } }).catch(() => {})
    }
    const owner = await ctx.prisma.importJob.findUniqueOrThrow({
      where: { id: jobId },
      select: { userId: true },
    })
    const buf = Buffer.from(journal.render(), 'utf-8')
    const key = `imports/${jobId}-report.txt`
    await ctx.storage.put(key, buf, {
      contentType: 'text/plain; charset=utf-8',
      size: buf.byteLength,
    })
    const file = await ctx.prisma.file.create({
      data: {
        userId: owner.userId,
        // workspaceId NULL: owner-only, invisible to the Library and the generic
        // member route — the journal can name skipped private items.
        workspaceId: null,
        name: 'import-report',
        ext: 'txt',
        fileSize: BigInt(buf.byteLength),
        mimeType: 'text/plain',
        hash: createHash('sha256').update(buf).digest('hex'),
        path: key,
        status: FileStatus.ACTIVE,
        isPublic: false,
      },
      select: { id: true },
    })
    await ctx.prisma.importArtifact.create({ data: { jobId, fileId: file.id, kind: 'REPORT' } })
  } catch (err) {
    console.warn('[import-job] report write failed', { jobId, err })
  }
}

// Upload referenced image assets (content-hash dedup like the upload route).
// Over-quota assets are skipped with a warning rather than failing the import.
async function storeAssets(
  ctx: ImportJobContext,
  job: { userId: string; workspaceId: string },
  plan: ImportPlan,
  journal: ImportJournal,
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (plan.assets.size === 0) return out

  // First pass: dedupe against already-stored files (incl. an idempotent
  // resume of this very job) so only genuinely NEW bytes count against quota.
  const toUpload: Array<{ sourceKey: string; asset: ImportAsset; hash: string; buf: Buffer }> = []
  for (const [sourceKey, asset] of plan.assets) {
    const buf = Buffer.from(asset.bytes)
    const hash = createHash('sha256').update(buf).digest('hex')
    const existing = await ctx.prisma.file.findFirst({
      where: {
        userId: job.userId,
        hash,
        workspaceId: job.workspaceId,
        status: FileStatus.ACTIVE,
      },
      select: { id: true },
    })
    if (existing) out.set(sourceKey, existing.id)
    else toUpload.push({ sourceKey, asset, hash, buf })
  }
  if (toUpload.length === 0) return out

  const storedPaths: string[] = []
  try {
    await ctx.prisma.$transaction(
      async (tx) => {
        // All workspace-scoped upload paths use this same row as the quota mutex.
        // Keep the lock through object persistence and File creation so forms,
        // imports and MCP uploads cannot each pass a stale aggregate concurrently.
        const workspaces = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM workspaces
        WHERE id = ${job.workspaceId}::uuid
        FOR UPDATE
      `
        if (workspaces.length !== 1) throw new Error('IMPORT_WORKSPACE_NOT_FOUND')

        // The first pass is an inexpensive fast path. Repeat dedupe under the
        // quota lock because another uploader may have committed in between.
        const pending: typeof toUpload = []
        for (const candidate of toUpload) {
          const existing = await tx.file.findFirst({
            where: {
              userId: job.userId,
              hash: candidate.hash,
              workspaceId: job.workspaceId,
              status: FileStatus.ACTIVE,
            },
            select: { id: true },
          })
          if (existing) out.set(candidate.sourceKey, existing.id)
          else pending.push(candidate)
        }

        const newBytes = pending.reduce((sum, candidate) => sum + candidate.buf.byteLength, 0)
        const usage = await tx.file.aggregate({
          where: {
            workspaceId: job.workspaceId,
            OR: [
              { status: FileStatus.ACTIVE },
              { status: FileStatus.PENDING, expiresAt: { gt: new Date() } },
            ],
          },
          _sum: { fileSize: true },
        })
        const limits = await tx.workspaceLimit.findUnique({
          where: { workspaceId: job.workspaceId },
        })
        const used = usage._sum.fileSize ?? 0n
        if (limits && used + BigInt(newBytes) > limits.maxFileBytes) {
          journal.warn('Картинки из архива пропущены: превышен лимит хранилища пространства')
          return
        }

        for (const { sourceKey, asset, hash, buf } of pending) {
          const s3Key = `workspaces/${job.workspaceId}/${computeS3Key(hash, asset.ext)}`
          await ctx.storage.put(s3Key, buf, {
            contentType: MIME_BY_EXT[asset.ext] ?? 'application/octet-stream',
            size: buf.byteLength,
          })
          storedPaths.push(s3Key)
          const created = await tx.file.create({
            data: {
              userId: job.userId,
              workspaceId: job.workspaceId,
              name: `${asset.baseName}.${asset.ext}`,
              ext: asset.ext,
              fileSize: BigInt(buf.byteLength),
              mimeType: MIME_BY_EXT[asset.ext] ?? 'application/octet-stream',
              hash,
              path: s3Key,
              status: FileStatus.ACTIVE,
              isPublic: false,
            },
            select: { id: true },
          })
          out.set(sourceKey, created.id)
        }
      },
      { maxWait: 10_000, timeout: 120_000 },
    )
  } catch (error) {
    if (storedPaths.length > 0) {
      try {
        await ctx.prisma.$transaction(
          async (tx) => {
            const workspaces = await tx.$queryRaw<{ id: string }[]>`
              SELECT id FROM workspaces
              WHERE id = ${job.workspaceId}::uuid
              FOR UPDATE
            `
            if (workspaces.length !== 1) return
            for (const path of new Set(storedPaths)) {
              const references = await tx.file.count({ where: { path } })
              if (references === 0) await ctx.storage.delete(path)
            }
          },
          { maxWait: 10_000, timeout: 120_000 },
        )
      } catch (cleanupError) {
        console.warn('[import-job] asset rollback cleanup failed', {
          workspaceId: job.workspaceId,
          cleanupError,
        })
      }
    }
    throw error
  }
  return out
}

// Second pass: relative inter-file links → /pages/<id>; re-saves content+contentYjs
// and re-enqueues indexing for changed pages only.
async function rewriteImportedLinks(
  ctx: ImportJobContext,
  workspaceId: string,
  plan: ImportPlan,
  mapped: Map<string, string>,
  aliases: Map<string, string>,
  journal: ImportJournal,
): Promise<void> {
  const lookup = (key: string): string | undefined =>
    mapped.get(key) ?? mapped.get(`${key}/`) ?? mapped.get(`${key}.md`)
  const resolve = (abs: string): string | null => {
    const id = lookupSourceKey(abs, aliases, lookup)
    return id ? `/pages/${id}` : null
  }
  // Unresolved relative links survive as-is; surface each distinct href once.
  const warnedHrefs = new Set<string>()
  const onUnresolved = (href: string): void => {
    if (warnedHrefs.has(href)) return
    warnedHrefs.add(href)
    journal.warn(`Ссылка «${href}» не разрешена — оставлена как есть`)
  }
  // External hrefs (notion.so URLs) resolve via the bare hex id → alias → mapping.
  const resolveExternal =
    aliases.size > 0
      ? (href: string): string | null => {
          const id = extractNotionIdFromHref(href)
          const key = id ? aliases.get(id) : null
          const pid = key ? mapped.get(key) : null
          return pid ? `/pages/${pid}` : null
        }
      : undefined
  const docNodes: ImportNode[] = []
  const collect = (nodes: ImportNode[]) => {
    for (const n of nodes) {
      if (n.doc) docNodes.push(n)
      collect(n.children)
    }
  }
  collect(plan.roots)

  for (const node of docNodes) {
    const pageId = mapped.get(node.sourceKey)
    if (!pageId) continue
    const page = await ctx.prisma.page.findUnique({
      where: { id: pageId },
      select: { content: true },
    })
    if (!page?.content) continue
    const { doc, changed } = rewriteRelativeLinks(page.content as unknown as TiptapDoc, {
      sourceKey: node.sourceKey,
      resolve,
      onUnresolved,
      ...(resolveExternal ? { resolveExternal } : {}),
    })
    if (!changed) continue
    await ctx.prisma.page.update({
      where: { id: pageId },
      data: {
        content: doc as unknown as Prisma.InputJsonValue,
        contentYjs: buildImportContentYjs(doc),
      },
    })
    await ctx.prisma.outboxEvent.create({
      data: {
        eventType: 'page.upserted',
        aggregateType: 'page',
        aggregateId: pageId,
        workspaceId,
      },
    })
  }
}

function singleFilePlan(
  format: 'MARKDOWN' | 'HTML',
  fileName: string,
  bytes: Uint8Array,
): ImportPlan {
  const baseName = fileName.replace(/\.[^.]+$/, '') || fileName
  return {
    roots: [
      {
        name: baseName,
        sourceKey: fileName,
        doc: {
          sourceKey: fileName,
          baseName,
          format: format === 'HTML' ? 'html' : 'md',
          bytes,
        },
        children: [],
      },
    ],
    assets: new Map(),
    warnings: [],
    totalPages: 1,
  }
}

const OVERRIDE_VALUES: ReadonlySet<string> = new Set([
  'TEXT',
  'NUMBER',
  'CHECKBOX',
  'DATE',
  'SELECT',
  'MULTI_SELECT',
  'URL',
  'EMAIL',
  'PHONE',
  'skip',
])

/** Defensive shape check for the persisted overrides: int-keyed record of known type names. */
function parseColumnOverrides(raw: unknown): Record<number, InferredType | 'skip'> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const out: Record<number, InferredType | 'skip'> = {}
  for (const [key, value] of Object.entries(raw)) {
    const idx = Number.parseInt(key, 10)
    if (!Number.isInteger(idx) || idx < 0 || String(idx) !== key) continue
    if (typeof value !== 'string' || !OVERRIDE_VALUES.has(value)) continue
    out[idx] = value as InferredType | 'skip'
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function parseOptions(raw: unknown): ImportOptions {
  const o = (raw ?? {}) as Record<string, unknown>
  const columnOverrides = parseColumnOverrides(o.columnOverrides)
  const databaseTitle =
    typeof o.databaseTitle === 'string' && o.databaseTitle.trim() !== ''
      ? o.databaseTitle.trim()
      : undefined
  return {
    location: o.location === 'private' ? 'private' : 'team',
    parentId: typeof o.parentId === 'string' ? o.parentId : null,
    ...(columnOverrides ? { columnOverrides } : {}),
    ...(databaseTitle ? { databaseTitle } : {}),
  }
}

export async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}
