"use client"

import type { ReactNode } from "react"
import { AppBar, Toolbar } from "@repo/ui/components"
import { Box, Button, Container, Stack, Typography } from "@repo/ui/components"
import { ChangeColorTheme } from "@repo/ui/widgets"

export type LandingToolBoxProps = {
  control: ReactNode
  brand?: string
  logo?: ReactNode
  onNavigate?: (path: string) => void
}

const navItems = [
  { label: "Функциональность", path: "#features" },
  { label: "Цены", path: "#pricing" },
  { label: "Блог", path: "#blog" },
]

export function LandingToolBox({
  control,
  brand = "Application",
  logo,
  onNavigate,
}: LandingToolBoxProps) {
  const handleNav = (path: string) => {
    if (onNavigate) {
      onNavigate(path)
    } else if (path.startsWith("#")) {
      const el = document.querySelector(path)
      el?.scrollIntoView({ behavior: "smooth", block: "start" })
    }
  }

  return (
    <AppBar
      position="static"
      color="transparent"
      elevation={0}
      sx={{
        borderBottom: "1px solid",
        borderColor: "divider",
        backdropFilter: "blur(6px)",
      }}
    >
      <Container maxWidth="lg">
        <Toolbar disableGutters sx={{ minHeight: 80 }}>
          <Stack direction="row" alignItems="center" spacing={1.5} sx={{ flexShrink: 0 }}>
            {logo ?? (
              <Box
                sx={{
                  width: 36,
                  height: 36,
                  borderRadius: 2,
                  background: "linear-gradient(135deg, #6366f1 0%, #22c55e 100%)",
                }}
              />
            )}
            <Typography variant="h6" fontWeight={800}>
              {brand}
            </Typography>
          </Stack>

          <Stack
            direction="row"
            spacing={2.5}
            sx={{ mx: { xs: 3, md: 6 }, display: { xs: "none", md: "flex" } }}
          >
            {navItems.map((item) => (
              <Button
                key={item.path}
                onClick={() => handleNav(item.path)}
                color="inherit"
                variant="text"
              >
                {item.label}
              </Button>
            ))}
          </Stack>
          <Stack direction="row" spacing={1.5} sx={{ marginLeft: "auto", flexShrink: 0 }}>
            <ChangeColorTheme />
            {control}
          </Stack>
        </Toolbar>
      </Container>
    </AppBar>
  )
}
