'use client'

import { PageError } from '@/components/fallbacks/page-error'

export default function AuthError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <PageError
      error={error}
      reset={reset}
      title="Не удалось завершить авторизацию"
      hint="Попробуйте повторить вход или обновите страницу."
    />
  )
}
