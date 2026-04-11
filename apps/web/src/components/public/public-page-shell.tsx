import { Box, Container, Paper, Stack, Typography } from "@repo/ui/components"
import type { ReactNode } from "react"

type PublicPageShellProps = {
  eyebrow: string
  title: string
  description: string
  children: ReactNode
}

export function PublicPageShell({ eyebrow, title, description, children }: PublicPageShellProps) {
  return (
    <Container maxWidth="xl" sx={{ position: "relative", pb: { xs: 8, md: 12 } }}>
      <Stack spacing={2.5} sx={{ pt: { xs: 4, md: 6 }, maxWidth: 920 }}>
        <Typography variant="overline" color="text.secondary">
          {eyebrow}
        </Typography>
        <Typography
          variant="h1"
          sx={{ maxWidth: 980, fontSize: { xs: "2.8rem", sm: "4rem", md: "5rem" } }}
        >
          {title}
        </Typography>
        <Typography
          variant="h6"
          color="text.secondary"
          sx={{ maxWidth: 760, lineHeight: 1.6, fontSize: { xs: "1rem", md: "1.08rem" } }}
        >
          {description}
        </Typography>
      </Stack>

      <Paper
        elevation={0}
        sx={{
          mt: 4,
          p: { xs: 3, md: 4 },
          borderRadius: 2,
          border: "1px solid rgba(148,163,184,0.16)",
          backgroundColor: "background.paper",
        }}
      >
        <Box>{children}</Box>
      </Paper>
    </Container>
  )
}
