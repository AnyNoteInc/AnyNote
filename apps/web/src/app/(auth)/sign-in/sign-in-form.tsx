'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { LoginForm, type LoginFormValues } from '@repo/ui/widgets'
import { Alert } from '@repo/ui/components'
import { signIn } from '@/lib/auth-client'
import { captchaHeader, useRecaptchaV3 } from '@/lib/use-recaptcha-v3'

export function SignInForm() {
  const router = useRouter()
  const executeRecaptcha = useRecaptchaV3()
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (values: LoginFormValues): Promise<void> => {
    setErrorMessage(null)
    setIsSubmitting(true)
    try {
      const token = await executeRecaptcha('sign_in')
      const { error } = await signIn.email({
        email: values.email,
        password: values.password,
        rememberMe: values.rememberMe,
        callbackURL: '/app',
        fetchOptions: { headers: captchaHeader(token) },
      })
      if (error) {
        setErrorMessage(error.message ?? 'Не удалось войти. Попробуйте позже.')
        return
      }
      router.push('/app')
      router.refresh()
    } catch (e) {
      setErrorMessage((e as Error).message ?? 'Не удалось войти.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleGoogle = async (): Promise<void> => {
    setErrorMessage(null)
    await signIn.social({ provider: 'google', callbackURL: '/app' })
  }

  return (
    <>
      {errorMessage ? <Alert severity="error">{errorMessage}</Alert> : null}
      <LoginForm onSubmit={handleSubmit} onGoogle={handleGoogle} isSubmitting={isSubmitting} />
    </>
  )
}
