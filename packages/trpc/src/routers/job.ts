import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { CollectionKind, type PrismaClient } from '@repo/db'
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
  format: z.enum(['MARKDOWN_ZIP', 'HTML_ZIP']),
})

const importCreateInput = z.object({
  workspaceId: z.string().uuid(),
  fileId: z.string().uuid(),
  format: z.enum(['MARKDOWN', 'HTML', 'ZIP']),
  location: z.enum(['team', 'private']).default('team'),
  parentId: z.string().uuid().nullish(),
})

const ACTIVE: JobStatusValue[] = ['QUEUED', 'PROCESSING']

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
    throw new TRPCError({
      code: 'CONFLICT',
      message:
        kind === 'export'
          ? 'Экспорт уже выполняется — дождитесь завершения'
          : 'Импорт уже выполняется — дождитесь завершения',
    })
  }
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
}

export const jobRouter = router({
  export: router({
    create: protectedProcedure.input(exportCreateInput).mutation(async ({ ctx, input }) => {
      await assertWorkspaceMember(ctx, input.workspaceId)

      if (input.scope !== 'WORKSPACE' && !input.scopeId) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Не указан объект экспорта' })
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
      const job = await ctx.prisma.exportJob.create({
        data: {
          workspaceId: input.workspaceId,
          userId: ctx.user.id,
          scope: input.scope,
          scopeId: input.scope === 'WORKSPACE' ? null : input.scopeId,
          format: input.format,
        },
      })
      ctx.jobs.kick(job.id, 'export')
      return { id: job.id }
    }),
  }),

  import: router({
    create: protectedProcedure.input(importCreateInput).mutation(async ({ ctx, input }) => {
      await assertWorkspaceMember(ctx, input.workspaceId)
      await requireWritableWorkspace(input.workspaceId)

      const file = await ctx.prisma.file.findFirst({
        where: { id: input.fileId, userId: ctx.user.id, status: 'ACTIVE' },
        select: { id: true, ext: true },
      })
      if (!file) throw new TRPCError({ code: 'NOT_FOUND', message: 'Файл не найден' })
      const extOk =
        (input.format === 'ZIP' && file.ext === 'zip') ||
        (input.format === 'MARKDOWN' && ['md', 'markdown'].includes(file.ext)) ||
        (input.format === 'HTML' && ['html', 'htm'].includes(file.ext))
      if (!extOk) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Формат файла не совпадает' })
      }
      if (input.parentId) {
        const parent = await assertPageEditAccess(ctx, input.parentId)
        if (parent.workspaceId !== input.workspaceId || parent.deletedAt) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Родительская страница не найдена' })
        }
      }

      await assertNoActiveJob(ctx.prisma, 'import', input.workspaceId)
      const job = await ctx.prisma.importJob.create({
        data: {
          workspaceId: input.workspaceId,
          userId: ctx.user.id,
          format: input.format,
          options: { location: input.location, parentId: input.parentId ?? null },
          artifacts: { create: { fileId: input.fileId, kind: 'SOURCE' } },
        },
      })
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
          include: { artifacts: { include: { file: { select: { name: true, ext: true } } } } },
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
          }),
        ),
        ...imports.map((j): JobListItem => {
          const src = j.artifacts[0]?.file
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
          await ctx.prisma.file.delete({ where: { id: f.id } }).catch(() => {})
        }
        return { ok: true }
      }
      const job = await ctx.prisma.importJob.findFirst({ where: own, select: { id: true } })
      if (!job) throw new TRPCError({ code: 'NOT_FOUND', message: 'Задание не найдено' })
      await ctx.prisma.importJob.delete({ where: { id: job.id } })
      return { ok: true }
    }),
})
