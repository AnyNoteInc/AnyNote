import { ArrowRightOutlinedIcon, Box, Button, Container, Stack, Typography } from '@repo/ui/components'

import { Origami } from './origami'
import { homeTokens } from './home-tokens'

const t = homeTokens.palette

type Props = { primaryHref: string; primaryLabel: string }

export function HomeFinalCta({ primaryHref, primaryLabel }: Props) {
  return (
    <Box
      component="section"
      sx={{
        position: 'relative',
        background: `linear-gradient(180deg, ${t.paper} 0%, ${t.paperDeep} 100%)`,
        py: { xs: 8, md: 11 },
        overflow: 'hidden',
      }}
    >
      <Origami
        variant="rhombus"
        size={260}
        gradient="warm"
        style={{ top: '50%', right: -60, transform: 'translateY(-50%) rotate(0deg)', boxShadow: '-20px 20px 60px rgba(201,100,66,0.3)', opacity: 0.85 }}
      />
      <Origami variant="circle" size={80} gradient="ink" style={{ bottom: 30, left: 60, boxShadow: '8px 12px 30px rgba(0,0,0,0.2)' }} />

      <Container maxWidth="xl" sx={{ position: 'relative', zIndex: 2 }}>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr auto' }, gap: { xs: 3, md: 5 }, alignItems: 'end' }}>
          <Stack spacing={2}>
            <Typography
              component="h2"
              sx={{
                fontFamily: homeTokens.fonts.serif, fontWeight: 500,
                fontSize: { xs: '2.25rem', md: '4rem' }, lineHeight: 1.02, letterSpacing: '-0.025em',
                color: t.ink, m: 0, maxWidth: 720,
                '& em': { fontStyle: 'italic', color: t.orange },
              }}
            >
              Перенесите рабочие знания туда, <em>где их можно найти</em>
            </Typography>
            <Typography sx={{ color: t.inkSoft, fontSize: 16, lineHeight: 1.6, maxWidth: 540 }}>
              Регистрация занимает пару минут. Начните с личного пространства и подключите команду позже.
            </Typography>
          </Stack>
          <Button
            href={primaryHref}
            size="large"
            endIcon={<ArrowRightOutlinedIcon />}
            sx={{ bgcolor: t.ink, color: `${t.paperDeep} !important`, borderRadius: 1.5, minHeight: 56, px: 3.5, fontSize: 16, '& .MuiButton-endIcon': { color: 'inherit' }, '&:hover': { bgcolor: t.orange } }}
          >
            {primaryLabel}
          </Button>
        </Box>
      </Container>
    </Box>
  )
}
