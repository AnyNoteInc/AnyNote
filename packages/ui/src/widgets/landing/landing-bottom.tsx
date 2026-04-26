import { Box, Container, Divider, Stack, Typography, Button } from '@repo/ui/components'
import type { ReactNode } from 'react'

export type LandingBottomProps = {
  appTitle: string
  logo: ReactNode
}

const footerSections = [
  {
    title: 'Продукт',
    links: [
      { label: 'Характеристики', href: '#features' },
      { label: 'Цены', href: '#pricing' },
      { label: 'Часто задаваемые вопросы', href: '#faq' },
    ],
  },
  {
    title: 'Ресурсы',
    links: [
      { label: 'Блог', href: '#blog' },
      { label: 'Документация', href: '#docs' },
    ],
  },
  {
    title: 'О компании',
    links: [
      { label: 'О нас', href: '#about' },
      { label: 'Контакты', href: '#contact' },
    ],
  },
  {
    title: 'Юридическая информация',
    links: [
      { label: 'Политика в отношении файлов cookie', href: '#cookies' },
      { label: 'Политика конфиденциальности', href: '#privacy' },
      { label: 'Условия предоставления услуг', href: '#terms' },
      { label: 'Политика возврата средств', href: '#refunds' },
    ],
  },
]

export function LandingBottom({ appTitle, logo }: LandingBottomProps) {
  return (
    <Box
      component="footer"
      sx={{
        mt: 10,
        background:
          'radial-gradient(circle at 18% 16%, rgba(59, 130, 246, 0.2), transparent 28%), radial-gradient(circle at 82% 10%, rgba(16, 185, 129, 0.18), transparent 30%), linear-gradient(135deg, #0b1120 0%, #0f172a 70%, #0b1224 100%)',
        color: 'rgba(226, 232, 240, 0.92)',
        borderTop: '1px solid rgba(148, 163, 184, 0.18)',
      }}
    >
      <Container maxWidth="lg" sx={{ py: 5 }}>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: '1fr 1.4fr' },
            gap: { xs: 3, md: 6 },
            alignItems: 'flex-start',
            mb: 4,
          }}
        >
          <Stack spacing={3}>
            <Stack spacing={1}>
              <Stack direction="row" alignItems="center" spacing={1.5}>
                {logo}
                <Typography variant="h6" fontWeight={800} color="#e2e8f0">
                  {appTitle}
                </Typography>
              </Stack>
              <Typography variant="body1" color="rgba(226, 232, 240, 0.72)" maxWidth={520}>
                Лаконичный футер в темной теме: добавьте ссылки, поменяйте цвета и используйте в
                любом приложении.
              </Typography>
            </Stack>
          </Stack>

          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: {
                xs: 'repeat(2, minmax(0, 1fr))',
                sm: 'repeat(3, minmax(0, 1fr))',
                md: 'repeat(4, minmax(0, 1fr))',
              },
              gap: { xs: 2.5, md: 3 },
            }}
          >
            {footerSections.map((section) => (
              <Stack key={section.title} spacing={1.25}>
                <Typography variant="subtitle2" fontWeight={800}>
                  {section.title}
                </Typography>
                <Stack spacing={0.75}>
                  {section.links.map((link) => (
                    <Button
                      key={link.label}
                      component="a"
                      href={link.href}
                      variant="text"
                      color="inherit"
                      sx={{
                        justifyContent: 'flex-start',
                        textTransform: 'none',
                        '&:hover': {
                          color: '#e2e8f0',
                          backgroundColor: 'transparent',
                        },
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

        <Divider
          sx={{
            my: 3,
            borderColor: 'rgba(148, 163, 184, 0.2)',
          }}
        />

        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1}
          justifyContent="space-between"
          alignItems={{ xs: 'flex-start', sm: 'center' }}
        >
          <Typography variant="body2">
            © {new Date().getFullYear()} {appTitle} All Rights Reserved.
          </Typography>
          <Typography variant="body2">Создано с ❤️ людьми для людей</Typography>
        </Stack>
      </Container>
    </Box>
  )
}
