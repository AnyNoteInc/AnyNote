// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  executeRecaptcha: vi.fn(async (action: string) => `token-${action}`),
}))

vi.mock('react-google-recaptcha-v3', () => ({
  useGoogleReCaptcha: () => ({ executeRecaptcha: mocks.executeRecaptcha }),
}))

import { useRecaptchaV3 } from '@/lib/use-recaptcha-v3'

describe('useRecaptchaV3', () => {
  beforeEach(() => {
    mocks.executeRecaptcha.mockClear()
    vi.stubEnv('NEXT_PUBLIC_RECAPTCHA_SITE_KEY', '')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('executes reCAPTCHA when the provider has supplied an executor', async () => {
    const { result } = renderHook(() => useRecaptchaV3())

    await expect(result.current('sign_up')).resolves.toBe('token-sign_up')
    expect(mocks.executeRecaptcha).toHaveBeenCalledWith('sign_up')
  })
})
