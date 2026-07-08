import { Box, Container, Stack, Typography } from '@repo/ui/components'

import { homeCapabilities } from '../content'
import { eyebrowSx, sectionTitleSx, homeTokens } from './home-tokens'

const t = homeTokens.palette

/**
 * «Возможности целиком» — bento-сетка крупных продуктовых направлений
 * (Notion-parity, фазы cl1–cl9). Держит ту же editorial-эстетику, что и остальная
 * главная: бумажный фон, одна оранжевая акцентная нота, serif-заголовки и
 * mono-микролейблы. Первая карточка (базы/дашборды) занимает два столбца как
 * флагманская возможность.
 */
export function HomeCapabilities() {
  return (
    <Box
      component="section"
      id="capabilities"
      sx={{
        bgcolor: 'background.paper',
        borderBlock: '1px solid',
        borderColor: 'divider',
        py: { xs: 7, md: 11 },
      }}
    >
      <Container maxWidth="xl">
        <Stack spacing={2} sx={{ maxWidth: 720 }}>
          <Typography sx={eyebrowSx}>ВОЗМОЖНОСТИ ЦЕЛИКОМ</Typography>
          <Typography component="h2" sx={sectionTitleSx}>
            Не просто заметки — <em>рабочая система команды</em>
          </Typography>
          <Typography
            sx={{ color: 'text.secondary', fontSize: 16, lineHeight: 1.6, maxWidth: 620 }}
          >
            Документы, базы данных, дашборды, публикация, ИИ и интеграции живут в одном дереве
            страниц. Ниже — крупные блоки, из которых складывается продукт.
          </Typography>
        </Stack>

        <Box
          sx={{
            mt: { xs: 5, md: 7 },
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(3, 1fr)' },
            gap: { xs: 2, md: 2.5 },
          }}
        >
          {homeCapabilities.map((cap) => (
            <CapabilityCard key={cap.title} cap={cap} />
          ))}
        </Box>
      </Container>
    </Box>
  )
}

type Capability = (typeof homeCapabilities)[number]

function CapabilityCard({ cap }: { readonly cap: Capability }) {
  return (
    <Box
      sx={{
        gridColumn: { lg: cap.span === 2 ? 'span 2' : 'span 1' },
        display: 'flex',
        flexDirection: 'column',
        p: { xs: 3, md: 3.5 },
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 1.75,
        bgcolor: 'background.default',
        transition: 'transform .22s ease, box-shadow .22s ease, border-color .22s ease',
        '&:hover': {
          transform: { md: 'translateY(-4px)' },
          boxShadow: '0 24px 48px rgba(29,29,27,0.08)',
          borderColor: 'rgba(201,100,66,0.4)',
        },
        '@media (prefers-reduced-motion: reduce)': {
          '&:hover': { transform: 'none' },
        },
      }}
    >
      <Box
        aria-hidden
        sx={{
          width: 40,
          height: 40,
          bgcolor: 'rgba(201,100,66,0.12)',
          borderRadius: 1,
          display: 'grid',
          placeItems: 'center',
          fontSize: 19,
          color: t.orange,
          mb: 2.25,
        }}
      >
        {cap.icon}
      </Box>
      <Typography
        component="h3"
        sx={{
          fontFamily: homeTokens.fonts.serif,
          fontSize: { xs: 21, md: 23 },
          fontWeight: 500,
          lineHeight: 1.18,
          letterSpacing: '-0.01em',
          mb: 1,
        }}
      >
        {cap.title}
      </Typography>
      <Typography
        sx={{
          color: 'text.secondary',
          fontSize: 14.5,
          lineHeight: 1.6,
          mb: 2.5,
          maxWidth: cap.span === 2 ? 560 : 360,
        }}
      >
        {cap.body}
      </Typography>

      <Stack
        direction="row"
        useFlexGap

        sx={{ mt: 'auto', columnGap: 1, rowGap: 1, flexWrap: 'wrap' }}
      >
        {cap.points.map((point) => (
          <Box
            key={point}
            sx={{
              fontFamily: homeTokens.fonts.mono,
              fontSize: 11,
              letterSpacing: '0.01em',
              color: 'text.secondary',
              px: 1,
              py: 0.5,
              borderRadius: 999,
              border: `1px solid ${t.line}`,
              bgcolor: 'background.paper',
            }}
          >
            {point}
          </Box>
        ))}
      </Stack>
    </Box>
  )
}
