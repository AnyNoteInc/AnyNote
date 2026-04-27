import type { Metadata } from 'next'
import Link from 'next/link'
import type { ReactNode } from 'react'

import {
  AccountTreeIcon,
  ArrowRightOutlinedIcon,
  Box,
  BrushIcon,
  Button,
  ChatBubbleOutlineIcon,
  Container,
  DescriptionIcon,
  Divider,
  LinkIcon,
  Paper,
  SearchIcon,
  Stack,
  Typography,
} from '@repo/ui/components'

import { landingPricingCards } from '@/components/public/content'
import { PublicFooter } from '@/components/public/public-footer'
import { PublicHeader } from '@/components/public/public-header'
import { getSession } from '@/lib/get-session'

const marketFitRows = [
  {
    value: '10 секунд',
    title: 'Понятно, что делает продукт',
    body: 'Главная сразу показывает рабочее пространство, AI-поиск и сценарии команды без абстрактных обещаний.',
  },
  {
    value: '1 ссылка',
    title: 'Меньше трения для клиента',
    body: 'Материалы, файлы, схемы и решения можно открыть в одном аккуратном пространстве.',
  },
  {
    value: '0 карт',
    title: 'Старт без лишних барьеров',
    body: 'Бесплатный персональный план помогает попробовать продукт до разговора о покупке.',
  },
] as const

const workspaceModes = [
  {
    icon: DescriptionIcon,
    title: 'Документы',
    body: 'Заметки, договоры, брифы, регламенты и файлы живут в структуре, которую понимает вся команда.',
  },
  {
    icon: BrushIcon,
    title: 'Схемы и холсты',
    body: 'Сложные процессы можно объяснять визуально рядом с текстом, а не в отдельных инструментах.',
  },
  {
    icon: ChatBubbleOutlineIcon,
    title: 'AI-чаты',
    body: 'AnyNote отвечает по материалам рабочего пространства и сохраняет контекст для следующего шага.',
  },
  {
    icon: LinkIcon,
    title: 'Публичные ссылки',
    body: 'Клиент получает чистую страницу с нужными материалами без пересылки десятков вложений.',
  },
] as const

const workflowSteps = [
  'Загрузите документы, заметки и вложения команды',
  'Разложите их по рабочим пространствам и страницам',
  'Задайте вопрос обычными словами',
  'Получите ответ со ссылками на исходные материалы',
] as const

export const metadata: Metadata = {
  title: 'AnyNote',
}

export default async function HomePage() {
  const session = await getSession()

  const primaryHref = session ? '/app' : '/registration'
  const primaryLabel = session ? 'Открыть рабочее пространство' : 'Начать бесплатно'

  return (
    <Box
      component="main"
      sx={{
        minHeight: '100vh',
        overflow: 'hidden',
        color: 'text.primary',
        backgroundColor: 'background.default',
        '@keyframes anHeroIn': {
          from: { opacity: 0, transform: 'translateY(18px)' },
          to: { opacity: 1, transform: 'translateY(0)' },
        },
        '@keyframes anSurfaceFloat': {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        '@keyframes anScan': {
          from: { transform: 'translateX(-38%)', opacity: 0.2 },
          to: { transform: 'translateX(128%)', opacity: 0 },
        },
      }}
    >
      <PublicHeader session={session} />

      <Box
        component="section"
        sx={{
          minHeight: { xs: 'auto', lg: 'calc(88svh - 92px)' },
          display: 'flex',
          alignItems: 'center',
          position: 'relative',
          color: '#f7f3ea',
          background:
            'linear-gradient(135deg, #111312 0%, #171717 48%, #221b15 100%)',
          borderBottom: '1px solid rgba(166,124,82,0.22)',
        }}
      >
        <Box
          aria-hidden
          sx={{
            position: 'absolute',
            inset: 0,
            backgroundImage:
              'linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)',
            backgroundSize: '72px 72px',
            maskImage: 'linear-gradient(90deg, transparent 0%, black 18%, black 72%, transparent 100%)',
          }}
        />
        <Container
          maxWidth="xl"
          sx={{
            position: 'relative',
            py: { xs: 4, md: 6 },
            width: '100%',
          }}
        >
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', lg: '0.9fr 1.1fr' },
              gap: { xs: 3, lg: 7 },
              alignItems: 'center',
            }}
          >
            <Stack
              spacing={{ xs: 2.5, md: 3.5 }}
              sx={{
                maxWidth: 680,
                animation: 'anHeroIn 520ms ease-out both',
              }}
            >
              <Typography
                sx={{
                  fontFamily: 'var(--font-geist-mono), ui-monospace, monospace',
                  letterSpacing: 0,
                  color: 'rgba(247,243,234,0.68)',
                  textTransform: 'uppercase',
                  fontSize: '0.78rem',
                }}
              >
                AnyNote
              </Typography>
              <Typography
                variant="h1"
                sx={{
                  letterSpacing: 0,
                  fontSize: { xs: '2.35rem', sm: '4rem', md: '5.1rem', xl: '6rem' },
                  lineHeight: 0.96,
                  maxWidth: 760,
                }}
              >
                Рабочая память команды с AI-поиском
              </Typography>
              <Typography
                sx={{
                  maxWidth: 560,
                  color: 'rgba(247,243,234,0.74)',
                  lineHeight: { xs: 1.55, md: 1.7 },
                  fontSize: { xs: '1rem', md: '1.14rem' },
                }}
              >
                Соберите документы, заметки, схемы и файлы в одном пространстве. AnyNote отвечает
                по вашим материалам и помогает быстро передать контекст команде или клиенту.
              </Typography>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                <Button
                  href={primaryHref}
                  size="large"
                  sx={{
                    minHeight: 50,
                    bgcolor: '#f7f3ea',
                    color: '#121416 !important',
                    '&:hover': { bgcolor: '#fffaf0' },
                    '& .MuiButton-endIcon': { color: '#121416' },
                  }}
                  endIcon={<ArrowRightOutlinedIcon />}
                >
                  {primaryLabel}
                </Button>
                {!session && (
                  <Button
                    href="/pricing"
                    variant="outlined"
                    color="inherit"
                    size="large"
                    sx={{
                      minHeight: 50,
                      borderColor: 'rgba(247,243,234,0.32)',
                      color: '#f7f3ea',
                    }}
                  >
                    Смотреть тарифы
                  </Button>
                )}
              </Stack>
              <Stack
                direction="row"
                spacing={0}
                useFlexGap
                sx={{
                  pt: 0.5,
                  color: 'rgba(247,243,234,0.62)',
                  flexWrap: 'wrap',
                  columnGap: { xs: 1.8, sm: 2.5 },
                  rowGap: 0.8,
                }}
              >
                <TrustLine>Без банковской карты</TrustLine>
                <TrustLine>Публичные ссылки</TrustLine>
                <TrustLine>AI по вашим данным</TrustLine>
              </Stack>
            </Stack>

            <HeroWorkspaceSurface />
          </Box>
        </Container>
      </Box>

      <Container maxWidth="xl" sx={{ py: { xs: 3, md: 11 } }}>
        <SectionIntro
          eyebrow="Почему это важно"
          title="Современная команда покупает не хранилище, а быстрый доступ к контексту"
          body="Рынок AI-SaaS стал product-led: посетитель должен сразу увидеть продукт, понять сценарий и начать без длинного созвона."
        />

        <Box sx={{ mt: { xs: 4, md: 6 }, borderTop: '1px solid', borderColor: 'divider' }}>
          {marketFitRows.map((row) => (
            <MarketFitRow key={row.title} {...row} />
          ))}
        </Box>
      </Container>

      <Box
        component="section"
        sx={{
          py: { xs: 7, md: 11 },
          backgroundColor: 'background.paper',
          borderBlock: '1px solid',
          borderColor: 'divider',
        }}
      >
        <Container maxWidth="xl">
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', lg: '0.8fr 1.2fr' },
              gap: { xs: 5, lg: 8 },
              alignItems: 'start',
            }}
          >
            <Box sx={{ position: { lg: 'sticky' }, top: { lg: 112 } }}>
              <SectionIntro
                eyebrow="Рабочее пространство"
                title="Один продукт для текста, файлов, визуальных схем и AI-вопросов"
                body="AnyNote закрывает ежедневный сценарий базы знаний: создать, найти, объяснить, отправить."
              />
            </Box>

            <Stack divider={<Divider />} spacing={0}>
              {workspaceModes.map((mode) => (
                <WorkspaceMode key={mode.title} {...mode} />
              ))}
            </Stack>
          </Box>
        </Container>
      </Box>

      <Container maxWidth="xl" sx={{ py: { xs: 7, md: 11 } }}>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 0.85fr) minmax(0, 1.15fr)' },
            gap: { xs: 5, lg: 7 },
            alignItems: 'center',
          }}
        >
          <Stack spacing={3}>
            <SectionIntro
              eyebrow="AI-поиск"
              title="Ответ должен приходить из ваших документов, а не из догадок"
              body="Вместо поиска по папкам команда спрашивает AnyNote обычными словами и сразу видит, на какие материалы опирается ответ."
            />
            <Stack spacing={1.4}>
              {workflowSteps.map((step, index) => (
                <WorkflowStep key={step} index={index + 1}>
                  {step}
                </WorkflowStep>
              ))}
            </Stack>
          </Stack>

          <AiAnswerPanel />
        </Box>
      </Container>

      <Box
        component="section"
        sx={{
          py: { xs: 7, md: 11 },
          backgroundColor: '#121416',
          color: '#f7f3ea',
        }}
      >
        <Container maxWidth="xl">
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', lg: '0.7fr 1.3fr' },
              gap: { xs: 4, lg: 7 },
              alignItems: 'start',
            }}
          >
            <Stack spacing={2.5}>
              <Typography
                sx={{
                  fontFamily: 'var(--font-geist-mono), ui-monospace, monospace',
                  letterSpacing: 0,
                  color: 'rgba(247,243,234,0.56)',
                  textTransform: 'uppercase',
                  fontSize: '0.76rem',
                }}
              >
                Тарифы
              </Typography>
              <Typography
                variant="h2"
                sx={{
                  letterSpacing: 0,
                  maxWidth: 520,
                  fontSize: { xs: '2.25rem', md: '3.6rem' },
                }}
              >
                Начните бесплатно, расширяйте по мере роста команды
              </Typography>
              <Button
                href="/pricing"
                variant="outlined"
                color="inherit"
                sx={{
                  alignSelf: 'flex-start',
                  mt: 1,
                  borderColor: 'rgba(247,243,234,0.28)',
                  color: '#f7f3ea',
                }}
              >
                Сравнить планы
              </Button>
            </Stack>

            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' },
                borderTop: '1px solid rgba(247,243,234,0.16)',
                borderLeft: { md: '1px solid rgba(247,243,234,0.16)' },
              }}
            >
              {landingPricingCards.map((plan) => (
                <PricingColumn key={plan.slug} plan={plan} />
              ))}
            </Box>
          </Box>
        </Container>
      </Box>

      <Container maxWidth="xl" sx={{ py: { xs: 7, md: 10 } }}>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: '1fr auto' },
            gap: { xs: 3, md: 5 },
            alignItems: 'end',
          }}
        >
          <Stack spacing={2}>
            <Typography
              variant="h2"
              sx={{
                letterSpacing: 0,
                maxWidth: 780,
                fontSize: { xs: '2.25rem', md: '4rem' },
              }}
            >
              Перенесите рабочие знания туда, где их действительно можно найти
            </Typography>
            <Typography color="text.secondary" sx={{ maxWidth: 560, lineHeight: 1.7 }}>
              Регистрация занимает пару минут. Начать можно с личного пространства и подключить
              команду позже.
            </Typography>
          </Stack>
          <Button href={primaryHref} size="large" sx={{ minHeight: 50 }} endIcon={<ArrowRightOutlinedIcon />}>
            {primaryLabel}
          </Button>
        </Box>
      </Container>

      <PublicFooter />
    </Box>
  )
}

function TrustLine({ children }: { children: ReactNode }) {
  return (
    <Stack direction="row" spacing={1} alignItems="center">
      <Box
        aria-hidden
        sx={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          bgcolor: '#14b8a6',
          boxShadow: '0 0 18px rgba(20,184,166,0.7)',
        }}
      />
      <Typography variant="body2" sx={{ color: 'inherit' }}>
        {children}
      </Typography>
    </Stack>
  )
}

function HeroWorkspaceSurface() {
  return (
    <Box
      sx={{
        minHeight: { xs: 170, sm: 470, lg: 560 },
        position: 'relative',
        overflow: { xs: 'hidden', sm: 'visible' },
        borderRadius: { xs: 2, sm: 0 },
        animation: 'anSurfaceFloat 6s ease-in-out infinite',
      }}
    >
      <Box
        sx={{
          position: 'absolute',
          inset: { xs: '0 0 auto 0', lg: '4% 0 auto 2%' },
          borderRadius: 2,
          overflow: 'hidden',
          border: '1px solid rgba(247,243,234,0.16)',
          boxShadow: '0 40px 110px rgba(0,0,0,0.4)',
          backgroundColor: '#f7f3ea',
          color: '#121416',
        }}
      >
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '86px 1fr', sm: '176px 1fr' },
            minHeight: { xs: 220, sm: 430, lg: 510 },
          }}
        >
          <Box
            sx={{
              p: { xs: 1.4, sm: 2 },
              borderRight: '1px solid rgba(18,20,22,0.1)',
              backgroundColor: '#ebe5d8',
            }}
          >
            <Typography
              sx={{
                mb: 2,
                fontWeight: 700,
                fontSize: { xs: '0.82rem', sm: '0.95rem' },
              }}
            >
              Клиенты
            </Typography>
            <SurfaceNav active label="Ромашка" />
            <SurfaceNav label="ТехноПром" />
            <SurfaceNav label="Лаборатория" />
            <Divider sx={{ my: 2 }} />
            <Typography variant="caption" sx={{ color: 'rgba(18,20,22,0.5)' }}>
              Материалы
            </Typography>
            <SurfaceNav label="Брифы" />
            <SurfaceNav label="Договоры" />
            <SurfaceNav label="Схемы" />
          </Box>

          <Box sx={{ p: { xs: 2, sm: 3 }, position: 'relative' }}>
            <Typography variant="caption" sx={{ color: 'rgba(18,20,22,0.52)' }}>
              Рабочее пространство / ООО Ромашка
            </Typography>
            <Typography
              sx={{
                mt: 0.7,
                fontSize: { xs: '1.05rem', sm: '1.9rem', lg: '2.25rem' },
                lineHeight: 1.08,
                fontWeight: 700,
                maxWidth: 520,
              }}
            >
              Карточка клиента, договоры и история решений
            </Typography>

            <Box
              sx={{
                mt: { xs: 2, sm: 3 },
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', sm: '1.2fr 0.8fr' },
                gap: 2,
              }}
            >
              <Stack spacing={1.2}>
                <SurfaceLine width="92%" />
                <SurfaceLine width="78%" />
                <SurfaceLine width="86%" />
                <Box sx={{ pt: 1 }}>
                  <Stack direction="row" flexWrap="wrap" gap={1}>
                    <SurfacePill>договор.pdf</SurfacePill>
                    <SurfacePill>бриф.docx</SurfacePill>
                    <SurfacePill>схема</SurfacePill>
                  </Stack>
                </Box>
              </Stack>

              <Box
                sx={{
                  p: 2,
                  border: '1px solid rgba(15,118,110,0.24)',
                  backgroundColor: 'rgba(15,118,110,0.08)',
                  borderRadius: 2,
                  position: 'relative',
                  overflow: 'hidden',
                  '&::after': {
                    content: '""',
                    position: 'absolute',
                    inset: 0,
                    width: '42%',
                    background:
                      'linear-gradient(90deg, transparent, rgba(255,255,255,0.75), transparent)',
                    animation: 'anScan 2.8s ease-in-out infinite',
                  },
                }}
              >
                <Stack direction="row" spacing={1} alignItems="center">
                  <SearchIcon fontSize="small" />
                  <Typography variant="caption" fontWeight={700}>
                    AI-ответ
                  </Typography>
                </Stack>
                <Typography variant="body2" sx={{ mt: 1.2, lineHeight: 1.55 }}>
                  Последний договор подписан 12 марта. В апреле нужно согласовать макет главной и
                  подготовить отчет.
                </Typography>
              </Box>
            </Box>

            <Box
              sx={{
                position: 'absolute',
                right: { xs: 14, sm: 26 },
                bottom: { xs: 14, sm: 26 },
                  display: { xs: 'none', sm: 'flex' },
                alignItems: 'center',
                gap: 1,
                px: 1.5,
                py: 1,
                borderRadius: 1,
                bgcolor: '#121416',
                color: '#f7f3ea',
                boxShadow: '0 18px 40px rgba(0,0,0,0.22)',
              }}
            >
              <AccountTreeIcon fontSize="small" />
              <Typography variant="caption">контекст найден в 4 источниках</Typography>
            </Box>
          </Box>
        </Box>
      </Box>
    </Box>
  )
}

function SurfaceNav({ label, active = false }: { label: string; active?: boolean }) {
  return (
    <Box
      sx={{
        mt: 0.7,
        px: 1,
        py: 0.75,
        borderRadius: 1,
        bgcolor: active ? '#121416' : 'transparent',
        color: active ? '#f7f3ea' : 'rgba(18,20,22,0.74)',
      }}
    >
      <Typography variant="caption" noWrap>
        {label}
      </Typography>
    </Box>
  )
}

function SurfaceLine({ width }: { width: string }) {
  return (
    <Box
      sx={{
        width,
        height: 12,
        borderRadius: 1,
        backgroundColor: 'rgba(18,20,22,0.12)',
      }}
    />
  )
}

function SurfacePill({ children }: { children: ReactNode }) {
  return (
    <Box
      sx={{
        px: 1,
        py: 0.55,
        borderRadius: 1,
        bgcolor: 'rgba(18,20,22,0.08)',
        border: '1px solid rgba(18,20,22,0.1)',
      }}
    >
      <Typography variant="caption">{children}</Typography>
    </Box>
  )
}

function SectionIntro({
  eyebrow,
  title,
  body,
}: {
  eyebrow: string
  title: string
  body: string
}) {
  return (
    <Stack spacing={2}>
      <Typography
        sx={{
          fontFamily: 'var(--font-geist-mono), ui-monospace, monospace',
          letterSpacing: 0,
          color: 'text.secondary',
          textTransform: 'uppercase',
          fontSize: '0.76rem',
        }}
      >
        {eyebrow}
      </Typography>
      <Typography
        variant="h2"
        sx={{
          letterSpacing: 0,
          maxWidth: 840,
          fontSize: { xs: '2.1rem', md: '3.5rem' },
          lineHeight: 1.05,
        }}
      >
        {title}
      </Typography>
      <Typography color="text.secondary" sx={{ maxWidth: 660, lineHeight: 1.7 }}>
        {body}
      </Typography>
    </Stack>
  )
}

function MarketFitRow({
  value,
  title,
  body,
}: {
  value: string
  title: string
  body: string
}) {
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', md: '180px 0.85fr 1fr' },
        gap: { xs: 1.5, md: 4 },
        py: { xs: 3, md: 4.2 },
        borderBottom: '1px solid',
        borderColor: 'divider',
        alignItems: 'baseline',
      }}
    >
      <Typography
        sx={{
          fontFamily: 'var(--font-geist-mono), ui-monospace, monospace',
          color: 'primary.main',
          fontSize: '0.95rem',
        }}
      >
        {value}
      </Typography>
      <Typography variant="h5" sx={{ fontWeight: 700 }}>
        {title}
      </Typography>
      <Typography color="text.secondary" sx={{ lineHeight: 1.7 }}>
        {body}
      </Typography>
    </Box>
  )
}

function WorkspaceMode({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof DescriptionIcon
  title: string
  body: string
}) {
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '36px 1fr', md: '48px 0.55fr 1fr' },
        gap: { xs: 2, md: 3 },
        py: { xs: 3, md: 4 },
        alignItems: 'start',
        transition: 'transform 180ms ease, color 180ms ease',
        '&:hover': { transform: { md: 'translateX(8px)' } },
      }}
    >
      <Box
        sx={{
          width: 36,
          height: 36,
          display: 'grid',
          placeItems: 'center',
          borderRadius: 1,
          bgcolor: 'rgba(15,118,110,0.1)',
          color: 'primary.main',
        }}
      >
        <Icon fontSize="small" />
      </Box>
      <Typography variant="h5" sx={{ fontWeight: 700 }}>
        {title}
      </Typography>
      <Typography color="text.secondary" sx={{ lineHeight: 1.7 }}>
        {body}
      </Typography>
    </Box>
  )
}

function WorkflowStep({ index, children }: { index: number; children: ReactNode }) {
  return (
    <Stack direction="row" spacing={1.5} alignItems="flex-start">
      <Box
        sx={{
          width: 28,
          height: 28,
          flexShrink: 0,
          display: 'grid',
          placeItems: 'center',
          borderRadius: '50%',
          bgcolor: '#121416',
          color: '#f7f3ea',
        }}
      >
        <Typography variant="caption">{index}</Typography>
      </Box>
      <Typography sx={{ pt: 0.25, lineHeight: 1.55 }}>{children}</Typography>
    </Stack>
  )
}

function AiAnswerPanel() {
  return (
    <Paper
      elevation={0}
      sx={{
        p: { xs: 2.5, md: 3 },
        borderRadius: 2,
        border: '1px solid rgba(18,20,22,0.12)',
        backgroundColor: 'background.paper',
        boxShadow: '0 26px 70px rgba(18,20,22,0.08)',
      }}
    >
      <Box
        sx={{
          p: { xs: 2.5, md: 3 },
          borderRadius: 2,
          backgroundColor: '#121416',
          color: '#f7f3ea',
          position: 'relative',
          overflow: 'hidden',
          '&::after': {
            content: '""',
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: '-30%',
            width: '30%',
            background: 'linear-gradient(90deg, transparent, rgba(20,184,166,0.26), transparent)',
            animation: 'anScan 3.4s ease-in-out infinite',
          },
        }}
      >
        <Stack direction="row" spacing={1.2} alignItems="center">
          <SearchIcon fontSize="small" />
          <Typography sx={{ fontWeight: 700 }}>Что мы обещали клиенту в марте?</Typography>
        </Stack>
      </Box>

      <Stack spacing={2.4} sx={{ mt: 3 }}>
        <Typography sx={{ fontSize: { xs: '1.15rem', md: '1.4rem' }, lineHeight: 1.45 }}>
          В марте команда согласовала редизайн сайта, запуск рекламной кампании и еженедельные
          отчеты. Крайний срок первого макета: 25 апреля.
        </Typography>
        <Divider />
        <Stack spacing={1.2}>
          {['Договор №14 от 12.03', 'Бриф проекта', 'Заметка встречи от 18.03'].map((source) => (
            <Stack key={source} direction="row" spacing={1.2} alignItems="center">
              <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'primary.main' }} />
              <Typography color="text.secondary">{source}</Typography>
            </Stack>
          ))}
        </Stack>
      </Stack>
    </Paper>
  )
}

function PricingColumn({ plan }: { plan: (typeof landingPricingCards)[number] }) {
  const isPrimary = plan.slug === 'pro'

  return (
    <Link href="/pricing" style={{ color: 'inherit', textDecoration: 'none' }}>
      <Box
        sx={{
          minHeight: 310,
          p: { xs: 3, md: 3.5 },
          borderRight: { md: '1px solid rgba(247,243,234,0.16)' },
          borderBottom: '1px solid rgba(247,243,234,0.16)',
          bgcolor: isPrimary ? 'rgba(20,184,166,0.12)' : 'transparent',
          transition: 'background-color 180ms ease, transform 180ms ease',
          '&:hover': {
            bgcolor: isPrimary ? 'rgba(20,184,166,0.16)' : 'rgba(247,243,234,0.06)',
            transform: { md: 'translateY(-6px)' },
          },
        }}
      >
        <Stack spacing={2} sx={{ minHeight: 250 }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={2}>
            <Typography variant="h5" sx={{ fontWeight: 700 }}>
              {plan.name}
            </Typography>
            {isPrimary && (
              <Typography
                variant="caption"
                sx={{
                  px: 1,
                  py: 0.45,
                  borderRadius: 1,
                  bgcolor: '#f7f3ea',
                  color: '#121416',
                }}
              >
                популярный
              </Typography>
            )}
          </Stack>
          <Typography variant="h3" sx={{ letterSpacing: 0, fontSize: { xs: '2rem', md: '2.4rem' } }}>
            {plan.price}
          </Typography>
          <Stack spacing={1} sx={{ pt: 1 }}>
            {plan.features.map((item) => (
              <Typography key={item} sx={{ color: 'rgba(247,243,234,0.72)' }}>
                {item}
              </Typography>
            ))}
          </Stack>
          <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mt: 'auto' }}>
            <Typography>Подробнее</Typography>
            <ArrowRightOutlinedIcon fontSize="small" />
          </Stack>
        </Stack>
      </Box>
    </Link>
  )
}
