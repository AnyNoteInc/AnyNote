'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

import { RegisterForm, type RegisterSubmitPayload } from '@repo/ui/widgets'
import { Alert } from '@repo/ui/components'

import { trpc } from '@/trpc/client'
import { setPendingCaptchaToken } from '@/lib/captcha-token-store'
import { useRecaptchaV3 } from '@/lib/use-recaptcha-v3'

const TERMS_URLS = {
  userAgreement: '/terms/user-agreement',
  privacyPolicy: '/terms/privacy-policy',
  piiConsent: '/terms/consent',
  publicOffer: '/terms/public-offer',
  marketingConsent: '/terms/marketing-consent',
} as const

export function SignUpForm() {
  const executeRecaptcha = useRecaptchaV3()
  const router = useRouter()
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const signUp = trpc.auth.signUp.useMutation()

  useEffect(() => {
    if (!submitted) return
    const timer = setTimeout(() => {
      router.push('/profile')
    }, 3000)
    return () => clearTimeout(timer)
  }, [submitted, router])

  const handleSubmit = async (values: RegisterSubmitPayload): Promise<void> => {
    setErrorMessage(null)
    try {
      const token = await executeRecaptcha('sign_up')
      setPendingCaptchaToken(token)
      await signUp.mutateAsync({
        email: values.email,
        password: values.password,
        firstName: values.firstName,
        lastName: values.lastName,
        marketing: values.agreedToMarketing,
      })
      setSubmitted(true)
    } catch (e) {
      setErrorMessage((e as Error).message ?? 'Не удалось зарегистрироваться.')
    }
  }

  if (submitted) {
    return (
      <Alert severity="success">
        Письмо с подтверждением отправлено на указанный email. Перейдите по ссылке в письме, чтобы
        завершить регистрацию.
      </Alert>
    )
  }

  return (
    <>
      {errorMessage ? <Alert severity="error">{errorMessage}</Alert> : null}
      <RegisterForm
        onSubmit={handleSubmit}
        isSubmitting={signUp.isPending}
        termsUrls={TERMS_URLS}
      />
    </>
  )
}
