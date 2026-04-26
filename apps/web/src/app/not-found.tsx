import Link from 'next/link'

import { Box, Button, Container, Paper, Stack, Typography } from '@repo/ui/components'

export default function NotFound() {
  return (
    <Box
      component="main"
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
      }}
    >
      <Container maxWidth="sm">
        <Paper
          elevation={0}
          sx={{
            p: { xs: 3, md: 4 },
            borderRadius: 2,
            border: '1px solid',
            borderColor: 'divider',
            boxShadow: '0 18px 55px rgba(15, 23, 42, 0.08)',
            textAlign: 'center',
            backgroundColor: 'background.paper',
          }}
        >
          <Stack spacing={2.5} alignItems="center">
            <Typography variant="overline" color="text.secondary">
              404
            </Typography>
            <Typography variant="h4" fontWeight={700}>
              Страница не найдена
            </Typography>
            <Typography color="text.secondary" maxWidth={440}>
              Похоже, вы свернули не туда. Проверьте адрес или вернитесь на главную — приложение
              продолжит работу с любого раздела.
            </Typography>
            <Link href="/" style={{ textDecoration: 'none' }}>
              <Button variant="contained" size="large">
                Вернуться на главную
              </Button>
            </Link>
          </Stack>
        </Paper>
      </Container>
    </Box>
  )
}
