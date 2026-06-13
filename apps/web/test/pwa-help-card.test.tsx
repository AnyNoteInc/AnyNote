// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PwaHelpCard } from '@/components/settings/pwa-help-card'
import { PwaInstallProvider } from '@/components/pwa/pwa-install-context'

describe('PwaHelpCard', () => {
  afterEach(cleanup)

  it('renders with the honest offline scope — no offline-editing promises', () => {
    render(<PwaHelpCard />)
    const card = screen.getByTestId('pwa-help-card')
    const text = card.textContent ?? ''

    expect(text).toContain('Приложение AnyNote')
    // The exact honest phrase per the spec.
    expect(text).toContain('офлайн-редактирование не поддерживается')
    expect(text).toContain('не поддерживается')
    // Never promise offline editing.
    expect(text).not.toMatch(/офлайн-редактирование\s+(доступно|поддерживается|работает)/i)
    expect(text).not.toMatch(/работает\s+офлайн/i)
  })

  it('hides the install button outside an install-capable context', () => {
    render(<PwaHelpCard />)
    expect(screen.queryByRole('button', { name: /Установить приложение/ })).not.toBeInTheDocument()
  })

  it('offers the install button when an install prompt was captured', () => {
    render(
      <PwaInstallProvider>
        <PwaHelpCard />
      </PwaInstallProvider>,
    )
    const event = new Event('beforeinstallprompt', { cancelable: true })
    Object.assign(event, {
      prompt: vi.fn(async () => {}),
      userChoice: Promise.resolve({ outcome: 'accepted', platform: 'web' }),
    })
    act(() => {
      window.dispatchEvent(event)
    })
    expect(screen.getByRole('button', { name: /Установить приложение/ })).toBeInTheDocument()
  })
})
