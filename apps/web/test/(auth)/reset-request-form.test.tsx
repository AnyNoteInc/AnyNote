// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mocks = vi.hoisted(() => ({
  requestPasswordReset: vi.fn(async () => ({ error: null })),
}))

vi.mock('@/lib/auth-client', () => ({
  authClient: { requestPasswordReset: mocks.requestPasswordReset },
}))
vi.mock('@/lib/use-recaptcha-v3', () => ({
  useRecaptchaV3: () => async () => 'tok-r',
  captchaHeader: (token: string | null) => (token ? { 'x-captcha-response': token } : {}),
}))

import { ResetRequestForm } from '@/app/(auth)/reset-credentials/reset-request-form'

describe('ResetRequestForm', () => {
  beforeEach(() => {
    mocks.requestPasswordReset.mockClear()
  })

  afterEach(() => {
    cleanup()
  })

  it('submit calls authClient.requestPasswordReset with captcha header', async () => {
    render(<ResetRequestForm />)
    await userEvent.type(screen.getByLabelText(/email/i), 'a@b.com')
    await userEvent.click(screen.getByRole('button', { name: /подтвердить/i }))

    expect(mocks.requestPasswordReset).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'a@b.com',
        fetchOptions: { headers: { 'x-captcha-response': 'tok-r' } },
      }),
    )
    expect(await screen.findByText(/инструкцию для восстановления/i)).toBeTruthy()
  })
})
