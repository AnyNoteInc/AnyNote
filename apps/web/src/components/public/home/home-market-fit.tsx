import { Box, Container, Stack, Typography } from '@repo/ui/components'
import { eyebrowSx, sectionTitleSx, homeTokens } from './home-tokens'

const t = homeTokens.palette

const rows = [
  {
    value: '10 секунд',
    title: 'Понятно, что делает продукт',
    body: 'Главная сразу показывает рабочее пространство, ИИ-поиск и сценарий команды. Никаких абстрактных обещаний.',
  },
  {
    value: '1 ссылка',
    title: 'Меньше трения для клиента',
    body: 'Материалы, файлы, схемы и решения открываются в одном аккуратном пространстве — без «вот вам 12 файлов в почту».',
  },
  {
    value: '0 карт',
    title: 'Старт без лишних барьеров',
    body: 'Бесплатный персональный план помогает попробовать продукт до разговора о покупке.',
  },
] as const

export function HomeMarketFit() {
  return (
    <Box component="section" id="why" sx={{ bgcolor: 'background.default', py: { xs: 7, md: 11 } }}>
      <Container maxWidth="xl">
        <Stack spacing={2}>
          <Typography sx={eyebrowSx}>ПОЧЕМУ ЭТО ВАЖНО</Typography>
          <Typography component="h2" sx={sectionTitleSx}>
            Команда покупает не хранилище — <em>а быстрый доступ к контексту</em>
          </Typography>
          <Typography
            sx={{ color: 'text.secondary', fontSize: 16, lineHeight: 1.6, maxWidth: 620 }}
          >
            Современный продукт даёт посетителю увидеть сценарий и начать без созвона. «Любые
            заметки» работает на этой логике с первой страницы.
          </Typography>
        </Stack>

        <Box sx={{ mt: { xs: 4, md: 6 }, borderTop: '1px solid', borderColor: 'divider' }}>
          {rows.map((row) => (
            <Box
              key={row.title}
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', md: '200px 0.85fr 1fr' },
                gap: { xs: 1, md: 4 },
                py: { xs: 3, md: 4 },
                borderBottom: '1px solid',
                borderColor: 'divider',
                alignItems: 'baseline',
                transition: 'padding-left .25s ease',
                '&:hover': { pl: { md: 1.5 } },
                '@media (prefers-reduced-motion: reduce)': { '&:hover': { pl: 0 } },
              }}
            >
              <Typography sx={{ fontFamily: homeTokens.fonts.mono, color: t.orange, fontSize: 18 }}>
                {row.value}
              </Typography>
              <Typography
                sx={{
                  fontFamily: homeTokens.fonts.serif,
                  fontSize: 22,
                  fontWeight: 500,
                  lineHeight: 1.2,
                }}
              >
                {row.title}
              </Typography>
              <Typography sx={{ color: 'text.secondary', lineHeight: 1.65 }}>{row.body}</Typography>
            </Box>
          ))}
        </Box>
      </Container>
    </Box>
  )
}
