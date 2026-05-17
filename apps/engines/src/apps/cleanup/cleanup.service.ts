import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { Pool } from 'pg'

@Injectable()
export class CleanupService {
  private readonly log = new Logger(CleanupService.name)
  constructor(private readonly db: Pool) {}

  @Cron(CronExpression.EVERY_HOUR)
  async runHourly(): Promise<void> {
    try {
      const n = await this.purgeOrphanedInterrupts()
      this.log.log(`purged ${n} orphaned interrupted checkpoints`)
    } catch (err) {
      this.log.error('purgeOrphanedInterrupts failed', err as Error)
    }
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
