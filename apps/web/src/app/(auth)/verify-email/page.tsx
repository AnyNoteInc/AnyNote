import type { Metadata } from 'next'

import { VerifyEmailView, type VerifyEmailStatus } from './verify-email-view'

export const metadata: Metadata = {
  title: 'Подтверждение email',
}

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; error?: string }>
}) {
  const sp = await searchParams
  const rawStatus = sp.status ?? (sp.error ? 'error' : 'pending')
  const status: VerifyEmailStatus = ['success', 'error', 'expired', 'pending'].includes(rawStatus)
    ? (rawStatus as VerifyEmailStatus)
    : 'error'
  return <VerifyEmailView status={status} />
}
