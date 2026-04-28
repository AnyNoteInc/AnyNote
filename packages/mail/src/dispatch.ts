import 'server-only'
import { Prisma, type PrismaClient } from '@repo/db'
import type { MailEventPayload, MailKind, MailPayloads } from './types.js'
import { renderTemplate } from './templates/index.js'
import { getMailTransport } from './transport.js'

export type DispatchResult = {
  processed: number
  succeeded: number
  failed: number
  retried: number
}

export type DispatchOptions = {
  batch: number
  maxAttempts: number
  workerId: string
}

type ClaimedRow = {
  id: bigint
  payload: MailEventPayload
  attempts: number
}

export async function dispatchPending(
  prisma: PrismaClient,
  opts: DispatchOptions,
): Promise<DispatchResult> {
  const from = process.env.MAIL_FROM
  if (!from) throw new Error('MAIL_FROM env var is required')
  const rows = await claimBatch(prisma, opts)
  if (rows.length === 0) return { processed: 0, succeeded: 0, failed: 0, retried: 0 }
  const transport = getMailTransport()

  let succeeded = 0
  let failed = 0
  let retried = 0

  await Promise.all(
    rows.map(async (row) => {
      try {
        const rendered = renderTemplate(
          row.payload.kind,
          row.payload.data as MailPayloads[MailKind],
        )
        await transport.sendMail({
          from,
          to: row.payload.to,
          subject: rendered.subject,
          text: rendered.text,
          html: rendered.html,
        })
        await markDone(prisma, row.id)
        succeeded += 1
      } catch (err) {
        const result = await markFailedOrRetry(
          prisma,
          row.id,
          row.attempts,
          opts.maxAttempts,
          err,
        )
        if (result === 'retried') retried += 1
        else failed += 1
      }
    }),
  )

  return { processed: rows.length, succeeded, failed, retried }
}

type RawRow = { id: bigint; payload: MailEventPayload; attempts: number }

async function claimBatch(
  prisma: PrismaClient,
  opts: DispatchOptions,
): Promise<ClaimedRow[]> {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<RawRow[]>(Prisma.sql`
      SELECT id, payload, attempts
      FROM outbox_events
      WHERE status = 'PENDING'
        AND next_attempt_at <= now()
        AND aggregate_type = 'email'
        AND event_type = 'email.send'
      ORDER BY id
      LIMIT ${opts.batch}
      FOR UPDATE SKIP LOCKED
    `)
    if (rows.length === 0) return []
    const ids = rows.map((r) => r.id)
    await tx.$executeRaw(Prisma.sql`
      UPDATE outbox_events
      SET status='PROCESSING', locked_at=now(), locked_by=${opts.workerId}
      WHERE id IN (${Prisma.join(ids)})
    `)
    return rows
  })
}

async function markDone(prisma: PrismaClient, outboxId: bigint): Promise<void> {
  await prisma.$executeRaw(Prisma.sql`
    UPDATE outbox_events
    SET status='DONE', processed_at=now(), locked_at=NULL, locked_by=NULL
    WHERE id = ${outboxId}
  `)
}

async function markFailedOrRetry(
  prisma: PrismaClient,
  outboxId: bigint,
  attemptsBefore: number,
  maxAttempts: number,
  err: unknown,
): Promise<'retried' | 'failed'> {
  const message = err instanceof Error ? err.message : String(err)
  const newAttempts = attemptsBefore + 1
  const willFail = newAttempts >= maxAttempts
  const backoffSeconds = Math.min(60 * 16, 60 * 2 ** Math.min(attemptsBefore, 4))
  await prisma.$executeRaw(Prisma.sql`
    UPDATE outbox_events
    SET
      attempts = ${newAttempts},
      last_error = ${message},
      status = ${willFail ? 'FAILED' : 'PENDING'}::"OutboxEventStatus",
      next_attempt_at = now() + (${backoffSeconds} * interval '1 second'),
      locked_at = NULL,
      locked_by = NULL
    WHERE id = ${outboxId}
  `)
  return willFail ? 'failed' : 'retried'
}
