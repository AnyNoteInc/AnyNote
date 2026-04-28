import 'server-only'
import nodemailer, { type Transporter } from 'nodemailer'

let _transport: Transporter | null = null

export function getMailTransport(): Transporter {
  if (_transport) return _transport
  _transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD ?? '' }
      : undefined,
    pool: true,
  })
  return _transport
}

/** Test-only helper to reset cached transporter. */
export function __resetMailTransport(): void {
  _transport = null
}
