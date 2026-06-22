// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mocks = vi.hoisted(() => ({
  signInEmail: vi.fn(async () => ({ error: null })),
  signInSocial: vi.fn(async () => ({})),
  push: vi.fn(),
  refresh: vi.fn(),
}))

vi.mock('@/lib/auth-client', () => ({
  signIn: { email: mocks.signInEmail, social: mocks.signInSocial },
}))
vi.mock('@/lib/use-recaptcha-v3', () => ({
  useRecaptchaV3: () => async () => 'tok-1',
  captchaHeader: (token: string | null) => (token ? { 'x-captcha-response': token } : {}),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}))

import { SignInForm } from '@/app/(auth)/sign-in/sign-in-form'

describe('SignInForm', () => {
  beforeEach(() => {
    mocks.signInEmail.mockClear()
    mocks.signInSocial.mockClear()
    mocks.push.mockClear()
    mocks.refresh.mockClear()
  })

  afterEach(() => {
    cleanup()
  })

  it('submit calls signIn.email with captcha header', async () => {
    render(<SignInForm />)
    await userEvent.type(screen.getByLabelText(/email/i), 'a@b.com')
    await userEvent.type(screen.getByLabelText(/^пароль$/i), 'pwd12345')
    await userEvent.click(screen.getByRole('button', { name: /^войти$/i }))

    expect(mocks.signInEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'a@b.com',
        password: 'pwd12345',
        fetchOptions: { headers: { 'x-captcha-response': 'tok-1' } },
      }),
    )
  })

  it('does not render the Google sign-in button', () => {
    render(<SignInForm />)
    expect(
      screen.queryByRole('button', { name: /войти через google/i }),
    ).not.toBeInTheDocument()
  })
})
