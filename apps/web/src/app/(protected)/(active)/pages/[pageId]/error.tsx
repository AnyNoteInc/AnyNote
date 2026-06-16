'use client'

import { PageError } from '@/components/fallbacks/page-error'

export default function PageErrorBoundary({
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
      title="Не удалось открыть страницу"
      hint="Произошла ошибка при отображении содержимого. Попробуйте обновить."
    />
  )
}
