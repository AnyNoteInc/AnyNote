// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mocks = vi.hoisted(() => ({
  resetPassword: vi.fn(async () => ({ error: null })),
  push: vi.fn(),
  refresh: vi.fn(),
}))

vi.mock('@/lib/auth-client', () => ({
  authClient: { resetPassword: mocks.resetPassword },
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}))

import { ResetConfirmForm } from '@/app/(auth)/reset-credentials/[token]/reset-confirm-form'

describe('ResetConfirmForm', () => {
  beforeEach(() => {
    mocks.resetPassword.mockClear()
    mocks.push.mockClear()
    mocks.refresh.mockClear()
  })

  afterEach(() => {
    cleanup()
  })

  it('redirects to /sign-in on success', async () => {
    render(<ResetConfirmForm token="T0K" />)
    await userEvent.type(screen.getByLabelText(/^пароль$/i), 'newpass123')
    await userEvent.type(screen.getByLabelText(/повторите пароль/i), 'newpass123')
    await userEvent.click(screen.getByRole('button', { name: /сохранить/i }))

    expect(mocks.resetPassword).toHaveBeenCalledWith({ newPassword: 'newpass123', token: 'T0K' })
    expect(mocks.push).toHaveBeenCalledWith('/sign-in')
  })

  it('does not call API on password mismatch', async () => {
    render(<ResetConfirmForm token="T0K" />)
    await userEvent.type(screen.getByLabelText(/^пароль$/i), 'aaaaaaaa')
    await userEvent.type(screen.getByLabelText(/повторите пароль/i), 'bbbbbbbb')
    await userEvent.click(screen.getByRole('button', { name: /сохранить/i }))

    expect(mocks.resetPassword).not.toHaveBeenCalled()
    expect(await screen.findByText(/не совпадают/i)).toBeTruthy()
  })
})
