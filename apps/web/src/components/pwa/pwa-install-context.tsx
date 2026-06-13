'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

/** Chromium-only event; not in lib.dom — typed structurally. */
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

export type PwaInstallContextValue = {
  /** A deferred install prompt is available and the app is not installed. */
  canInstall: boolean
  /** Running in standalone display mode (or `appinstalled` fired). */
  isInstalled: boolean
  /** Shows the native install prompt; resolves true when the user accepts. */
  promptInstall: () => Promise<boolean>
}

const defaultValue: PwaInstallContextValue = {
  canInstall: false,
  isInstalled: false,
  promptInstall: async () => false,
}

const PwaInstallContext = createContext<PwaInstallContextValue>(defaultValue)

export function usePwaInstall(): PwaInstallContextValue {
  return useContext(PwaInstallContext)
}

export function PwaInstallProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [isInstalled, setIsInstalled] = useState(false)

  useEffect(() => {
    const onBeforeInstallPrompt = (event: Event) => {
      // Suppress the browser mini-infobar; stash the event for our surfaces.
      event.preventDefault()
      setDeferredPrompt(event as BeforeInstallPromptEvent)
    }
    const onAppInstalled = () => {
      setIsInstalled(true)
      setDeferredPrompt(null)
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
    window.addEventListener('appinstalled', onAppInstalled)

    // `matchMedia` is missing in jsdom — guard so tests and odd embedders work.
    let media: MediaQueryList | null = null
    const onDisplayModeChange = (event: MediaQueryListEvent) => setIsInstalled(event.matches)
    if (typeof window.matchMedia === 'function') {
      media = window.matchMedia('(display-mode: standalone)')
      if (media.matches) setIsInstalled(true)
      media.addEventListener('change', onDisplayModeChange)
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
      window.removeEventListener('appinstalled', onAppInstalled)
      media?.removeEventListener('change', onDisplayModeChange)
    }
  }, [])

  const promptInstall = useCallback(async () => {
    if (!deferredPrompt) return false
    try {
      await deferredPrompt.prompt()
      const choice = await deferredPrompt.userChoice
      return choice.outcome === 'accepted'
    } catch {
      // A re-prompt on an already-consumed event throws; treat as declined.
      return false
    } finally {
      // `beforeinstallprompt` is single-use: clear it regardless of outcome so
      // a dismissed prompt also retires `canInstall` and we never re-prompt
      // an exhausted event.
      setDeferredPrompt(null)
    }
  }, [deferredPrompt])

  const value = useMemo<PwaInstallContextValue>(
    () => ({
      canInstall: deferredPrompt !== null && !isInstalled,
      isInstalled,
      promptInstall,
    }),
    [deferredPrompt, isInstalled, promptInstall],
  )

  return <PwaInstallContext.Provider value={value}>{children}</PwaInstallContext.Provider>
}
