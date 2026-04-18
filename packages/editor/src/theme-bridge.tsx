"use client"

import { useEffect } from "react"

import { GlobalStyles, useTheme } from "@mui/material"

export function EditorThemeBridge() {
  const theme = useTheme()

  useEffect(() => {
    document.documentElement.setAttribute("data-mui-color-scheme", theme.palette.mode)
  }, [theme.palette.mode])

  return (
    <GlobalStyles
      styles={{
        ":root": {
          "--editor-text": theme.palette.text.primary,
          "--editor-text-muted": theme.palette.text.secondary,
          "--editor-divider": theme.palette.divider,
          "--editor-code-bg": theme.palette.action.hover,
          "--editor-font-family": theme.typography.fontFamily ?? "inherit",
        },
      }}
    />
  )
}
