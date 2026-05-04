'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { ResetPasswordConfirmForm } from '@repo/ui/widgets'

import { authClient } from '@/lib/auth-client'

export function ResetConfirmForm({ token }: { token: string }) {
  const router = useRouter()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const handleSubmit = async (newPassword: string): Promise<void> => {
    setErrorMessage(null)
    setIsSubmitting(true)
    try {
      const { error } = await authClient.resetPassword({
        newPassword,
        token,
      })
      if (error) {
        setErrorMessage(
          'Ссылка недействительна или истекла. Запросите восстановление пароля заново.',
        )
        return
      }
      router.push('/sign-in')
      router.refresh()
    } catch (e) {
      setErrorMessage((e as Error).message ?? 'Не удалось сменить пароль.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <ResetPasswordConfirmForm
      onSubmit={handleSubmit}
      isSubmitting={isSubmitting}
      errorMessage={errorMessage}
    />
  )
}
