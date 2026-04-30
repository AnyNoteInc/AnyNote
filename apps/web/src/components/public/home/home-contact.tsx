import { Box, Container, Stack, Typography } from '@repo/ui/components'

import { ContactForm } from '../contact-form'
import { Origami } from './origami'
import { eyebrowSx, sectionTitleSx, homeTokens } from './home-tokens'

const t = homeTokens.palette

export function HomeContact() {
  return (
    <Box component="section" id="contact" sx={{ bgcolor: '#fff', py: { xs: 7, md: 11 }, overflow: 'hidden' }}>
      <Container maxWidth="xl">
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1fr 1.1fr' }, gap: { xs: 4, lg: 8 }, alignItems: 'center' }}>
          <Stack spacing={2}>
            <Typography sx={eyebrowSx}>ОСОБОЕ РЕШЕНИЕ</Typography>
            <Typography component="h2" sx={sectionTitleSx}>
              Нужна <em>нестандартная конфигурация?</em>
            </Typography>
            <Typography sx={{ color: t.inkSoft, fontSize: 16, lineHeight: 1.6, maxWidth: 540 }}>
              On-prem, выделенный домен, SSO, индивидуальные интеграции, корпоративный тариф — оставьте контакты, обсудим за день.
            </Typography>

            <Box sx={{ position: 'relative', minHeight: 280, mt: 3, display: { xs: 'none', md: 'block' } }}>
              <Origami variant="rhombus" size={140} gradient="warm" rotate={8} style={{ top: 0, left: 24 }} />
              <Origami variant="triangle" size={90} gradient="deep" rotate={-12} style={{ top: 60, right: 30 }} />
              <Origami variant="circle" size={70} gradient="ink" style={{ bottom: 0, left: 110 }} />
              <Box sx={{ position: 'absolute', bottom: 18, right: 0, bgcolor: '#fff', border: `1px solid ${t.line}`, borderRadius: 1.5, p: '14px 16px', boxShadow: '0 18px 40px rgba(0,0,0,0.08)', maxWidth: 240, zIndex: 2 }}>
                <Typography sx={{ ...eyebrowSx, mb: 0.75 }}>СРЕДНЕЕ ВРЕМЯ ОТВЕТА</Typography>
                <Typography sx={{ fontFamily: homeTokens.fonts.serif, fontSize: 14, lineHeight: 1.4, m: 0 }}>
                  «Связались в тот же день и собрали стенд за неделю».
                </Typography>
              </Box>
            </Box>
          </Stack>

          <Box sx={{ bgcolor: '#fff', border: `1px solid ${t.line}`, borderRadius: 1.75, p: { xs: 3, md: 3.5 }, boxShadow: '0 24px 48px rgba(0,0,0,0.06)' }}>
            <ContactForm />
          </Box>
        </Box>
      </Container>
    </Box>
  )
}
