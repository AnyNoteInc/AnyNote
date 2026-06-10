import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { CollectionKind, Prisma, type PrismaClient } from '@repo/db'
import { buildPageVisibilityWhere } from '@repo/domain'

import { router, protectedProcedure } from '../trpc'
import { assertPageEditAccess, assertWorkspaceMember } from '../helpers/page-access'
import { requireWritableWorkspace } from '../helpers/plan'

/** PROCESSING older than this (by heartbeat) is considered orphaned. */
export const RECLAIM_AFTER_MS = 10 * 60 * 1000
/** QUEUED that never started within this window lost its kick (deploy) — re-kick. */
export const REKICK_QUEUED_AFTER_MS = 60 * 1000

type JobStatusValue = 'QUEUED' | 'PROCESSING' | 'DONE' | 'FAILED'

const exportCreateInput = z.object({
  workspaceId: z.string().uuid(),
  scope: z.enum(['WORKSPACE', 'COLLECTION', 'SUBTREE']),
  scopeId: z.string().uuid().nullish(),
  format: z.enum(['MARKDOWN_ZIP', 'HTML_ZIP', 'PDF_ZIP']),
})

const importCreateInput = z.object({
  workspaceId: z.string().uuid(),
  fileId: z.string().uuid(),
  format: z.enum(['MARKDOWN', 'HTML', 'ZIP', 'CSV']),
  source: z.enum(['GENERIC', 'NOTION', 'CONFLUENCE', 'YANDEX_WIKI']).default('GENERIC'),
  location: z.enum(['team', 'private']).default('team'),
  parentId: z.string().uuid().nullish(),
  // CSV-only knobs: per-column type pins (keyed by the FULL header index as a
  // string; column 0 is the title and never overridable) + the database title.
  columnOverrides: z
    .record(
      z.string(),
      z.enum([
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
      ]),
    )
    .optional(),
  databaseTitle: z.string().trim().min(1).max(200).optional(),
})

/** Sources whose exports are only meaningful as a ZIP archive. */
const ZIP_ONLY_SOURCES: ReadonlySet<string> = new Set(['NOTION', 'CONFLUENCE'])

const ACTIVE: JobStatusValue[] = ['QUEUED', 'PROCESSING']

const ACTIVE_JOB_MESSAGE = {
  export: 'Экспорт уже выполняется — дождитесь завершения',
  import: 'Импорт уже выполняется — дождитесь завершения',
} as const

async function assertNoActiveJob(
  prisma: PrismaClient,
  kind: 'import' | 'export',
  workspaceId: string,
): Promise<void> {
  const count =
    kind === 'export'
      ? await prisma.exportJob.count({ where: { workspaceId, status: { in: ACTIVE } } })
      : await prisma.importJob.count({ where: { workspaceId, status: { in: ACTIVE } } })
  if (count > 0) {
    throw new TRPCError({ code: 'CONFLICT', message: ACTIVE_JOB_MESSAGE[kind] })
  }
}

/**
 * The count-based pre-flight above is racy (count-then-create TOCTOU); the real
 * guarantee is the SQL-only partial unique indexes
 * (export_jobs|import_jobs)_workspace_active_unique. Map their P2002 to the same
 * friendly CONFLICT the pre-flight raises.
 */
function rethrowActiveJobConflict(e: unknown, kind: 'import' | 'export'): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
    throw new TRPCError({ code: 'CONFLICT', message: ACTIVE_JOB_MESSAGE[kind] })
  }
  throw e
}

export type JobListItem = {
  id: string
  kind: 'import' | 'export'
  status: JobStatusValue
  scope: string | null
  format: string
  processed: number
  total: number
  error: string | null
  createdAt: Date
  finishedAt: Date | null
  hasArtifact: boolean
  sourceName: string | null
  hasReport: boolean
  /** Structured import warnings from the result JSON, capped at 50 for the log dialog. */
  warnings: string[]
  /** UNCAPPED warnings length, so the UI can say «и ещё N». */
  warningsCount: number
  source: string | null
}

/** Maximum warnings shipped to the client per job row (the report has the full list). */
const WARNINGS_CAP = 50

function importWarnings(result: Prisma.JsonValue | null): string[] {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return []
  const raw = (result as Prisma.JsonObject).warnings
  if (!Array.isArray(raw)) return []
  return raw.filter((w): w is string => typeof w === 'string')
}

export const jobRouter = router({
  export: router({
    create: protectedProcedure.input(exportCreateInput).mutation(async ({ ctx, input }) => {
      await assertWorkspaceMember(ctx, input.workspaceId)
      // Deliberately NO requireWritableWorkspace here: export is data portability —
      // users must be able to take their data out even when the workspace is over
      // its plan limits. Import (which writes pages) IS plan-gated.

      if (input.scope !== 'WORKSPACE' && !input.scopeId) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Не указан объект экспорта' })
      }
      // PDF renders page-by-page through Gotenberg — a whole workspace is
      // unbounded; the processor additionally caps PDF jobs at PDF_PAGE_LIMIT.
      if (input.format === 'PDF_ZIP' && input.scope === 'WORKSPACE') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'PDF недоступен для всего пространства — используйте Markdown или HTML',
        })
      }
      if (input.scope === 'COLLECTION') {
        const col = await ctx.prisma.collection.findFirst({
          where: { id: input.scopeId!, workspaceId: input.workspaceId },
          select: { kind: true, ownerId: true },
        })
        if (!col || (col.kind === CollectionKind.PERSONAL && col.ownerId !== ctx.user.id)) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Раздел не найден' })
        }
      }
      if (input.scope === 'SUBTREE') {
        // Root must exist, live in this workspace, and be VISIBLE to the caller.
        const root = await ctx.prisma.page.findFirst({
          where: {
            id: input.scopeId!,
            workspaceId: input.workspaceId,
            deletedAt: null,
            archivedAt: null,
            AND: [buildPageVisibilityWhere(ctx.user.id)],
          },
          select: { id: true },
        })
        if (!root) throw new TRPCError({ code: 'NOT_FOUND', message: 'Страница не найдена' })
      }

      await assertNoActiveJob(ctx.prisma, 'export', input.workspaceId)
      let job
      try {
        job = await ctx.prisma.exportJob.create({
          data: {
            workspaceId: input.workspaceId,
            userId: ctx.user.id,
            scope: input.scope,
            scopeId: input.scope === 'WORKSPACE' ? null : input.scopeId,
            format: input.format,
          },
        })
      } catch (e) {
        rethrowActiveJobConflict(e, 'export')
      }
      ctx.jobs.kick(job.id, 'export')
      return { id: job.id }
    }),
  }),

  import: router({
    create: protectedProcedure.input(importCreateInput).mutation(async ({ ctx, input }) => {
      await assertWorkspaceMember(ctx, input.workspaceId)
      await requireWritableWorkspace(input.workspaceId)

      // CSV is a single plain file: only the GENERIC source can carry it.
      if (input.format === 'CSV' && input.source !== 'GENERIC') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'CSV импортируется только как файл' })
      }
      if (ZIP_ONLY_SOURCES.has(input.source) && input.format !== 'ZIP') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Для этого источника нужен ZIP-архив' })
      }

      const file = await ctx.prisma.file.findFirst({
        where: { id: input.fileId, userId: ctx.user.id, status: 'ACTIVE' },
        select: { id: true, ext: true },
      })
      if (!file) throw new TRPCError({ code: 'NOT_FOUND', message: 'Файл не найден' })
      const extOk =
        (input.format === 'ZIP' && file.ext === 'zip') ||
        (input.format === 'MARKDOWN' && ['md', 'markdown'].includes(file.ext)) ||
        (input.format === 'HTML' && ['html', 'htm'].includes(file.ext)) ||
        (input.format === 'CSV' && file.ext === 'csv')
      if (!extOk) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Формат файла не совпадает' })
      }
      if (input.parentId) {
        const parent = await assertPageEditAccess(ctx, input.parentId)
        if (parent.workspaceId !== input.workspaceId || parent.deletedAt || parent.archivedAt) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Родительская страница не найдена' })
        }
      }

      await assertNoActiveJob(ctx.prisma, 'import', input.workspaceId)
      let job
      try {
        job = await ctx.prisma.importJob.create({
          data: {
            workspaceId: input.workspaceId,
            userId: ctx.user.id,
            format: input.format,
            source: input.source,
            options: {
              location: input.location,
              parentId: input.parentId ?? null,
              ...(input.columnOverrides ? { columnOverrides: input.columnOverrides } : {}),
              ...(input.databaseTitle ? { databaseTitle: input.databaseTitle } : {}),
            },
            artifacts: { create: { fileId: input.fileId, kind: 'SOURCE' } },
          },
        })
      } catch (e) {
        rethrowActiveJobConflict(e, 'import')
      }
      ctx.jobs.kick(job.id, 'import')
      return { id: job.id }
    }),
  }),

  list: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .query(async ({ ctx, input }): Promise<JobListItem[]> => {
      await assertWorkspaceMember(ctx, input.workspaceId)
      const own = { workspaceId: input.workspaceId, userId: ctx.user.id }

      // ── Lazy reclaim (caller's jobs only) ──────────────────────────────────
      const staleBefore = new Date(Date.now() - RECLAIM_AFTER_MS)
      const queuedBefore = new Date(Date.now() - REKICK_QUEUED_AFTER_MS)
      for (const kind of ['export', 'import'] as const) {
        const model = kind === 'export' ? ctx.prisma.exportJob : ctx.prisma.importJob
        const stuck = await (model as typeof ctx.prisma.exportJob).findMany({
          where: { ...own, status: 'PROCESSING', heartbeatAt: { lt: staleBefore } },
          select: { id: true },
        })
        for (const j of stuck) {
          // Atomic per-job transition guards against a concurrent poller.
          const res = await (model as typeof ctx.prisma.exportJob).updateMany({
            where: { id: j.id, status: 'PROCESSING', heartbeatAt: { lt: staleBefore } },
            data: { status: 'QUEUED', heartbeatAt: null },
          })
          if (res.count === 1) ctx.jobs.kick(j.id, kind)
        }
        // QUEUED rows whose kick died with the process: re-kick (claim is atomic).
        const lost = await (model as typeof ctx.prisma.exportJob).findMany({
          where: {
            ...own,
            status: 'QUEUED',
            heartbeatAt: null,
            createdAt: { lt: queuedBefore },
          },
          select: { id: true },
        })
        for (const j of lost) ctx.jobs.kick(j.id, kind)
      }

      // ── Unified list ───────────────────────────────────────────────────────
      const [exports, imports] = await Promise.all([
        ctx.prisma.exportJob.findMany({
          where: own,
          orderBy: { createdAt: 'desc' },
          take: 50,
          include: { artifacts: { select: { id: true } } },
        }),
        ctx.prisma.importJob.findMany({
          where: own,
          orderBy: { createdAt: 'desc' },
          take: 50,
          include: {
            artifacts: { select: { kind: true, file: { select: { name: true, ext: true } } } },
          },
        }),
      ])
      const items: JobListItem[] = [
        ...exports.map(
          (j): JobListItem => ({
            id: j.id,
            kind: 'export',
            status: j.status,
            scope: j.scope,
            format: j.format,
            processed: j.processed,
            total: j.total,
            error: j.error,
            createdAt: j.createdAt,
            finishedAt: j.finishedAt,
            hasArtifact: j.status === 'DONE' && j.artifacts.length > 0,
            sourceName: null,
            hasReport: false,
            warnings: [],
            warningsCount: 0,
            source: null,
          }),
        ),
        ...imports.map((j): JobListItem => {
          const src = j.artifacts.find((a) => a.kind === 'SOURCE')?.file
          const warnings = importWarnings(j.result)
          return {
            id: j.id,
            kind: 'import',
            status: j.status,
            scope: null,
            format: j.format,
            processed: j.processed,
            total: j.total,
            error: j.error,
            createdAt: j.createdAt,
            finishedAt: j.finishedAt,
            hasArtifact: false,
            sourceName: src ? `${src.name}${src.ext ? `.${src.ext}` : ''}` : null,
            hasReport: j.artifacts.some((a) => a.kind === 'REPORT'),
            warnings: warnings.slice(0, WARNINGS_CAP),
            warningsCount: warnings.length,
            source: j.source,
          }
        }),
      ]
      items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      return items.slice(0, 50)
    }),

  delete: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
        kind: z.enum(['import', 'export']),
        jobId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertWorkspaceMember(ctx, input.workspaceId)
      const own = { id: input.jobId, workspaceId: input.workspaceId, userId: ctx.user.id }
      if (input.kind === 'export') {
        const job = await ctx.prisma.exportJob.findFirst({
          where: own,
          include: { artifacts: { include: { file: true } } },
        })
        if (!job) throw new TRPCError({ code: 'NOT_FOUND', message: 'Задание не найдено' })
        // Artifact zips live under unique exports/<jobId>.zip keys; the File rows
        // are deleted here so quota frees immediately. (Import SOURCE files are
        // normal content-addressed attachments shared by hash and are NEVER
        // physically deleted here.) Physical S3 cleanup is a follow-up (objects
        // expire from the download route after 7 days).
        const files = job.artifacts.map((a) => a.file)
        await ctx.prisma.exportJob.delete({ where: { id: job.id } })
        for (const f of files) {
          await ctx.prisma.file.delete({ where: { id: f.id } }).catch((e) => {
            console.warn('[jobs] artifact file delete failed, row orphaned', { fileId: f.id, e })
          })
        }
        return { ok: true }
      }
      const job = await ctx.prisma.importJob.findFirst({
        where: own,
        include: { artifacts: { include: { file: true } } },
      })
      if (!job) throw new TRPCError({ code: 'NOT_FOUND', message: 'Задание не найдено' })
      // REPORT artifacts are job-private files (workspaceId NULL, unique
      // imports/<jobId>-report.txt keys) — delete their rows like the export
      // branch. SOURCE files stay: they're normal content-addressed attachments
      // shared by hash.
      const reports = job.artifacts.filter((a) => a.kind === 'REPORT').map((a) => a.file)
      await ctx.prisma.importJob.delete({ where: { id: job.id } })
      for (const f of reports) {
        await ctx.prisma.file.delete({ where: { id: f.id } }).catch((e) => {
          console.warn('[jobs] artifact file delete failed, row orphaned', { fileId: f.id, e })
        })
      }
      return { ok: true }
    }),
})
