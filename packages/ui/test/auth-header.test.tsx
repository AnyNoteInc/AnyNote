import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { AuthHeader } from '../src/widgets/auth/auth-header'

describe('AuthHeader', () => {
  afterEach(() => {
    cleanup()
  })

  it('links the brand diamond to the home page', () => {
    render(<AuthHeader title="Вход" />)

    expect(screen.getByRole('link', { name: 'На главную' }).getAttribute('href')).toBe('/')
  })
})
