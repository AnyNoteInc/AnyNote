import { Box, Button, Container, Divider, Paper, Stack, Typography } from '@repo/ui/components'

import { BrandMark } from '@/components/brand/brand-mark'

import { publicFooterSections } from './content'

export function PublicFooter() {
  return (
    <Box component="footer" sx={{ mt: { xs: 8, md: 12 } }}>
      <Container maxWidth="xl">
        <Divider
          sx={{
            borderColor: 'rgba(148, 163, 184, 0.22)',
            mb: { xs: 3, md: 4 },
          }}
        />

        <Paper
          elevation={0}
          sx={{
            px: { xs: 3, md: 4 },
            py: { xs: 3.5, md: 4.5 },
            borderRadius: 2,
            border: '1px solid rgba(148,163,184,0.14)',
            background: 'linear-gradient(180deg, rgba(16,28,33,0.94) 0%, rgba(12,22,27,0.98) 100%)',
            color: 'rgba(241,245,249,0.96)',
            boxShadow: '0 20px 60px rgba(3, 10, 14, 0.18)',
          }}
        >
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', lg: '340px minmax(0, 1fr)' },
              gap: { xs: 3, md: 4 },
            }}
          >
            <Stack spacing={2}>
              <Stack direction="row" spacing={1.5} alignItems="center">
                <BrandMark size={40} aria-label="AnyNote" />
                <Stack spacing={0}>
                  <Typography variant="h6" fontWeight={800}>
                    AnyNote
                  </Typography>
                  <Typography variant="body2" color="rgba(226,232,240,0.72)">
                    База знаний, документы и AI-поиск в одном продукте.
                  </Typography>
                </Stack>
              </Stack>
              <Typography variant="body2" color="rgba(226,232,240,0.72)">
                Публичные страницы собраны на Next.js 16, MUI и общей дизайн-системе
                монорепозитория.
              </Typography>
            </Stack>

            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: {
                  xs: '1fr',
                  sm: 'repeat(2, minmax(0, 1fr))',
                  lg: 'repeat(3, minmax(0, 1fr))',
                },
                gap: 3,
              }}
            >
              {publicFooterSections.map((section) => (
                <Stack key={section.title} spacing={1}>
                  <Typography variant="subtitle2" fontWeight={800}>
                    {section.title}
                  </Typography>
                  <Stack spacing={0.4}>
                    {section.links.map((link) => (
                      <Button
                        key={link.href}
                        href={link.href}
                        variant="text"
                        color="inherit"
                        sx={{
                          justifyContent: 'flex-start',
                          px: 0,
                          textTransform: 'none',
                          color: 'rgba(241,245,249,0.88)',
                        }}
                      >
                        {link.label}
                      </Button>
                    ))}
                  </Stack>
                </Stack>
              ))}
            </Box>
          </Box>

          <Divider sx={{ my: 3, borderColor: 'rgba(148, 163, 184, 0.18)' }} />

          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={1}
            justifyContent="space-between"
            alignItems={{ xs: 'flex-start', sm: 'center' }}
          >
            <Typography variant="body2" color="rgba(226,232,240,0.68)">
              © {new Date().getFullYear()} AnyNote. Все права защищены.
            </Typography>
            <Typography variant="body2" color="rgba(226,232,240,0.68)">
              Рабочее пространство команды для документов, заметок и поиска.
            </Typography>
          </Stack>
        </Paper>
      </Container>
    </Box>
  )
}
