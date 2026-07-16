import { Inject, Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import * as Sentry from '@sentry/nestjs'
import type { PrismaClient } from '@repo/db'
import type { StorageClient } from '@repo/storage'
import { Pool } from 'pg'

import { PRISMA } from '../../infra/db/db.providers.js'

export const CLEANUP_STORAGE = Symbol('CLEANUP_STORAGE')

@Injectable()
export class CleanupService {
  private readonly log = new Logger(CleanupService.name)
  constructor(
    private readonly db: Pool,
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(CLEANUP_STORAGE) private readonly storage: StorageClient,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async runHourly(): Promise<void> {
    try {
      const n = await this.purgeOrphanedInterrupts()
      this.log.log(`purged ${n} orphaned interrupted checkpoints`)
    } catch (err) {
      this.log.error('purgeOrphanedInterrupts failed', err as Error)
      Sentry.captureException(err, { tags: { service: 'engines', worker: 'cleanup' } })
    }

    try {
      const n = await this.purgeExpiredFormUploads()
      this.log.log(`purged ${n} expired form upload leases`)
    } catch (err) {
      this.log.error('purgeExpiredFormUploads failed', err as Error)
      Sentry.captureException(err, {
        tags: { service: 'engines', worker: 'cleanup', job: 'form-uploads' },
      })
    }
  }

  async purgeExpiredFormUploads(now = new Date()): Promise<number> {
    const leases = await this.prisma.databaseFormUpload.findMany({
      where: { consumedAt: null, expiresAt: { lt: now } },
      select: {
        id: true,
        fileId: true,
        file: { select: { path: true, workspaceId: true } },
      },
      orderBy: { expiresAt: 'asc' },
      take: 500,
    })

    let deleted = 0
    for (const lease of leases) {
      let removed = false
      try {
        removed = await this.prisma.$transaction(async (tx) => {
          if (lease.file.workspaceId === null) throw new Error('FORM_UPLOAD_WORKSPACE_MISSING')
          const workspace = await tx.$queryRaw<{ id: string }[]>`
            SELECT id FROM workspaces
            WHERE id = ${lease.file.workspaceId}::uuid
            FOR UPDATE
          `
          if (workspace.length !== 1) throw new Error('FORM_UPLOAD_WORKSPACE_MISSING')
          const files = await tx.$queryRaw<{ id: string }[]>`
            SELECT id FROM files
            WHERE id = ${lease.fileId}::uuid
              AND workspace_id = ${lease.file.workspaceId}::uuid
              AND status = 'PENDING'::"FileStatus"
            FOR UPDATE
          `
          if (files.length !== 1) throw new Error('FORM_UPLOAD_FILE_NOT_FOUND')
          const leaseDelete = await tx.databaseFormUpload.deleteMany({
            where: {
              id: lease.id,
              fileId: lease.fileId,
              consumedAt: null,
              expiresAt: { lt: now },
            },
          })
          if (leaseDelete.count !== 1) return false
          const fileDelete = await tx.file.deleteMany({
            where: {
              id: lease.fileId,
              status: 'PENDING',
            },
          })
          if (fileDelete.count !== 1) throw new Error('FORM_UPLOAD_FILE_NOT_DELETED')
          return true
        })
      } catch (err) {
        this.log.error(`expired form upload cleanup failed for ${lease.id}`, err as Error)
        Sentry.captureException(err, {
          tags: { service: 'engines', worker: 'cleanup', job: 'form-upload-row' },
        })
        continue
      }

      if (!removed) continue
      deleted += 1
      try {
        await this.prisma.$transaction(async (tx) => {
          if (lease.file.workspaceId === null) return
          const workspace = await tx.$queryRaw<{ id: string }[]>`
            SELECT id FROM workspaces
            WHERE id = ${lease.file.workspaceId}::uuid
            FOR UPDATE
          `
          if (workspace.length !== 1) return
          const references = await tx.file.count({ where: { path: lease.file.path } })
          if (references === 0) await this.storage.delete(lease.file.path)
        })
      } catch (err) {
        this.log.error(
          `expired form upload object cleanup failed for ${lease.file.path}`,
          err as Error,
        )
        Sentry.captureException(err, {
          tags: { service: 'engines', worker: 'cleanup', job: 'form-upload-object' },
        })
      }
    }
    return deleted
  }

  async purgeOrphanedInterrupts(): Promise<number> {
    // LangGraph's AsyncPostgresSaver (langgraph-checkpoint-postgres) creates:
    //   - checkpoints(thread_id, checkpoint_ns, checkpoint_id, …, checkpoint jsonb, metadata jsonb)
    //     The checkpoint column contains a "ts" field (ISO-8601 timestamp).
    //     There is NO created_at column — use (checkpoint->>'ts')::timestamptz instead.
    //   - checkpoint_writes(thread_id, checkpoint_ns, checkpoint_id, task_id, idx, channel, …)
    //     Pending interrupts have a row with channel = '__interrupt__'.
    //     A checkpoint is "resolved" when a later checkpoint_write with channel = '__resume__'
    //     exists for the same thread_id.
    //
    // Verified against the `agents` Postgres database on 2026-05-17 via:
    //   docker exec anynote-postgres-1 psql -U user -d agents -c "\dt"
    //   docker exec anynote-postgres-1 psql -U user -d agents -c "\d checkpoints"
    //   docker exec anynote-postgres-1 psql -U user -d agents -c "SELECT channel FROM checkpoint_writes GROUP BY channel"
    const result = await this.db.query<{ deleted: number }>(`
      WITH del AS (
        DELETE FROM checkpoints c
        USING checkpoint_writes cw
        WHERE cw.thread_id = c.thread_id
          AND cw.checkpoint_id = c.checkpoint_id
          AND cw.channel = '__interrupt__'
          AND (c.checkpoint->>'ts')::timestamptz < NOW() - INTERVAL '24 hours'
          AND NOT EXISTS (
            SELECT 1 FROM checkpoint_writes cw2
            WHERE cw2.thread_id = c.thread_id
              AND cw2.channel = '__resume__'
              AND cw2.checkpoint_id > c.checkpoint_id
          )
        RETURNING 1
      )
      SELECT COUNT(*)::int AS deleted FROM del
    `)
    return result.rows[0]?.deleted ?? 0
  }
}
