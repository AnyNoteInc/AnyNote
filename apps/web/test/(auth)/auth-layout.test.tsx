import React, { isValidElement } from 'react'
import { describe, expect, it, vi, afterEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(async () => null),
}))

vi.mock('@/lib/get-session', () => ({
  getSession: mocks.getSession,
}))

import AuthLayout from '@/app/(auth)/layout'
import { RecaptchaProvider } from '@/components/recaptcha-provider'

describe('AuthLayout', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    mocks.getSession.mockClear()
  })

  it('passes the runtime reCAPTCHA site key to the provider', async () => {
    vi.stubEnv('NEXT_PUBLIC_RECAPTCHA_SITE_KEY', 'runtime-site-key')

    const element = await AuthLayout({ children: <div /> })

    expect(isValidElement(element)).toBe(true)
    expect(element.type).toBe(RecaptchaProvider)
    expect(element.props.siteKey).toBe('runtime-site-key')
  })
})
