import { Box, Container, Stack, Typography } from '@repo/ui/components'
import { eyebrowSx, sectionTitleSx, homeTokens } from './home-tokens'
import { homeFeatures } from '../content'

export function HomeFeatures() {
  return (
    <Box
      component="section"
      id="features"
      sx={{ bgcolor: 'background.default', py: { xs: 7, md: 11 } }}
    >
      <Container maxWidth="xl">
        <Stack spacing={2}>
          <Typography sx={eyebrowSx}>ВОЗМОЖНОСТИ</Typography>
          <Typography component="h2" sx={sectionTitleSx}>
            Что ещё <em>стоит знать</em>
          </Typography>
          <Typography
            sx={{ color: 'text.secondary', fontSize: 16, lineHeight: 1.6, maxWidth: 620 }}
          >
            Шесть свойств, на которые мы зашили инженерные часы, чтобы продукт был приятным в
            ежедневной работе.
          </Typography>
        </Stack>

        <Box
          sx={{
            mt: { xs: 5, md: 7 },
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)' },
            columnGap: { xs: 3, md: 6 },
            rowGap: { xs: 4.5, md: 7 },
          }}
        >
          {homeFeatures.map((f) => (
            <Box key={f.title}>
              <Box sx={{ fontSize: 22, lineHeight: 1, mb: 2.25 }}>{f.icon}</Box>
              <Typography
                sx={{
                  fontFamily: homeTokens.fonts.serif,
                  fontSize: 20,
                  fontWeight: 500,
                  lineHeight: 1.2,
                  letterSpacing: '-0.01em',
                  mb: 0.5,
                }}
              >
                {f.title}
              </Typography>
              <Typography
                sx={{ fontSize: 14, lineHeight: 1.6, color: 'text.secondary', maxWidth: 320 }}
              >
                {f.body}
              </Typography>
            </Box>
          ))}
        </Box>
      </Container>
    </Box>
  )
}
