// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  updateProfile: vi.fn(),
  resendVerification: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))

vi.mock('@/trpc/client', () => ({
  trpc: {
    user: {
      updateProfile: {
        useMutation: () => ({
          isPending: false,
          mutate: mocks.updateProfile,
        }),
      },
      resendVerificationEmail: {
        useMutation: () => ({
          isPending: false,
          mutate: mocks.resendVerification,
        }),
      },
    },
  },
}))

import { ProfileSection } from '@/components/settings/profile-section'

describe('ProfileSection', () => {
  afterEach(() => {
    cleanup()
    mocks.updateProfile.mockClear()
    mocks.resendVerification.mockClear()
  })

  it('shows email as account information without edit controls', () => {
    render(
      <ProfileSection
        initial={{
          firstName: 'Ivan',
          lastName: 'Petrov',
          email: 'ivan@example.com',
          emailVerified: true,
          image: null,
        }}
      />,
    )

    expect(screen.getByText('ivan@example.com')).toBeInTheDocument()
    expect(screen.queryByDisplayValue('ivan@example.com')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /изменить/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/смена email/i)).not.toBeInTheDocument()
  })

  it('renders the verification badge as a button when email is unverified and triggers resend on click', () => {
    render(
      <ProfileSection
        initial={{
          firstName: 'Ivan',
          lastName: 'Petrov',
          email: 'ivan@example.com',
          emailVerified: false,
          image: null,
        }}
      />,
    )

    const button = screen.getByRole('button', { name: /отправить письмо подтверждения/i })
    expect(button).toBeInTheDocument()
    button.click()
    expect(mocks.resendVerification).toHaveBeenCalledTimes(1)
  })

  it('does not render a verification button when email is already verified', () => {
    render(
      <ProfileSection
        initial={{
          firstName: 'Ivan',
          lastName: 'Petrov',
          email: 'ivan@example.com',
          emailVerified: true,
          image: null,
        }}
      />,
    )

    expect(
      screen.queryByRole('button', { name: /отправить письмо подтверждения/i }),
    ).not.toBeInTheDocument()
    expect(screen.getByText(/подтверждён/i)).toBeInTheDocument()
  })
})
