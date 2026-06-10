import { createHash } from 'node:crypto'
import type { Readable } from 'node:stream'

import { FileStatus, PageType, type Prisma, type PrismaClient } from '@repo/db'
import type { CreatePageExtra, CreatePageInput } from '@repo/domain'
import type { StorageClient } from '@repo/storage'

import { computeS3Key } from '@/lib/file-validation'
import { buildImportContentYjs } from '@/server/page-import/content-yjs'
import { parseHtmlDocument } from '@/server/page-import/html-to-tiptap'
import { parseMarkdownDocument, type TiptapDoc } from '@/server/page-import/markdown-to-tiptap'
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
  storage: Pick<StorageClient, 'get' | 'put'>
  pages: PagesCreatePort
}

type ImportOptions = { location: 'team' | 'private'; parentId: string | null }

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
}

export async function processImportJob(ctx: ImportJobContext, jobId: string): Promise<void> {
  const now = new Date()
  const claimed = await ctx.prisma.importJob.updateMany({
    where: { id: jobId, status: 'QUEUED' },
    data: { status: 'PROCESSING', startedAt: now, heartbeatAt: now },
  })
  if (claimed.count === 0) return

  try {
    await run(ctx, jobId)
  } catch (err) {
    const message = err instanceof ImportSourceError ? err.message : 'Не удалось выполнить импорт'
    console.error('[import-job] failed', { jobId, err })
    await ctx.prisma.importJob
      .update({
        where: { id: jobId },
        data: { status: 'FAILED', error: message, finishedAt: new Date() },
      })
      .catch(() => {})
  }
}

async function run(ctx: ImportJobContext, jobId: string): Promise<void> {
  const job = await ctx.prisma.importJob.findUniqueOrThrow({
    where: { id: jobId },
    include: { artifacts: { include: { file: true } } },
  })
  const source = job.artifacts.find((a) => a.kind === 'SOURCE')?.file
  if (!source) throw new ImportSourceError('Файл импорта не найден')

  const bytes = await streamToBuffer(await ctx.storage.get(source.path))
  const options = parseOptions(job.options)

  const plan: ImportPlan =
    job.format === 'ZIP' ? buildImportPlan(bytes) : singleFilePlan(job.format, source.name, bytes)

  // Idempotent resume: already-created entries are skipped via their mapping.
  const existing = await ctx.prisma.importMapping.findMany({
    where: { jobId },
    select: { sourceKey: true, pageId: true },
  })
  const mapped = new Map(existing.map((m) => [m.sourceKey, m.pageId]))

  await ctx.prisma.importJob.update({
    where: { id: jobId },
    data: { total: plan.totalPages, processed: mapped.size, heartbeatAt: new Date() },
  })

  const warnings = [...plan.warnings]
  const assetFileIds = await storeAssets(ctx, job, plan, warnings)

  const rootPageIds: string[] = []
  for (const node of plan.roots) {
    const id = await createNode(ctx, job, options, node, options.parentId, mapped, assetFileIds)
    rootPageIds.push(id)
  }

  await rewriteImportedLinks(ctx, job.workspaceId, plan, mapped)

  await ctx.prisma.importJob.update({
    where: { id: jobId },
    data: {
      status: 'DONE',
      finishedAt: new Date(),
      processed: plan.totalPages,
      result: {
        pagesCreated: mapped.size,
        rootPageIds,
        warnings,
      } as Prisma.InputJsonValue,
    },
  })
}

async function createNode(
  ctx: ImportJobContext,
  job: { id: string; userId: string; workspaceId: string },
  options: ImportOptions,
  node: ImportNode,
  parentPageId: string | null,
  mapped: Map<string, string>,
  assetFileIds: Map<string, string>,
): Promise<string> {
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
        const fileId = abs ? assetFileIds.get(abs) : undefined
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
    await ctx.prisma.importMapping.create({
      data: { jobId: job.id, sourceKey: node.sourceKey, pageId },
    })
    mapped.set(node.sourceKey, pageId)
    await ctx.prisma.importJob.update({
      where: { id: job.id },
      data: { processed: { increment: 1 }, heartbeatAt: new Date() },
    })
  }

  for (const child of node.children) {
    await createNode(ctx, job, options, child, pageId, mapped, assetFileIds)
  }
  return pageId
}

// Upload referenced image assets (content-hash dedup like the upload route).
// Over-quota assets are skipped with a warning rather than failing the import.
async function storeAssets(
  ctx: ImportJobContext,
  job: { userId: string; workspaceId: string },
  plan: ImportPlan,
  warnings: string[],
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

  const newBytes = toUpload.reduce((s, u) => s + u.buf.byteLength, 0)
  const [usage, limits] = await Promise.all([
    ctx.prisma.file.aggregate({
      where: { workspaceId: job.workspaceId, status: FileStatus.ACTIVE },
      _sum: { fileSize: true },
    }),
    ctx.prisma.workspaceLimit.findUnique({ where: { workspaceId: job.workspaceId } }),
  ])
  const used = usage._sum.fileSize ?? 0n
  if (limits && used + BigInt(newBytes) > limits.maxFileBytes) {
    warnings.push('Картинки из архива пропущены: превышен лимит хранилища пространства')
    return out
  }

  // Second pass: upload only the new assets.
  for (const { sourceKey, asset, hash, buf } of toUpload) {
    const s3Key = computeS3Key(hash, asset.ext)
    await ctx.storage.put(s3Key, buf, {
      contentType: MIME_BY_EXT[asset.ext] ?? 'application/octet-stream',
      size: buf.byteLength,
    })
    const created = await ctx.prisma.file.create({
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
  return out
}

// Second pass: relative inter-file links → /pages/<id>; re-saves content+contentYjs
// and re-enqueues indexing for changed pages only.
async function rewriteImportedLinks(
  ctx: ImportJobContext,
  workspaceId: string,
  plan: ImportPlan,
  mapped: Map<string, string>,
): Promise<void> {
  const resolve = (abs: string): string | null => {
    const id = mapped.get(abs) ?? mapped.get(`${abs}/`) ?? mapped.get(`${abs}.md`)
    return id ? `/pages/${id}` : null
  }
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

function parseOptions(raw: unknown): ImportOptions {
  const o = (raw ?? {}) as Record<string, unknown>
  return {
    location: o.location === 'private' ? 'private' : 'team',
    parentId: typeof o.parentId === 'string' ? o.parentId : null,
  }
}

export async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}
