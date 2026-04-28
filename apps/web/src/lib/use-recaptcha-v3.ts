'use client'

import { useCallback } from 'react'
import { useGoogleReCaptcha } from 'react-google-recaptcha-v3'

export function useRecaptchaV3(): (action: string) => Promise<string | null> {
  const { executeRecaptcha } = useGoogleReCaptcha()
  return useCallback(
    async (action: string): Promise<string | null> => {
      if (!process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY) return null
      if (!executeRecaptcha) return null
      return executeRecaptcha(action)
    },
    [executeRecaptcha],
  )
}

export function captchaHeader(token: string | null): Record<string, string> {
  return token ? { 'x-captcha-response': token } : {}
}
