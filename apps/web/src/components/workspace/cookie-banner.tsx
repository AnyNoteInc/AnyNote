"use client"

import { useEffect, useState } from "react"

import { Box, Button, Stack, Typography } from "@repo/ui/components"

const STORAGE_KEY = "cookiesAccepted"

export function CookieBanner() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (typeof window === "undefined") return
    setVisible(window.localStorage.getItem(STORAGE_KEY) !== "true")
  }, [])

  const dismiss = (accept: boolean) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, accept ? "true" : "false")
    }
    setVisible(false)
  }

  if (!visible) return null
  return (
    <Box
      sx={{
        position: "fixed",
        bottom: 20,
        left: "50%",
        transform: "translateX(-50%)",
        display: "flex",
        alignItems: "center",
        gap: 1.75,
        backgroundColor: "#17191d",
        color: "#e7e8ea",
        border: "1px solid #2a2d33",
        borderRadius: 1.5,
        px: 1.75,
        py: 1.25,
        boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
        zIndex: 1000,
        fontSize: 12,
      }}
    >
      <Typography variant="caption">We use cookies to improve your experience.</Typography>
      <Stack direction="row" spacing={1}>
        <Button size="small" variant="text" color="inherit" onClick={() => dismiss(false)}>
          Settings
        </Button>
        <Button size="small" variant="text" color="inherit" onClick={() => dismiss(false)}>
          Reject
        </Button>
        <Button size="small" variant="contained" onClick={() => dismiss(true)}>
          Accept all
        </Button>
      </Stack>
    </Box>
  )
}
