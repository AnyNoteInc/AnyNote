import type { ReactNode } from "react"
import Link from "next/link"
import { redirect } from "next/navigation"

import { Divider, Container, Paper, Stack, Typography } from "@repo/ui/components"

import { getSession } from "@/lib/get-session"

export default async function AuthLayout({ children }: { children: ReactNode }) {
  const session = await getSession()
  if (session) {
    redirect("/app")
  }

  return (
    <Container
      component="main"
      maxWidth="sm"
      sx={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        py: { xs: 6, md: 10 },
      }}
    >
      <Paper
        elevation={0}
        sx={{
          width: "100%",
          p: { xs: 3, md: 4 },
          borderRadius: 2,
          border: "1px solid",
          borderColor: "divider",
          boxShadow: "0 25px 80px rgba(15, 23, 42, 0.08)",
          backgroundColor: "background.paper",
        }}
      >
        <Stack spacing={3}>
          {children}
          <Divider />
          <Link href="/sign-in" style={{ textDecoration: "none" }}>
            <Typography variant="body2" color="text.secondary" textAlign="center">
              Вернуться ко входу
            </Typography>
          </Link>
        </Stack>
      </Paper>
    </Container>
  )
}
