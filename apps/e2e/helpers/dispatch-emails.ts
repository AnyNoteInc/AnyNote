export async function flushMailQueue(opts?: {
  batch?: number
  workerId?: string
  maxAttempts?: number
}): Promise<void> {
  process.env.MAIL_FROM = process.env.MAIL_FROM ?? 'AnyNote <noreply@anynote.local>'
  process.env.SMTP_HOST = process.env.SMTP_HOST ?? 'localhost'
  process.env.SMTP_PORT = process.env.SMTP_PORT ?? '1025'
  process.env.SMTP_SECURE = process.env.SMTP_SECURE ?? 'false'

  const db = await import('../../../packages/db/src/index')
  const templates = await import('../../../packages/mail/src/templates/index')
  const nodemailerModule = await import(
    '../../../packages/mail/node_modules/nodemailer/lib/nodemailer.js'
  )
  const nodemailer = nodemailerModule.default as typeof import('nodemailer')
  const batch = opts?.batch ?? 50
  const workerId = opts?.workerId ?? 'e2e-flush'

  const rows = await db.prisma.$transaction(async (tx) => {
    const claimed = await tx.$queryRaw<
      Array<{ id: bigint; payload: { kind: string; to: string; data: unknown } }>
    >(db.Prisma.sql`
      SELECT id, payload
      FROM outbox_events
      WHERE status = 'PENDING'
        AND next_attempt_at <= now()
        AND aggregate_type = 'email'
        AND event_type = 'email.send'
      ORDER BY id
      LIMIT ${batch}
      FOR UPDATE SKIP LOCKED
    `)
    if (claimed.length === 0) return []
    await tx.$executeRaw(db.Prisma.sql`
      UPDATE outbox_events
      SET status='PROCESSING', locked_at=now(), locked_by=${workerId}
      WHERE id IN (${db.Prisma.join(claimed.map((row) => row.id))})
    `)
    return claimed
  })

  if (rows.length === 0) return

  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 1025),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD ?? '' }
      : undefined,
  })

  await Promise.all(
    rows.map(async (row) => {
      const rendered = templates.renderTemplate(row.payload.kind as never, row.payload.data)
      await transport.sendMail({
        from: process.env.MAIL_FROM,
        to: row.payload.to,
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
      })
      await db.prisma.$executeRaw(db.Prisma.sql`
        UPDATE outbox_events
        SET status='DONE', processed_at=now(), locked_at=NULL, locked_by=NULL
        WHERE id = ${row.id}
      `)
    }),
  )

  transport.close()
}
