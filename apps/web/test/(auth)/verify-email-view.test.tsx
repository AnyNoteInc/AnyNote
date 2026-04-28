// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen, act } from '@testing-library/react'

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}))

import { VerifyEmailView } from '@/app/(auth)/verify-email/verify-email-view'

describe('VerifyEmailView', () => {
  beforeEach(() => {
    mocks.push.mockClear()
    mocks.refresh.mockClear()
    vi.useFakeTimers()
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('on status=success, redirects to /app after 2s', () => {
    render(<VerifyEmailView status="success" />)
    expect(screen.getByText(/email подтверждён/i)).toBeTruthy()

    act(() => {
      vi.advanceTimersByTime(2000)
    })

    expect(mocks.push).toHaveBeenCalledWith('/app')
  })

  it('on status=error, shows error Alert', () => {
    render(<VerifyEmailView status="error" />)
    expect(screen.getByText(/ссылка недействительна/i)).toBeTruthy()
  })
})
