import Link from 'next/link'
import { Box, Button, Container, Stack, Typography } from '@repo/ui/components'

import { landingPricingCards } from '../content'
import { eyebrowSx, sectionTitleSx, homeTokens } from './home-tokens'

const t = homeTokens.palette

export function HomePricing() {
  return (
    <Box component="section" id="pricing" sx={{ bgcolor: t.ink, color: t.paperDeep, py: { xs: 7, md: 11 } }}>
      <Container maxWidth="xl">
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '0.7fr 1.3fr' }, gap: { xs: 4, lg: 7 }, alignItems: 'start' }}>
          <Stack spacing={2}>
            <Typography sx={{ ...eyebrowSx, color: 'rgba(240,238,230,0.55)' }}>ТАРИФЫ</Typography>
            <Typography component="h2" sx={{ ...sectionTitleSx, color: t.paperDeep }}>
              Начните бесплатно — <em>расширяйте по мере роста</em>
            </Typography>
            <Button
              href="/pricing"
              variant="outlined"
              sx={{ alignSelf: 'flex-start', mt: 1, color: t.paperDeep, borderColor: 'rgba(240,238,230,0.28)' }}
            >
              Сравнить планы
            </Button>
          </Stack>

          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)' },
              borderTop: '1px solid rgba(240,238,230,0.16)',
              borderLeft: { md: '1px solid rgba(240,238,230,0.16)' },
            }}
          >
            {landingPricingCards.map((plan) => {
              const isFeatured = plan.slug === 'pro'
              return (
                <Link key={plan.slug} href="/pricing" style={{ color: 'inherit', textDecoration: 'none', display: 'block', height: '100%' }}>
                  <Box
                    sx={{
                      p: 3.5, minHeight: 280, height: '100%', position: 'relative', display: 'flex', flexDirection: 'column',
                      borderRight: { md: '1px solid rgba(240,238,230,0.16)' },
                      borderBottom: '1px solid rgba(240,238,230,0.16)',
                      bgcolor: isFeatured ? 'rgba(201,100,66,0.14)' : 'transparent',
                      transition: 'background-color .2s ease',
                      '&:hover': { bgcolor: isFeatured ? 'rgba(201,100,66,0.18)' : 'rgba(240,238,230,0.04)' },
                    }}
                  >
                    {isFeatured && (
                      <Box
                        aria-hidden
                        sx={{
                          position: 'absolute', top: -16, right: 18, width: 32, height: 32,
                          background: `linear-gradient(135deg, ${t.orangeWarm}, ${t.orange})`,
                          clipPath: 'polygon(50% 0, 100% 50%, 50% 100%, 0 50%)',
                          boxShadow: '4px 6px 14px rgba(0,0,0,0.3)', transform: 'rotate(8deg)',
                        }}
                      />
                    )}
                    <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1.25 }}>
                      <Typography sx={{ fontFamily: homeTokens.fonts.serif, fontSize: 22, fontWeight: 500, color: t.paperDeep }}>{plan.name}</Typography>
                      {isFeatured && (
                        <Box component="span" sx={{ bgcolor: t.paperDeep, color: t.ink, fontSize: 10, px: 1, py: '3px', borderRadius: 999, fontFamily: homeTokens.fonts.mono, textTransform: 'uppercase', letterSpacing: '0.08em' }}>популярный</Box>
                      )}
                    </Stack>
                    <Typography
                      sx={{
                        fontFamily: homeTokens.fonts.serif, fontSize: 28, fontWeight: 500, letterSpacing: '-0.01em', mb: 1.75,
                        color: plan.slug === 'personal' ? t.orangeWarm : t.paperDeep,
                      }}
                    >
                      {plan.price}
                    </Typography>
                    <Stack component="ul" spacing={0.875} sx={{ flex: 1, p: 0, m: 0, listStyle: 'none' }}>
                      {plan.features.map((item) => (
                        <Typography
                          component="li"
                          key={item}
                          sx={{
                            position: 'relative', pl: 2.25, fontSize: 13, lineHeight: 1.55,
                            color: 'rgba(240,238,230,0.72)',
                            '&::before': { content: '"+"', position: 'absolute', left: 0, top: 0, color: t.orangeWarm, fontFamily: homeTokens.fonts.mono },
                          }}
                        >
                          {item}
                        </Typography>
                      ))}
                    </Stack>
                    <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mt: 2 }}>
                      <Typography sx={{ fontSize: 13, color: 'rgba(240,238,230,0.85)' }}>Подробнее →</Typography>
                    </Stack>
                  </Box>
                </Link>
              )
            })}
          </Box>
        </Box>
      </Container>
    </Box>
  )
}
