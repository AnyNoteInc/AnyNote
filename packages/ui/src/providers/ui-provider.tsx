'use client'

import { CssBaseline, GlobalStyles } from '@mui/material'
import type { PaletteMode } from '@mui/material'
import { ThemeProvider } from '@mui/material/styles'
import { AppRouterCacheProvider } from '@mui/material-nextjs/v15-appRouter'
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react'

import { createAppTheme } from '@repo/ui/theme'

type Preference = PaletteMode | 'system'

type ThemeModeContextValue = {
  mode: PaletteMode
  preference: Preference
  setPreference: (p: Preference) => void
  toggleMode: () => void
}

const ThemeModeContext = createContext<ThemeModeContextValue | null>(null)

export function useThemeMode() {
  const value = useContext(ThemeModeContext)
  if (!value) throw new Error('useThemeMode must be used within UiProvider')
  return value
}

export type UiProviderProps = PropsWithChildren<{ initial?: Preference }>

function resolveMode(preference: Preference, prefersDark: boolean): PaletteMode {
  if (preference === 'light' || preference === 'dark') return preference
  return prefersDark ? 'dark' : 'light'
}

export function UiProvider({ children, initial = 'system' }: UiProviderProps) {
  const [preference, setPreferenceState] = useState<Preference>(initial)
  const [prefersDark, setPrefersDark] = useState<boolean>(false)

  useEffect(() => {
    const stored = window.localStorage.getItem('app-theme-mode') as Preference | null
    if (stored === 'light' || stored === 'dark' || stored === 'system') {
      setPreferenceState(stored)
    }
  }, [])

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    setPrefersDark(mq.matches)
    const handler = (e: MediaQueryListEvent) => setPrefersDark(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  useEffect(() => {
    window.localStorage.setItem('app-theme-mode', preference)
  }, [preference])

  const mode = resolveMode(preference, prefersDark)
  const theme = useMemo(() => createAppTheme(mode), [mode])

  const setPreference = (p: Preference) => setPreferenceState(p)
  const toggleMode = () => setPreferenceState(mode === 'light' ? 'dark' : 'light')

  return (
    <AppRouterCacheProvider options={{ key: 'css', enableCssLayer: true }}>
      <ThemeModeContext.Provider value={{ mode, preference, setPreference, toggleMode }}>
        <ThemeProvider theme={theme}>
          <CssBaseline />
          <GlobalStyles
            styles={{
              body: { backgroundColor: theme.palette.background.default },
            }}
          />
          {children}
        </ThemeProvider>
      </ThemeModeContext.Provider>
    </AppRouterCacheProvider>
  )
}
