import {
  ArrowRightOutlinedIcon,
  Box,
  Button,
  Container,
  Stack,
  Typography,
} from '@repo/ui/components'

import { Origami } from './origami'
import { homeBaseSx, homeTokens } from './home-tokens'

const t = homeTokens.palette

type Props = {
  primaryHref: string
  primaryLabel: string
  showSecondary: boolean
}

export function HomeHero({ primaryHref, primaryLabel, showSecondary }: Props) {
  return (
    <Box
      component="section"
      sx={{
        ...homeBaseSx,
        position: 'relative',
        background:
          'linear-gradient(180deg, var(--mui-palette-background-default) 0%, var(--mui-palette-background-paper) 100%)',
        borderBottom: '1px solid',
        borderColor: 'divider',
        overflow: 'hidden',
        py: { xs: 6, md: 10 },
      }}
    >
      <Box
        aria-hidden
        sx={{
          position: 'absolute',
          inset: 0,
          backgroundImage: `linear-gradient(rgba(0,0,0,0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.045) 1px, transparent 1px)`,
          backgroundSize: '48px 48px',
          maskImage: 'radial-gradient(circle at 80% 20%, black, transparent 70%)',
          pointerEvents: 'none',
        }}
      />
      <Container maxWidth="xl" sx={{ position: 'relative' }}>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', lg: '1fr 1.15fr' },
            gap: { xs: 5, lg: 7 },
            alignItems: 'center',
          }}
        >
          <Stack spacing={3} sx={{ animation: 'anHeroIn 520ms ease-out both', maxWidth: 580 }}>
            <Box
              sx={{
                display: 'inline-flex',
                alignSelf: 'flex-start',
                alignItems: 'center',
                gap: 1,
                px: 1.5,
                py: 0.6,
                borderRadius: 999,
                bgcolor: '#fff',
                border: `1px solid ${t.line}`,
                fontSize: 12,
                color: '#444',
                '&::before': {
                  content: '""',
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  background: t.orange,
                  boxShadow: `0 0 0 4px rgba(201,100,66,0.16)`,
                },
              }}
            >
              Любые заметки · ИИ-пространство
            </Box>
            <Typography
              component="h1"
              sx={{
                fontFamily: homeTokens.fonts.serif,
                fontWeight: 500,
                fontSize: { xs: '2.5rem', sm: '3.4rem', md: '4rem', xl: '4.5rem' },
                lineHeight: 1.02,
                letterSpacing: '-0.025em',
                color: 'text.primary',
                m: 0,
                '& em': { fontStyle: 'italic', color: t.orange },
              }}
            >
              Рабочая память команды <em>с ИИ-поиском</em>
            </Typography>
            <Typography
              sx={{
                color: 'text.secondary',
                fontSize: { xs: '1rem', md: '1.06rem' },
                lineHeight: 1.55,
                maxWidth: 480,
              }}
            >
              Документы, базы данных, дашборды и файлы в одном пространстве. «Любые заметки»
              отвечает по вашим материалам, ведёт историю версий и помогает быстро передать контекст
              команде или клиенту.
            </Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
              <Button
                href={primaryHref}
                size="large"
                endIcon={<ArrowRightOutlinedIcon />}
                sx={{
                  bgcolor: 'secondary.main',
                  color: `${t.paper} !important`,
                  borderRadius: 1.25,
                  minHeight: 50,
                  px: 2.75,
                  '&:hover': { bgcolor: t.orange },
                  '& .MuiButton-endIcon': { color: 'inherit' },
                }}
              >
                {primaryLabel}
              </Button>
              {showSecondary && (
                <Button
                  href="/pricing"
                  variant="outlined"
                  size="large"
                  sx={{
                    borderRadius: 1.25,
                    minHeight: 50,
                    px: 2.5,
                    color: 'text.primary',
                    borderColor: 'divider',
                  }}
                >
                  Смотреть тарифы
                </Button>
              )}
            </Stack>
            <Stack
              direction="row"
              useFlexGap

              sx={{ pt: 1.5, columnGap: 2.5, rowGap: 1, color: 'text.secondary', flexWrap: 'wrap' }}
            >
              {['Без банковской карты', 'Базы и дашборды', 'ИИ по вашим данным'].map((label) => (
                <Stack key={label} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <Box
                    aria-hidden
                    sx={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      bgcolor: t.orange,
                      opacity: 0.8,
                    }}
                  />
                  <Typography variant="body2">{label}</Typography>
                </Stack>
              ))}
            </Stack>
          </Stack>

          <HeroPreview />
        </Box>
      </Container>
    </Box>
  )
}

function HeroPreview() {
  return (
    <Box
      sx={{
        position: 'relative',
        minHeight: { xs: 320, sm: 460, lg: 520 },
        animation: 'anSurfaceFloat 6s ease-in-out infinite',
      }}
    >
      <Origami
        variant="rhombus"
        size={96}
        gradient="warm"
        rotate={8}
        style={{ top: -10, left: '4%', zIndex: 3 }}
      />
      <Origami
        variant="triangle"
        size={70}
        gradient="deep"
        rotate={-15}
        style={{ bottom: 30, right: -8, zIndex: 3 }}
      />
      <Origami
        variant="circle"
        size={50}
        gradient="ink"
        style={{ bottom: -14, left: '16%', zIndex: 2 }}
      />

      <Box
        sx={{
          position: 'relative',
          zIndex: 4,
          mt: 2.5,
          ml: { lg: 2 },
          bgcolor: '#fff',
          borderRadius: 1.75,
          border: '1px solid rgba(0,0,0,0.08)',
          boxShadow: '0 30px 60px rgba(29,29,27,0.12), 0 6px 18px rgba(29,29,27,0.06)',
          overflow: 'hidden',
        }}
      >
        <BrowserChrome />
        <Box sx={{ display: 'grid', gridTemplateColumns: '168px 1fr', minHeight: 380 }}>
          <PreviewSidebar />
          <PreviewMain />
        </Box>
      </Box>
    </Box>
  )
}

function BrowserChrome() {
  return (
    <Stack
      direction="row"

      spacing={0.75}
      sx={{
        px: 1.5,
        py: 1.1,
        bgcolor: homeTokens.palette.paper,
        borderBottom: `1px solid ${homeTokens.palette.line}`,
        alignItems: 'center',
      }}
    >
      {[0, 1, 2].map((i) => (
        <Box
          key={i}
          sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'rgba(0,0,0,0.12)' }}
        />
      ))}
      <Typography
        sx={{
          ml: 1.25,
          fontFamily: homeTokens.fonts.mono,
          fontSize: 10.5,
          color: 'rgba(0,0,0,0.42)',
        }}
      >
        любые-заметки.app / workspaces / база-знаний
      </Typography>
    </Stack>
  )
}

function PreviewSidebar() {
  const t = homeTokens.palette
  return (
    <Box
      component="aside"
      sx={{ bgcolor: t.paper, borderRight: `1px solid ${t.line}`, p: '10px 8px', fontSize: 12 }}
    >
      <Stack
        direction="row"

        spacing={0.875}
        sx={{
          p: '4px 6px 8px',
          borderBottom: `1px solid ${t.line}`,
          mb: 0.75,
          alignItems: 'center',
        }}
      >
        <Box
          sx={{
            width: 22,
            height: 22,
            borderRadius: 0.625,
            background: 'linear-gradient(135deg,#0f766e,#155e75)',
            display: 'grid',
            placeItems: 'center',
            fontSize: 12,
          }}
        >
          📒
        </Box>
        <Box>
          <Typography sx={{ fontWeight: 500, fontSize: 12.5, lineHeight: 1.1 }}>
            База знаний
          </Typography>
          <Box sx={{ mt: 0.25 }}>
            <Box
              component="span"
              sx={{
                px: 0.75,
                py: '1px',
                borderRadius: 999,
                border: '1px solid rgba(0,0,0,0.15)',
                fontSize: 9.5,
                color: 'rgba(0,0,0,0.55)',
              }}
            >
              Бесплатный
            </Box>
          </Box>
        </Box>
      </Stack>
      <NavRow icon="🔍" label="Поиск и чаты" />
      <NavRow icon="⚙" label="Настройки" />
      <SectionLabel right="+">Командное</SectionLabel>
      <TreeItem chev="▾" emoji="📄" label="Стратегия 2026" />
      <TreeItem nested active emoji="🎯" label="Q2 цели" />
      <TreeItem nested emoji="📊" label="Дашборд" />
      <TreeItem chev="▸" emoji="🗂️" label="База задач" />
      <TreeItem chev="▸" emoji="📝" label="Заметки встреч" />
      <SectionLabel right="+">Личное</SectionLabel>
      <TreeItem chev="▸" emoji="⭐" label="Roadmap 2026" />
      <Box sx={{ mt: 1.75, pt: 1, borderTop: `1px solid ${t.line}` }}>
        <NavRow icon="🗄" label="Архив" />
        <NavRow icon="🗑" label="Корзина" />
      </Box>
    </Box>
  )
}

function NavRow({ icon, label }: { icon: string; label: string }) {
  return (
    <Stack
      direction="row"

      spacing={0.875}
      sx={{
        p: '5px 7px',
        borderRadius: 0.625,
        color: 'rgba(0,0,0,0.65)',
        my: '1px',
        alignItems: 'center',
      }}
    >
      <Box component="span" sx={{ fontSize: 12, opacity: 0.7 }}>
        {icon}
      </Box>
      <span>{label}</span>
    </Stack>
  )
}

function SectionLabel({ children, right }: { children: React.ReactNode; right?: string }) {
  return (
    <Stack
      direction="row"

      sx={{
        mt: 1.25,
        p: '4px 7px 2px',
        fontSize: 10,
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        color: 'rgba(0,0,0,0.42)',
        justifyContent: 'space-between',
      }}
    >
      <span>{children}</span>
      {right && <span>{right}</span>}
    </Stack>
  )
}

function TreeItem({
  chev,
  emoji,
  label,
  active,
  nested,
}: Readonly<{
  chev?: string
  emoji: string
  label: string
  active?: boolean
  nested?: boolean
}>) {
  return (
    <Stack
      direction="row"

      spacing={0.75}
      sx={{
        p: '4px 7px',
        pl: nested ? '22px' : '7px',
        borderRadius: 0.625,
        color: active ? homeTokens.palette.ink : 'rgba(0,0,0,0.74)',
        bgcolor: active ? 'rgba(0,0,0,0.06)' : 'transparent',
        fontWeight: active ? 500 : 400,
        my: '1px',
        alignItems: 'center',
      }}
    >
      {chev && (
        <Box component="span" sx={{ width: 9, color: 'rgba(0,0,0,0.35)', fontSize: 9 }}>
          {chev}
        </Box>
      )}
      <Box component="span" sx={{ fontSize: 12 }}>
        {emoji}
      </Box>
      <span>{label}</span>
    </Stack>
  )
}

function PreviewMain() {
  const t = homeTokens.palette
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', position: 'relative' }}>
      <Stack
        direction="row"

        spacing={1}
        sx={{
          p: '10px 16px',
          borderBottom: `1px solid ${t.line}`,
          fontSize: 11.5,
          color: 'rgba(0,0,0,0.5)',
          alignItems: 'center',
        }}
      >
        <span>База знаний</span>
        <span style={{ opacity: 0.45 }}>/</span>
        <span>Стратегия 2026</span>
        <span style={{ opacity: 0.45 }}>/</span>
        <Box component="span" sx={{ color: t.ink, fontWeight: 500 }}>
          Q2 цели
        </Box>
      </Stack>
      <Box sx={{ p: '22px 28px 18px', flex: 1 }}>
        <Box
          sx={{
            width: 32,
            height: 32,
            bgcolor: 'rgba(201,100,66,0.12)',
            borderRadius: 0.75,
            display: 'grid',
            placeItems: 'center',
            fontSize: 18,
            mb: 1.25,
          }}
        >
          🎯
        </Box>
        <Typography
          sx={{
            fontFamily: homeTokens.fonts.serif,
            fontSize: 22,
            fontWeight: 500,
            lineHeight: 1.15,
            letterSpacing: '-0.01em',
            mb: 1.75,
          }}
        >
          Q2 цели
        </Typography>
        {['92%', '78%', '86%'].map((w) => (
          <Box
            key={`a-${w}`}
            sx={{ height: 9, width: w, borderRadius: 0.375, bgcolor: 'rgba(0,0,0,0.08)', mb: 1 }}
          />
        ))}
        <Box
          sx={{
            height: 14,
            width: '38%',
            borderRadius: 0.375,
            bgcolor: 'rgba(0,0,0,0.18)',
            mt: 2,
            mb: 1.25,
          }}
        />
        {['92%', '86%', '78%'].map((w) => (
          <Box
            key={`b-${w}`}
            sx={{ height: 9, width: w, borderRadius: 0.375, bgcolor: 'rgba(0,0,0,0.08)', mb: 1 }}
          />
        ))}
      </Box>
      <AiPanel />
    </Box>
  )
}

function AiPanel() {
  const t = homeTokens.palette
  return (
    <Box
      sx={{
        position: 'absolute',
        right: 18,
        bottom: 18,
        width: 270,
        bgcolor: t.ink,
        color: t.paperDeep,
        borderRadius: 1.5,
        p: '14px 16px',
        boxShadow: '0 24px 50px rgba(0,0,0,0.35)',
        zIndex: 5,
        overflow: 'hidden',
        '&::after': {
          content: '""',
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: '-30%',
          width: '30%',
          background: 'linear-gradient(90deg, transparent, rgba(217,119,87,0.25), transparent)',
          animation: 'anScan 2.8s ease-in-out infinite',
        },
        '@media (prefers-reduced-motion: reduce)': { '&::after': { display: 'none' } },
      }}
    >
      <Stack
        direction="row"

        spacing={0.875}
        sx={{ fontSize: 12, color: 'rgba(240,238,230,0.65)', mb: 1, alignItems: 'center' }}
      >
        <Box component="span" sx={{ color: t.orangeWarm }}>
          ✦
        </Box>
        <span>Что мы обещали в марте?</span>
      </Stack>
      <Typography sx={{ fontSize: 13, lineHeight: 1.45, mb: 1.25 }}>
        Запуск рекламной кампании, редизайн сайта, еженедельные отчёты. Срок макета — 25 апреля.
      </Typography>
      <Stack spacing={0.625} sx={{ borderTop: '1px solid rgba(255,255,255,0.1)', pt: 1.25 }}>
        {[
          { em: '📄', name: 'Стратегия 2026' },
          { em: '📝', name: 'Заметка встречи 18.03' },
        ].map((s) => (
          <Stack
            key={s.name}
            direction="row"
            spacing={0.75}

            sx={{ fontSize: 11, color: 'rgba(240,238,230,0.7)', alignItems: 'center' }}
          >
            <span>{s.em}</span>
            <span>{s.name}</span>
          </Stack>
        ))}
      </Stack>
    </Box>
  )
}
