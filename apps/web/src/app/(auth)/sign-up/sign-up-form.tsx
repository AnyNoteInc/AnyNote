'use client'

import { useState } from 'react'

import { RegisterForm, type RegisterSubmitPayload } from '@repo/ui/widgets'
import { Alert } from '@repo/ui/components'
import { signUp } from '@/lib/auth-client'
import { captchaHeader, useRecaptchaV3 } from '@/lib/use-recaptcha-v3'

export function SignUpForm() {
  const executeRecaptcha = useRecaptchaV3()
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  const handleSubmit = async (values: RegisterSubmitPayload): Promise<void> => {
    setErrorMessage(null)
    setIsSubmitting(true)
    try {
      const token = await executeRecaptcha('sign_up')
      const payload = {
        name: `${values.lastName} ${values.firstName}`,
        email: values.email,
        password: values.password,
        firstName: values.firstName,
        lastName: values.lastName,
        callbackURL: '/verify-email?status=success',
        fetchOptions: { headers: captchaHeader(token) },
      }
      const { error } = await signUp.email(payload)
      if (error) {
        setErrorMessage(error.message ?? 'Не удалось зарегистрироваться.')
        return
      }
      setSubmitted(true)
    } catch (e) {
      setErrorMessage((e as Error).message ?? 'Не удалось зарегистрироваться.')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (submitted) {
    return (
      <Alert severity="success">
        Письмо с подтверждением отправлено на указанный email. Перейдите по ссылке в письме,
        чтобы завершить регистрацию.
      </Alert>
    )
  }

  return (
    <>
      {errorMessage ? <Alert severity="error">{errorMessage}</Alert> : null}
      <RegisterForm onSubmit={handleSubmit} isSubmitting={isSubmitting} />
    </>
  )
}
