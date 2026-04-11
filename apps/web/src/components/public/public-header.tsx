import Link from "next/link"

import { Box, Button, Stack, Typography } from "@repo/ui/components"
import { ChangeColorTheme } from "@repo/ui/widgets"

import { AppUserMenu } from "@/components/app/app-user-menu"
import { BrandMark } from "@/components/brand/brand-mark"
import type { SessionType } from "@/lib/get-session"

import { publicNavItems } from "./content"

type PublicHeaderProps = {
  session: SessionType
}

export function PublicHeader({ session }: PublicHeaderProps) {
  return (
    <Box
      sx={{
        py: 2.5,
        position: "sticky",
        top: 0,
        zIndex: 20,
        backdropFilter: "blur(14px)",
      }}
    >
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        spacing={2}
        sx={{ px: { xs: 3, md: 4, xl: 5 } }}
      >
        <Box
          component={Link}
          href="/"
          aria-label="На главную"
          sx={{
            display: "inline-flex",
            alignItems: "center",
            gap: 1.5,
            textDecoration: "none",
          }}
        >
          <BrandMark size={42} aria-label="AnyNote" />
          <Stack spacing={0}>
            <Typography variant="subtitle1" fontWeight={800}>
              AnyNote
            </Typography>
            <Typography variant="caption" color="text.secondary">
              knowledge system for serious teams
            </Typography>
          </Stack>
        </Box>

        <Stack
          direction="row"
          spacing={0.5}
          alignItems="center"
          sx={{ display: { xs: "none", lg: "flex" } }}
        >
          {publicNavItems.map((item) => (
            <Button
              key={item.href}
              href={item.href}
              variant="text"
              color="inherit"
              sx={{ textTransform: "none" }}
            >
              {item.label}
            </Button>
          ))}
        </Stack>

        <Stack direction="row" spacing={1.5} alignItems="center">
          <ChangeColorTheme />
          <AppUserMenu session={session} />
        </Stack>
      </Stack>
    </Box>
  )
}
