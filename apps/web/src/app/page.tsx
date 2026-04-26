import type { Metadata } from "next"
import Link from "next/link"

import { Box, Button, Container, Divider, Paper, Stack, Typography } from "@repo/ui/components"

import { landingPricingCards } from "@/components/public/content"
import { PublicFooter } from "@/components/public/public-footer"
import { PublicHeader } from "@/components/public/public-header"
import { getSession } from "@/lib/get-session"

const benefitCards = [
  {
    title: "Всё в одном пространстве",
    body: "Документы, заметки, схемы, файлы клиентов — больше не разбросаны по Google Docs, чатам и папкам на рабочем столе. Один вход — вся работа команды под рукой.",
  },
  {
    title: "Спросил — нашёл",
    body: "Задаёте вопрос обычными словами: «какие договоры мы заключили в марте», «что обсуждали с клиентом». Ответ приходит из ваших документов, а не из гугла.",
  },
  {
    title: "Одна ссылка вместо десяти вложений",
    body: "Нужно показать клиенту документ, бриф, схему работ? Отправляете одну ссылку — он видит всё в нормальном виде, без регистраций и PDF-экспортов.",
  },
]

export const metadata: Metadata = {
  title: "AnyNote",
}

export default async function HomePage() {
  const session = await getSession()

  const primaryHref = session ? "/app" : "/registration"
  const primaryLabel = session ? "Открыть рабочее пространство" : "Начать бесплатно"

  return (
    <Box
      component="main"
      sx={{
        minHeight: "100vh",
        color: "text.primary",
        background:
          "radial-gradient(circle at 16% 12%, rgba(15, 118, 110, 0.08), transparent 24%)",
      }}
    >
      <Container maxWidth="xl" sx={{ position: "relative", pb: { xs: 9, md: 12 } }}>
        <PublicHeader session={session} />

        <Box
          sx={{
            pt: { xs: 5, md: 8 },
            display: "grid",
            gridTemplateColumns: { xs: "1fr", lg: "minmax(0, 1fr) minmax(0, 1fr)" },
            gap: { xs: 5, lg: 6 },
            alignItems: "center",
          }}
        >
          <Stack spacing={3.5}>
            <Typography
              variant="h1"
              sx={{
                fontSize: { xs: "2.3rem", sm: "2.9rem", md: "3.5rem" },
                lineHeight: 1.1,
                maxWidth: 680,
              }}
            >
              Документы команды — в одном месте. И они находятся за секунды.
            </Typography>
            <Typography
              color="text.secondary"
              sx={{
                maxWidth: 600,
                lineHeight: 1.6,
                fontSize: { xs: "1rem", md: "1.12rem" },
              }}
            >
              Собирайте заметки, файлы и рабочие материалы в общем пространстве. Задавайте вопрос —
              получайте ответ из ваших документов.
            </Typography>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
              <Button href={primaryHref} size="large">
                {primaryLabel}
              </Button>
              {!session && (
                <Button href="/sign-in" variant="outlined" color="inherit" size="large">
                  Войти
                </Button>
              )}
            </Stack>
          </Stack>

          <HeroPreview />
        </Box>

        <SectionHeader eyebrow="Что вы получаете">
          Команда перестаёт терять документы и тратить часы на поиск
        </SectionHeader>

        <Box
          sx={{
            mt: 4,
            display: "grid",
            gridTemplateColumns: { xs: "1fr", md: "repeat(3, minmax(0, 1fr))" },
            gap: 3,
          }}
        >
          {benefitCards.map((card) => (
            <Paper
              key={card.title}
              elevation={0}
              sx={{
                p: { xs: 3, md: 3.5 },
                borderRadius: 4,
                border: "1px solid rgba(148,163,184,0.18)",
                backgroundColor: "background.paper",
              }}
            >
              <Stack spacing={1.5}>
                <Typography variant="h5">{card.title}</Typography>
                <Typography color="text.secondary" sx={{ lineHeight: 1.6 }}>
                  {card.body}
                </Typography>
              </Stack>
            </Paper>
          ))}
        </Box>

        <SectionHeader eyebrow="Как это выглядит">
          Пример: карточка клиента в агентстве
        </SectionHeader>

        <Box sx={{ mt: 4 }}>
          <DetailedPreview />
        </Box>

        <SectionHeader eyebrow="Тарифы">
          Выберите план, который подходит команде
        </SectionHeader>

        <Box
          sx={{
            mt: 4,
            display: "grid",
            gridTemplateColumns: {
              xs: "1fr",
              md: "repeat(2, minmax(0, 1fr))",
              xl: "repeat(4, minmax(0, 1fr))",
            },
            gap: 3,
          }}
        >
          {landingPricingCards.map((plan) => {
            const isPrimary = plan.slug === "pro"
            return (
              <Link key={plan.slug} href="/pricing" style={{ textDecoration: "none" }}>
                <Paper
                  elevation={0}
                  sx={{
                    p: 3.5,
                    borderRadius: 4,
                    minHeight: 360,
                    color: "text.primary",
                    display: "flex",
                    textDecoration: "none",
                    border: isPrimary
                      ? "1px solid rgba(15, 118, 110, 0.34)"
                      : "1px solid rgba(148,163,184,0.18)",
                    backgroundColor: "background.paper",
                    backgroundImage: isPrimary
                      ? "linear-gradient(180deg, rgba(15, 118, 110, 0.10) 0%, rgba(255,255,255,0.03) 100%)"
                      : "none",
                    boxShadow: isPrimary ? "0 18px 42px rgba(15, 118, 110, 0.10)" : "none",
                  }}
                >
                  <Stack spacing={2} sx={{ width: "100%" }}>
                    <Typography variant="h5">{plan.name}</Typography>
                    <Typography variant="h2" sx={{ fontSize: "3rem" }}>
                      {plan.price}
                    </Typography>
                    <Divider />
                    <Stack spacing={1.2}>
                      {plan.features.map((item) => (
                        <Typography key={item} color="text.secondary">
                          • {item}
                        </Typography>
                      ))}
                    </Stack>
                    <Box sx={{ pt: 1, mt: "auto" }}>
                      <Button
                        component="span"
                        variant={isPrimary ? "contained" : "outlined"}
                        color={isPrimary ? "primary" : "inherit"}
                        fullWidth
                      >
                        Смотреть тариф
                      </Button>
                    </Box>
                  </Stack>
                </Paper>
              </Link>
            )
          })}
        </Box>

        <Paper
          elevation={0}
          sx={{
            mt: { xs: 8, md: 11 },
            p: { xs: 4, md: 6 },
            borderRadius: 4,
            border: "1px solid rgba(148,163,184,0.18)",
            backgroundColor: "background.paper",
            textAlign: "center",
          }}
        >
          <Stack spacing={2.5} alignItems="center">
            <Typography variant="h2" sx={{ fontSize: { xs: "2rem", md: "2.6rem" } }}>
              Начните за 2 минуты
            </Typography>
            <Typography color="text.secondary" sx={{ maxWidth: 520 }}>
              Регистрация бесплатная. Банковская карта не нужна.
            </Typography>
            <Button href={primaryHref} size="large" sx={{ mt: 1 }}>
              {primaryLabel}
            </Button>
          </Stack>
        </Paper>
      </Container>
      <PublicFooter />
    </Box>
  )
}

function SectionHeader({ eyebrow, children }: { eyebrow: string; children: React.ReactNode }) {
  return (
    <Stack spacing={1.5} sx={{ mt: { xs: 8, md: 11 } }}>
      <Typography variant="overline" color="text.secondary">
        {eyebrow}
      </Typography>
      <Typography
        variant="h2"
        sx={{ maxWidth: 780, fontSize: { xs: "1.9rem", md: "2.6rem" }, lineHeight: 1.2 }}
      >
        {children}
      </Typography>
    </Stack>
  )
}

function HeroPreview() {
  return (
    <Paper
      elevation={0}
      sx={{
        p: 2,
        borderRadius: 4,
        border: "1px solid rgba(148,163,184,0.22)",
        backgroundColor: "background.paper",
        boxShadow: "0 24px 60px rgba(15, 23, 42, 0.08)",
      }}
    >
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "116px 1fr", sm: "148px 1fr" },
          gap: 1.5,
          minHeight: 340,
        }}
      >
        <Box
          sx={{
            borderRadius: 3,
            backgroundColor: "rgba(148,163,184,0.08)",
            p: 1.5,
          }}
        >
          <SidebarGroup title="Клиенты" activeIndex={0} items={["ООО «Ромашка»", "ИП Иванов", "ООО «ТехноПром»"]} />
          <Box sx={{ mt: 2 }}>
            <SidebarGroup title="Задачи" items={["На неделю", "В работе"]} />
          </Box>
        </Box>

        <Box sx={{ p: { xs: 1, sm: 1.5 } }}>
          <Typography variant="caption" color="text.secondary">
            Клиенты / ООО «Ромашка»
          </Typography>
          <Typography sx={{ mt: 0.5, fontSize: { xs: "1.05rem", sm: "1.2rem" }, fontWeight: 700 }}>
            Карточка клиента
          </Typography>
          <Divider sx={{ my: 1.5 }} />
          <Stack spacing={1.5}>
            <PreviewField label="Контактное лицо" value="Петров Иван · +7 (999) 123-45-67" />
            <PreviewField label="Договоры" value="Договор №14 от 12.03 · Допсоглашение №1" />
            <PreviewField label="Файлы" value="договор.pdf · бриф.docx · схема.холст" />
          </Stack>
        </Box>
      </Box>
    </Paper>
  )
}

function DetailedPreview() {
  return (
    <Paper
      elevation={0}
      sx={{
        p: { xs: 2, md: 3 },
        borderRadius: 4,
        border: "1px solid rgba(148,163,184,0.22)",
        backgroundColor: "background.paper",
        boxShadow: "0 24px 60px rgba(15, 23, 42, 0.06)",
      }}
    >
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", md: "200px 1fr" },
          gap: { xs: 2, md: 3 },
        }}
      >
        <Box
          sx={{
            borderRadius: 3,
            backgroundColor: "rgba(148,163,184,0.06)",
            p: 2,
            display: { xs: "none", md: "block" },
          }}
        >
          <SidebarGroup title="Клиенты" activeIndex={0} items={["ООО «Ромашка»", "ИП Иванов", "ООО «ТехноПром»"]} />
          <Box sx={{ mt: 2.5 }}>
            <SidebarGroup title="Задачи" items={["На неделю", "В работе", "Архив"]} />
          </Box>
          <Box sx={{ mt: 2.5 }}>
            <SidebarGroup title="Шаблоны" items={["Бриф", "Договор", "Отчёт"]} />
          </Box>
        </Box>

        <Box sx={{ p: { xs: 1, md: 2 } }}>
          <Typography variant="caption" color="text.secondary">
            Клиенты / ООО «Ромашка»
          </Typography>
          <Typography
            variant="h4"
            sx={{ mt: 0.5, fontSize: { xs: "1.4rem", md: "1.8rem" }, fontWeight: 700 }}
          >
            ООО «Ромашка» — карточка клиента
          </Typography>
          <Divider sx={{ my: 2 }} />

          <Stack spacing={2.5}>
            <DocSection title="Контакты">
              <Typography variant="body2">Петров Иван Сергеевич — директор</Typography>
              <Typography variant="body2" color="text.secondary">
                +7 (999) 123-45-67 · petrov@romashka.ru
              </Typography>
            </DocSection>

            <DocSection title="История работ">
              <Typography variant="body2">
                Март 2026 — редизайн сайта, запуск рекламной кампании.
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Февраль 2026 — SEO-аудит, техническое задание.
              </Typography>
            </DocSection>

            <DocSection title="Договоры и файлы">
              <Stack direction="row" flexWrap="wrap" gap={1}>
                {[
                  "договор №14.pdf",
                  "допсоглашение №1.pdf",
                  "бриф.docx",
                  "схема взаимодействия",
                ].map((file) => (
                  <FilePill key={file} label={file} />
                ))}
              </Stack>
            </DocSection>

            <DocSection title="Открытые задачи">
              <Stack spacing={0.75}>
                <TaskRow text="Согласовать макет главной" due="до 25.04" />
                <TaskRow text="Подготовить отчёт за март" due="до 28.04" />
              </Stack>
            </DocSection>
          </Stack>
        </Box>
      </Box>
    </Paper>
  )
}

function SidebarGroup({
  title,
  items,
  activeIndex,
}: {
  title: string
  items: string[]
  activeIndex?: number
}) {
  return (
    <Box>
      <Typography
        variant="caption"
        sx={{
          color: "text.secondary",
          fontWeight: 700,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          display: "block",
        }}
      >
        {title}
      </Typography>
      <Stack spacing={0.5} sx={{ mt: 1 }}>
        {items.map((item, i) => {
          const isActive = i === activeIndex
          return (
            <Box
              key={item}
              sx={{
                px: 1,
                py: 0.6,
                borderRadius: 1.5,
                backgroundColor: isActive ? "rgba(15,118,110,0.10)" : "transparent",
                border: isActive
                  ? "1px solid rgba(15,118,110,0.22)"
                  : "1px solid transparent",
              }}
            >
              <Typography
                variant="caption"
                sx={{
                  color: isActive ? "primary.main" : "text.primary",
                  fontWeight: isActive ? 600 : 400,
                }}
              >
                {item}
              </Typography>
            </Box>
          )
        })}
      </Stack>
    </Box>
  )
}

function PreviewField({ label, value }: { label: string; value: string }) {
  return (
    <Box>
      <Typography
        variant="caption"
        sx={{
          color: "text.secondary",
          textTransform: "uppercase",
          fontWeight: 700,
          letterSpacing: "0.06em",
        }}
      >
        {label}
      </Typography>
      <Typography variant="body2" sx={{ mt: 0.25 }}>
        {value}
      </Typography>
    </Box>
  )
}

function DocSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Box>
      <Typography
        variant="caption"
        sx={{
          color: "text.secondary",
          textTransform: "uppercase",
          fontWeight: 700,
          letterSpacing: "0.08em",
          display: "block",
          mb: 0.75,
        }}
      >
        {title}
      </Typography>
      <Stack spacing={0.5}>{children}</Stack>
    </Box>
  )
}

function FilePill({ label }: { label: string }) {
  return (
    <Box
      sx={{
        px: 1.25,
        py: 0.5,
        borderRadius: 2,
        backgroundColor: "rgba(148,163,184,0.10)",
        border: "1px solid rgba(148,163,184,0.18)",
      }}
    >
      <Typography variant="caption">{label}</Typography>
    </Box>
  )
}

function TaskRow({ text, due }: { text: string; due: string }) {
  return (
    <Stack direction="row" spacing={1.2} alignItems="center">
      <Box
        sx={{
          width: 14,
          height: 14,
          borderRadius: "4px",
          border: "1.5px solid rgba(148,163,184,0.5)",
          flexShrink: 0,
        }}
      />
      <Typography variant="body2" sx={{ flexGrow: 1 }}>
        {text}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        {due}
      </Typography>
    </Stack>
  )
}
