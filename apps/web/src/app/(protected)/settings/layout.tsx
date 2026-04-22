import type { ReactNode } from "react"
import Link from "next/link"

import { Avatar, Box, Container, Paper, Stack, Typography } from "@repo/ui/components"

import { SettingsNav } from "@/components/settings/settings-nav"
import { getSession } from "@/lib/get-session"

export default async function SettingsLayout({ children }: { children: ReactNode }) {
  const session = await getSession()
  const user = session!.user

  return (
    <Container maxWidth="lg" sx={{ py: { xs: 3, md: 5 } }}>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", md: "260px minmax(0, 1fr)" },
          gap: { xs: 3, md: 4 },
        }}
      >
        <Paper
          elevation={0}
          sx={{
            p: 2,
            borderRadius: 2,
            border: "1px solid",
            borderColor: "divider",
            alignSelf: "start",
            position: { md: "sticky" },
            top: { md: 24 },
          }}
        >
          <Stack spacing={2}>
            <Link
              href="/app"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                color: "var(--mui-palette-text-secondary, rgba(0, 0, 0, 0.6))",
                fontSize: 13,
                textDecoration: "none",
              }}
            >
              <span>←</span>
              <span>Вернуться в workspace</span>
            </Link>
            <Stack
              direction="row"
              spacing={1.25}
              alignItems="center"
              sx={{ pb: 2, borderBottom: "1px solid", borderColor: "divider" }}
            >
              <Avatar
                src={user.image ?? undefined}
                sx={{
                  width: 34,
                  height: 34,
                  fontSize: 14,
                  background: "linear-gradient(135deg,#0f766e,#155e75)",
                }}
              >
                {`${user.firstName.charAt(0)}${user.lastName.charAt(0)}`.toUpperCase()}
              </Avatar>
              <Stack spacing={0}>
                <Typography variant="body2" fontWeight={600}>
                  {user.firstName} {user.lastName}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {user.email}
                </Typography>
              </Stack>
            </Stack>
            <Stack spacing={0.5}>
              <Typography variant="overline" color="text.secondary">
                Настройки
              </Typography>
              <SettingsNav />
            </Stack>
          </Stack>
        </Paper>
        <Box>{children}</Box>
      </Box>
    </Container>
  )
}
