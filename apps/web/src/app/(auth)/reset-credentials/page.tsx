import type { Metadata } from 'next'

import { ResetRequestForm } from './reset-request-form'

export const metadata: Metadata = {
  title: 'Восстановление пароля',
}

export default function ResetCredentialsPage() {
  return <ResetRequestForm />
}
