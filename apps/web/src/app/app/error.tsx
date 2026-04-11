"use client"

import { PageError } from "@/components/fallbacks/page-error"

export default function AppError({
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
      title="Ошибка в рабочем пространстве"
      hint="Не удалось загрузить данные. Попробуйте ещё раз или вернитесь на главную."
    />
  )
}
