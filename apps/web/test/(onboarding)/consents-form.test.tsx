// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mocks = vi.hoisted(() => ({
  mutateAsync: vi.fn(async () => ({ success: true })),
  push: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push }),
}))

vi.mock('@/trpc/client', () => ({
  trpc: {
    consent: {
      acceptRequired: {
        useMutation: () => ({
          mutateAsync: mocks.mutateAsync,
          isPending: false,
        }),
      },
    },
  },
}))

import { ConsentsOnboardingForm } from '@/app/onboarding/consents/consents-form'

describe('ConsentsOnboardingForm', () => {
  beforeEach(() => {
    mocks.mutateAsync.mockClear()
    mocks.push.mockClear()
  })

  afterEach(() => {
    cleanup()
  })

  it('rejects submit until required checkbox is checked', async () => {
    render(<ConsentsOnboardingForm />)
    await userEvent.click(screen.getByRole('button', { name: /принять и продолжить/i }))
    expect(mocks.mutateAsync).not.toHaveBeenCalled()
    expect(screen.getByText(/необходимо принять условия/i)).toBeInTheDocument()
  })

  it('submits with marketing=false by default and redirects to /profile', async () => {
    render(<ConsentsOnboardingForm />)
    await userEvent.click(screen.getByTestId('register-terms-checkbox'))
    await userEvent.click(screen.getByRole('button', { name: /принять и продолжить/i }))
    expect(mocks.mutateAsync).toHaveBeenCalledWith({ marketing: false })
    expect(mocks.push).toHaveBeenCalledWith('/profile')
  })

  it('submits with marketing=true when checkbox is ticked', async () => {
    render(<ConsentsOnboardingForm />)
    await userEvent.click(screen.getByTestId('register-terms-checkbox'))
    await userEvent.click(screen.getByTestId('register-marketing-checkbox'))
    await userEvent.click(screen.getByRole('button', { name: /принять и продолжить/i }))
    expect(mocks.mutateAsync).toHaveBeenCalledWith({ marketing: true })
  })
})
