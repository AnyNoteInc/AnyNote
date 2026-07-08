import { Paper, Container, Stack, Typography, Button } from '@repo/ui/components'

export function LandingInfo() {
  return (
    <Container maxWidth="sm" sx={{ py: 10 }}>
      <Paper
        elevation={0}
        sx={{
          p: 4,
          display: 'flex',
          flexDirection: 'column',
          gap: 3,
          textAlign: 'center',
        }}
      >
        <Stack spacing={1}>
          <Typography variant="h3" sx={{ fontWeight: 700 }}>
            Welcome to your UI Kit
          </Typography>
          <Typography color="text.secondary">
            Components are powered by MUI and already wired for Next.js 16 SSR. Start building great
            product experiences with consistent tokens and theming.
          </Typography>
        </Stack>
        <Stack direction="row" spacing={2} sx={{ justifyContent: 'center' }}>
          <Button color="primary" size="large">
            Primary action
          </Button>
          <Button color="secondary" size="large" variant="outlined">
            Secondary
          </Button>
        </Stack>
      </Paper>
    </Container>
  )
}
