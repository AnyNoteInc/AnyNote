'use client'

import { PageError } from '@/components/fallbacks/page-error'

export default function AboutError({
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
      title="Страница недоступна"
      hint="Не удалось загрузить содержимое публичного раздела. Попробуйте ещё раз."
    />
  )
}
