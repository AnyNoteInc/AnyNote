// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mocks = vi.hoisted(() => ({
  signUpEmail: vi.fn(async () => ({ error: null })),
  routerPush: vi.fn(),
}))

vi.mock('@/lib/auth-client', () => ({
  signUp: { email: mocks.signUpEmail },
}))
vi.mock('@/lib/use-recaptcha-v3', () => ({
  useRecaptchaV3: () => async () => 'tok-up',
  captchaHeader: (token: string | null) => (token ? { 'x-captcha-response': token } : {}),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.routerPush }),
}))

import { SignUpForm } from '@/app/(auth)/sign-up/sign-up-form'

describe('SignUpForm', () => {
  beforeEach(() => {
    mocks.signUpEmail.mockClear()
    mocks.routerPush.mockClear()
  })

  afterEach(() => {
    cleanup()
  })

  it('shows success Alert after submit', async () => {
    render(<SignUpForm />)
    await userEvent.type(screen.getByLabelText(/email/i), 'a@b.com')
    await userEvent.type(screen.getByLabelText(/фамилия/i), 'Ivanov')
    await userEvent.type(screen.getByLabelText(/имя/i), 'Ivan')
    await userEvent.type(screen.getByLabelText(/^пароль$/i), 'pwd12345')
    await userEvent.type(screen.getByLabelText(/повторите пароль/i), 'pwd12345')
    await userEvent.click(screen.getByTestId('register-terms-checkbox'))
    await userEvent.click(screen.getByRole('button', { name: /зарегистрироваться/i }))

    expect(mocks.signUpEmail).toHaveBeenCalled()
    expect(await screen.findByText(/письмо с подтверждением/i)).toBeTruthy()
  })

  it('schedules a /profile redirect after successful sign-up', async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
    try {
      render(<SignUpForm />)
      await userEvent.type(screen.getByLabelText(/email/i), 'a@b.com')
      await userEvent.type(screen.getByLabelText(/фамилия/i), 'Ivanov')
      await userEvent.type(screen.getByLabelText(/имя/i), 'Ivan')
      await userEvent.type(screen.getByLabelText(/^пароль$/i), 'pwd12345')
      await userEvent.type(screen.getByLabelText(/повторите пароль/i), 'pwd12345')
      await userEvent.click(screen.getByTestId('register-terms-checkbox'))
      await userEvent.click(screen.getByRole('button', { name: /зарегистрироваться/i }))

      await screen.findByText(/письмо с подтверждением/i)

      const redirectCall = setTimeoutSpy.mock.calls.find(([, delay]) => delay === 3000)
      expect(redirectCall).toBeDefined()
      const cb = redirectCall![0] as () => void
      cb()
      expect(mocks.routerPush).toHaveBeenCalledWith('/profile')
    } finally {
      setTimeoutSpy.mockRestore()
    }
  })
})
