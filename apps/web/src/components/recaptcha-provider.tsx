'use client'

import type { ReactNode } from 'react'
import { GoogleReCaptchaContext, GoogleReCaptchaProvider } from 'react-google-recaptcha-v3'

export function RecaptchaProvider({
  children,
  siteKey,
  testMode = false,
}: {
  children: ReactNode
  siteKey?: string
  testMode?: boolean
}) {
  if (testMode) {
    return (
      <GoogleReCaptchaContext.Provider
        value={{ executeRecaptcha: async () => 'playwright-form-captcha' }}
      >
        {children}
      </GoogleReCaptchaContext.Provider>
    )
  }

  if (!siteKey) {
    return (
      <GoogleReCaptchaContext.Provider value={{ executeRecaptcha: undefined }}>
        {children}
      </GoogleReCaptchaContext.Provider>
    )
  }

  return (
    <GoogleReCaptchaProvider
      reCaptchaKey={siteKey}
      scriptProps={{ async: true, defer: true, appendTo: 'head' }}
    >
      {children}
    </GoogleReCaptchaProvider>
  )
}
