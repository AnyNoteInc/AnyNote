"use client"

import { CssBaseline, GlobalStyles } from "@mui/material"
import type { PaletteMode } from "@mui/material"
import { ThemeProvider } from "@mui/material/styles"
import { AppRouterCacheProvider } from "@mui/material-nextjs/v15-appRouter"
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react"

import { createAppTheme } from "@repo/ui/theme"

type ThemeModeContextValue = {
  mode: PaletteMode
  toggleMode: () => void
  setMode: (mode: PaletteMode) => void
}

const ThemeModeContext = createContext<ThemeModeContextValue | null>(null)

export function useThemeMode() {
  const value = useContext(ThemeModeContext)
  if (!value) {
    throw new Error("useThemeMode must be used within UiProvider")
  }
  return value
}

export type UiProviderProps = PropsWithChildren<{ mode?: PaletteMode }>

export function UiProvider({ children, mode: initialMode = "light" }: UiProviderProps) {
  const [mode, setMode] = useState<PaletteMode>(initialMode)

  useEffect(() => {
    const stored = window.localStorage.getItem("app-theme-mode") as PaletteMode | null
    if (stored === "light" || stored === "dark") {
      setMode(stored)
      return
    }
    if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
      setMode("dark")
    }
  }, [])

  useEffect(() => {
    window.localStorage.setItem("app-theme-mode", mode)
  }, [mode])

  const toggleMode = () => setMode((prev) => (prev === "light" ? "dark" : "light"))

  const theme = useMemo(() => createAppTheme(mode), [mode])

  const value = {
    mode,
    toggleMode,
    setMode,
  }

  return (
    <AppRouterCacheProvider options={{ key: "css", enableCssLayer: true }}>
      <ThemeModeContext.Provider value={value}>
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
