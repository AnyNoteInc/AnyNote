import type { Metadata } from 'next'

import { ResetConfirmForm } from './reset-confirm-form'

export const metadata: Metadata = {
  title: 'Новый пароль',
}

export default async function ResetTokenPage({
  params,
}: Readonly<{ params: Promise<{ token: string }> }>) {
  const { token } = await params
  return <ResetConfirmForm token={token} />
}
