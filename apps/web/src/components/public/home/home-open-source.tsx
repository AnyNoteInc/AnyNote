import { Box, Button, Container, GitHubIcon, Stack, Typography } from '@repo/ui/components'

import { publicRepo } from '../content'
import { eyebrowSx, homeTokens } from './home-tokens'

const t = homeTokens.palette

const pillars = [
  {
    title: 'Прозрачность',
    body: 'Весь код продукта открыт: редактор, серверы синхронизации, ИИ-конвейер. Видно, как хранятся и обрабатываются ваши данные — никаких чёрных ящиков.',
  },
  {
    title: 'Своя инфраструктура',
    body: 'Продукт можно развернуть в собственном контуре — от личного сервера до закрытой корпоративной сети. Данные остаются у вас.',
  },
  {
    title: 'Развитие на виду',
    body: 'Ошибки, идеи и pull request’ы — в открытом трекере. Каждое изменение продукта видно в истории коммитов.',
  },
] as const

export function HomeOpenSource() {
  return (
    <Box
      component="section"
      id="opensource"
      sx={{ bgcolor: t.ink, color: t.paperDeep, py: { xs: 7, md: 11 } }}
    >
      <Container maxWidth="xl">
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: '1.1fr 1fr' },
            gap: { xs: 5, md: 8 },
            alignItems: 'center',
          }}
        >
          <Stack spacing={2.5}>
            <Typography sx={{ ...eyebrowSx, color: 'rgba(240,238,230,0.55)' }}>
              ОТКРЫТЫЙ КОД
            </Typography>
            <Typography
              component="h2"
              sx={{
                fontFamily: homeTokens.fonts.serif,
                fontWeight: 500,
                fontSize: { xs: '2rem', md: '2.75rem' },
                lineHeight: 1.05,
                letterSpacing: '-0.02em',
                m: 0,
                maxWidth: 620,
                '& em': { fontStyle: 'italic', color: t.orangeWarm },
              }}
            >
              Продукт полностью <em>Open Source</em>
            </Typography>
            <Typography
              sx={{ color: 'rgba(240,238,230,0.7)', fontSize: 16, lineHeight: 1.65, maxWidth: 540 }}
            >
              Исходный код «Любых заметок» открыт и опубликован на GitHub. Изучите, как устроен
              продукт, разверните его у себя или предложите улучшение — мы развиваем его открыто.
            </Typography>
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={2}
              alignItems={{ xs: 'flex-start', sm: 'center' }}
            >
              <Button
                component="a"
                href={publicRepo.url}
                target="_blank"
                rel="noopener noreferrer"
                size="large"
                startIcon={<GitHubIcon />}
                sx={{
                  bgcolor: t.orangeWarm,
                  color: `${t.paper} !important`,
                  borderRadius: 1.5,
                  minHeight: 48,
                  px: 3,
                  fontSize: 15,
                  '& .MuiButton-startIcon': { color: 'inherit' },
                  '&:hover': { bgcolor: t.orange },
                }}
              >
                Открыть на GitHub
              </Button>
              <Typography
                component="a"
                href={publicRepo.url}
                target="_blank"
                rel="noopener noreferrer"
                sx={{
                  fontFamily: homeTokens.fonts.mono,
                  fontSize: 13,
                  color: 'rgba(240,238,230,0.6) !important',
                  textDecoration: 'none',
                  '&:hover': { color: `${t.paperDeep} !important` },
                }}
              >
                {publicRepo.label}
              </Typography>
            </Stack>
          </Stack>

          <Stack spacing={0} sx={{ borderTop: '1px solid rgba(240,238,230,0.14)' }}>
            {pillars.map((p) => (
              <Box
                key={p.title}
                sx={{ py: 2.75, borderBottom: '1px solid rgba(240,238,230,0.14)' }}
              >
                <Typography
                  sx={{
                    fontFamily: homeTokens.fonts.serif,
                    fontSize: 19,
                    fontWeight: 500,
                    lineHeight: 1.25,
                    mb: 0.75,
                  }}
                >
                  {p.title}
                </Typography>
                <Typography
                  sx={{ fontSize: 14, lineHeight: 1.65, color: 'rgba(240,238,230,0.62)' }}
                >
                  {p.body}
                </Typography>
              </Box>
            ))}
          </Stack>
        </Box>
      </Container>
    </Box>
  )
}
