'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { LoginForm, type LoginFormValues } from '@repo/ui/widgets'
import { Alert } from '@repo/ui/components'
import { signIn } from '@/lib/auth-client'
import { captchaHeader, useRecaptchaV3 } from '@/lib/use-recaptcha-v3'

// Honor a same-origin ?redirect= (e.g. arriving from a /s/{shareId} share link),
// rejecting protocol-relative / absolute targets to avoid open redirects.
function safeRedirectTarget(): string {
  if (globalThis.window === undefined) return '/app'
  const raw = new URLSearchParams(globalThis.location.search).get('redirect')
  return raw && /^\/[^/\\]/.test(raw) ? raw : '/app'
}

export function SignInForm() {
  const router = useRouter()
  const executeRecaptcha = useRecaptchaV3()
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [ssoError, setSsoError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (values: LoginFormValues): Promise<void> => {
    setErrorMessage(null)
    setIsSubmitting(true)
    const redirectTo = safeRedirectTarget()
    try {
      const token = await executeRecaptcha('sign_in')
      const { error } = await signIn.email({
        email: values.email,
        password: values.password,
        rememberMe: values.rememberMe,
        callbackURL: redirectTo,
        fetchOptions: { headers: captchaHeader(token) },
      })
      if (error) {
        setErrorMessage(error.message ?? 'Не удалось войти. Попробуйте позже.')
        return
      }
      router.push(redirectTo)
      router.refresh()
    } catch (e) {
      setErrorMessage((e as Error).message ?? 'Не удалось войти.')
    } finally {
      setIsSubmitting(false)
    }
  }

  // Resolve the opaque ssoProviderId for the email's domain, then start the
  // better-auth flow (POST /api/auth/sign-in/sso → { url, redirect } — the
  // client auto-navigates to the IdP). Uniform `{available: false}` covers
  // every miss, so the only honest message is «не настроен».
  const handleSso = async (email: string): Promise<void> => {
    setSsoError(null)
    try {
      const res = await fetch('/api/sso/resolve', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const data = (await res.json().catch(() => null)) as {
        available?: boolean
        providerId?: string
      } | null
      if (!res.ok || !data?.available || !data.providerId) {
        setSsoError('SSO не настроен для этого домена')
        return
      }
      const { error } = await signIn.sso({
        providerId: data.providerId,
        email,
        callbackURL: safeRedirectTarget(),
      })
      if (error) {
        setSsoError(error.message ?? 'Не удалось начать вход через SSO.')
      }
    } catch {
      setSsoError('Не удалось начать вход через SSO.')
    }
  }

  return (
    <>
      {errorMessage ? <Alert severity="error">{errorMessage}</Alert> : null}
      <LoginForm
        onSubmit={handleSubmit}
        onSso={handleSso}
        ssoError={ssoError}
        isSubmitting={isSubmitting}
      />
    </>
  )
}
