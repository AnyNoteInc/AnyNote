// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { InstallPromptBanner } from '@/components/pwa/install-prompt-banner'
import { PwaInstallProvider, usePwaInstall } from '@/components/pwa/pwa-install-context'
import { PWA_INSTALL_BANNER_DISMISS_KEY } from '@/lib/pwa'

// The jsdom bundled with this vitest setup exposes a method-less localStorage
// stub; install a real in-memory Storage so the banner's persistence is testable.
function installFakeLocalStorage() {
  const store = new Map<string, string>()
  const storage: Storage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, String(value)),
    removeItem: (key) => void store.delete(key),
    clear: () => store.clear(),
    key: (index) => [...store.keys()][index] ?? null,
    get length() {
      return store.size
    },
  }
  Object.defineProperty(window, 'localStorage', { value: storage, configurable: true })
  return storage
}

function createBeforeInstallPromptEvent(outcome: 'accepted' | 'dismissed' = 'accepted') {
  const event = new Event('beforeinstallprompt', { cancelable: true })
  const prompt = vi.fn(async () => {})
  Object.assign(event, {
    prompt,
    userChoice: Promise.resolve({ outcome, platform: 'web' }),
  })
  return { event, prompt }
}

function Probe() {
  const { canInstall, isInstalled, promptInstall } = usePwaInstall()
  return (
    <div>
      <span data-testid="can-install">{String(canInstall)}</span>
      <span data-testid="is-installed">{String(isInstalled)}</span>
      <button onClick={() => void promptInstall()}>prompt</button>
    </div>
  )
}

describe('PwaInstallProvider', () => {
  afterEach(cleanup)

  it('starts with no install available', () => {
    render(
      <PwaInstallProvider>
        <Probe />
      </PwaInstallProvider>,
    )
    expect(screen.getByTestId('can-install')).toHaveTextContent('false')
    expect(screen.getByTestId('is-installed')).toHaveTextContent('false')
  })

  it('captures beforeinstallprompt from window: prevents default and enables install', () => {
    render(
      <PwaInstallProvider>
        <Probe />
      </PwaInstallProvider>,
    )
    const { event } = createBeforeInstallPromptEvent()
    act(() => {
      window.dispatchEvent(event)
    })
    expect(event.defaultPrevented).toBe(true)
    expect(screen.getByTestId('can-install')).toHaveTextContent('true')
  })

  it('promptInstall shows the stashed prompt and consumes it on accept', async () => {
    const actor = userEvent.setup()
    render(
      <PwaInstallProvider>
        <Probe />
      </PwaInstallProvider>,
    )
    const { event, prompt } = createBeforeInstallPromptEvent('accepted')
    act(() => {
      window.dispatchEvent(event)
    })
    await actor.click(screen.getByRole('button', { name: 'prompt' }))
    expect(prompt).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('can-install')).toHaveTextContent('false')
  })

  it('appinstalled flips isInstalled and clears canInstall', () => {
    render(
      <PwaInstallProvider>
        <Probe />
      </PwaInstallProvider>,
    )
    act(() => {
      window.dispatchEvent(createBeforeInstallPromptEvent().event)
    })
    expect(screen.getByTestId('can-install')).toHaveTextContent('true')
    act(() => {
      window.dispatchEvent(new Event('appinstalled'))
    })
    expect(screen.getByTestId('is-installed')).toHaveTextContent('true')
    expect(screen.getByTestId('can-install')).toHaveTextContent('false')
  })
})

describe('InstallPromptBanner', () => {
  beforeEach(() => {
    installFakeLocalStorage()
  })
  afterEach(cleanup)

  const renderBanner = () =>
    render(
      <PwaInstallProvider>
        <InstallPromptBanner />
      </PwaInstallProvider>,
    )

  it('stays hidden without a captured install prompt', () => {
    renderBanner()
    expect(screen.queryByTestId('pwa-install-banner')).not.toBeInTheDocument()
  })

  it('appears under a synthetic beforeinstallprompt and dismisses one-time via localStorage', async () => {
    const actor = userEvent.setup()
    renderBanner()
    act(() => {
      window.dispatchEvent(createBeforeInstallPromptEvent().event)
    })
    expect(screen.getByTestId('pwa-install-banner')).toBeInTheDocument()

    await actor.click(screen.getByRole('button', { name: 'Не сейчас' }))
    expect(screen.queryByTestId('pwa-install-banner')).not.toBeInTheDocument()
    expect(window.localStorage.getItem(PWA_INSTALL_BANNER_DISMISS_KEY)).toBe('1')

    // A later mount with a fresh prompt stays hidden — the dismissal is persistent.
    cleanup()
    renderBanner()
    act(() => {
      window.dispatchEvent(createBeforeInstallPromptEvent().event)
    })
    expect(screen.queryByTestId('pwa-install-banner')).not.toBeInTheDocument()
  })

  it('runs the native prompt from the install button', async () => {
    const actor = userEvent.setup()
    renderBanner()
    const { event, prompt } = createBeforeInstallPromptEvent('accepted')
    act(() => {
      window.dispatchEvent(event)
    })
    await actor.click(screen.getByRole('button', { name: 'Установить' }))
    expect(prompt).toHaveBeenCalledTimes(1)
  })
})
