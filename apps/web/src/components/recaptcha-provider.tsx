'use client'

import type { ReactNode } from 'react'
import { GoogleReCaptchaContext, GoogleReCaptchaProvider } from 'react-google-recaptcha-v3'

export function RecaptchaProvider({
  children,
  siteKey,
}: {
  children: ReactNode
  siteKey?: string
}) {
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
