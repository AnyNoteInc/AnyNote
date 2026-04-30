import { Box, Container, Stack, Typography } from '@repo/ui/components'
import { eyebrowSx, sectionTitleSx, homeBaseSx, homeTokens } from './home-tokens'

const t = homeTokens.palette

const steps = [
  'Загрузите документы, заметки и вложения команды',
  'Разложите их по рабочим пространствам и страницам',
  'Задайте вопрос обычными словами',
  'Получите ответ со ссылками на исходные материалы',
] as const

const sources = [
  { em: '📄', name: 'Договор № 14 от 12.03', meta: '2 цитаты' },
  { em: '📋', name: 'Бриф проекта', meta: '3 цитаты' },
  { em: '📝', name: 'Заметка встречи 18.03', meta: '1 цитата' },
] as const

export function HomeSearch() {
  return (
    <Box component="section" id="search" sx={{ ...homeBaseSx, bgcolor: 'background.default', py: { xs: 7, md: 11 } }}>
      <Container maxWidth="xl">
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '0.9fr 1.1fr' }, gap: { xs: 4, lg: 8 }, alignItems: 'start' }}>
          <Stack spacing={2}>
            <Typography sx={eyebrowSx}>ИИ-ПОИСК</Typography>
            <Typography component="h2" sx={sectionTitleSx}>
              Ответ должен приходить из ваших документов — <em>не из догадок</em>
            </Typography>
            <Typography sx={{ color: 'text.secondary', fontSize: 16, lineHeight: 1.6, maxWidth: 560 }}>
              Вместо поиска по папкам команда спрашивает «Любые заметки» обычными словами и сразу видит, на какие материалы опирается ответ.
            </Typography>
            <Stack spacing={1.75} sx={{ mt: 3 }}>
              {steps.map((step, i) => (
                <Stack key={step} direction="row" spacing={1.75} alignItems="flex-start">
                  <Box sx={{ width: 28, height: 28, borderRadius: '50%', bgcolor: 'secondary.main', color: 'secondary.contrastText', display: 'grid', placeItems: 'center', fontFamily: homeTokens.fonts.mono, fontSize: 12, flexShrink: 0 }}>{i + 1}</Box>
                  <Typography sx={{ fontSize: 16, lineHeight: 1.5, pt: '3px' }}>{step}</Typography>
                </Stack>
              ))}
            </Stack>
          </Stack>

          <Box sx={{ bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: 1.75, boxShadow: '0 30px 60px rgba(29,29,27,0.08)', overflow: 'hidden' }}>
            <Stack
              direction="row"
              alignItems="center"
              spacing={1.25}
              sx={{
                bgcolor: 'secondary.main', color: 'secondary.contrastText', p: '18px 22px', position: 'relative', overflow: 'hidden',
                '&::after': { content: '""', position: 'absolute', top: 0, bottom: 0, left: '-30%', width: '30%', background: 'linear-gradient(90deg, transparent, rgba(217,119,87,0.28), transparent)', animation: 'anScan 3s ease-in-out infinite' },
                '@media (prefers-reduced-motion: reduce)': { '&::after': { display: 'none' } },
              }}
            >
              <Box component="span" sx={{ color: t.orangeWarm, fontSize: 14, opacity: 1 }}>✦</Box>
              <Typography sx={{ fontWeight: 500, fontSize: 15 }}>Что мы обещали клиенту в марте?</Typography>
            </Stack>
            <Box sx={{ p: '22px 24px 18px' }}>
              <Typography sx={{ fontFamily: homeTokens.fonts.serif, fontSize: 19, lineHeight: 1.45, mb: 2.25, letterSpacing: '-0.005em' }}>
                В марте команда согласовала редизайн сайта, запуск рекламной кампании и еженедельные отчёты. Крайний срок первого макета — <Box component="span" sx={{ borderRight: `2px solid ${t.orange}`, pr: '2px' }}>25 апреля</Box>.
              </Typography>
              <Box sx={{ height: 1, bgcolor: 'divider', mx: -3, mb: 2 }} />
              <Typography sx={{ ...eyebrowSx, mb: 1.25 }}>ИСТОЧНИКИ</Typography>
              <Stack spacing={1}>
                {sources.map((s) => (
                  <Stack
                    key={s.name}
                    direction="row"
                    spacing={1.25}
                    alignItems="center"
                    sx={{ p: '8px 10px', borderRadius: 1, bgcolor: 'background.default', transition: 'background .18s ease', '&:hover': { bgcolor: 'background.paper' } }}
                  >
                    <Box component="span" sx={{ fontSize: 16 }}>{s.em}</Box>
                    <Typography sx={{ fontSize: 13, flex: 1 }}>{s.name}</Typography>
                    <Typography sx={{ fontFamily: homeTokens.fonts.mono, fontSize: 11, color: 'text.disabled' }}>{s.meta}</Typography>
                  </Stack>
                ))}
              </Stack>
            </Box>
          </Box>
        </Box>
      </Container>
    </Box>
  )
}
