'use client'

import { useState } from 'react'

import {
  ResetPasswordRequestForm,
  type ResetPasswordRequestFormValues,
} from '@repo/ui/widgets'
import { Alert } from '@repo/ui/components'

import { authClient } from '@/lib/auth-client'
import { captchaHeader, useRecaptchaV3 } from '@/lib/use-recaptcha-v3'

type PasswordResetClient = {
  requestPasswordReset?: (args: {
    email: string
    redirectTo?: string
    fetchOptions?: { headers?: Record<string, string> }
  }) => Promise<{ error?: { message?: string } | null }>
  forgetPassword?: (args: {
    email: string
    redirectTo?: string
    fetchOptions?: { headers?: Record<string, string> }
  }) => Promise<{ error?: { message?: string } | null }>
}

export function ResetRequestForm() {
  const executeRecaptcha = useRecaptchaV3()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const handleSubmit = async (values: ResetPasswordRequestFormValues): Promise<void> => {
    setErrorMessage(null)
    setSuccessMessage(null)
    setIsSubmitting(true)
    try {
      const token = await executeRecaptcha('request_password_reset')
      const client = authClient as PasswordResetClient
      const requestReset = client.requestPasswordReset ?? client.forgetPassword
      if (!requestReset) {
        throw new Error('Password reset endpoint is unavailable.')
      }
      const { error } = await requestReset({
        email: values.email,
        redirectTo: '/reset-credentials',
        fetchOptions: { headers: captchaHeader(token) },
      })
      if (error) {
        setErrorMessage(error.message ?? 'Не удалось отправить письмо. Попробуйте позже.')
        return
      }
      setSuccessMessage(
        'Если такой email зарегистрирован, мы отправили инструкцию для восстановления пароля.',
      )
    } catch (e) {
      setErrorMessage((e as Error).message ?? 'Не удалось отправить письмо.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <>
      {errorMessage ? <Alert severity="error">{errorMessage}</Alert> : null}
      <ResetPasswordRequestForm
        onSubmit={handleSubmit}
        isSubmitting={isSubmitting}
        successMessage={successMessage}
      />
    </>
  )
}
