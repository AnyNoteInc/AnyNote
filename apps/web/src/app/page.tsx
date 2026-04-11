import type { Metadata } from "next"

import {
  Box,
  Button,
  Chip,
  Container,
  Divider,
  Paper,
  Stack,
  Typography,
} from "@repo/ui/components"

import { pricingCards } from "@/components/public/content"
import { PublicFooter } from "@/components/public/public-footer"
import { PublicHeader } from "@/components/public/public-header"
import { getSession } from "@/lib/get-session"

const featureCards = [
  {
    title: "Markdown-first редактор",
    body: "Каждая страница живет как Markdown-документ, но выглядит как polished block-editor уровня Notion",
    marker: "MD",
  },
  {
    title: "Медиа без трения",
    body: "Изображения, PDF, аудио, текстовые файлы и вложения собираются в одном контексте документа",
    marker: "FX",
  },
  {
    title: "AI и RAG поверх знаний",
    body: "Поиск и промпты работают не по общим словам, а по индексированной базе реальных документов команды",
    marker: "AI",
  },
]

const proofItems = ["Yandex / Email auth", "Public sharing", "SaaS + On-Prem", "Dark / Light"]

const comparisonRows = [
  {
    title: "Markdown как исходный формат",
    anynote: "Нативная модель документа и чистый экспорт",
    notion: "Блоки удобны, но не markdown-first",
    obsidian: "Сильный markdown, слабее командный SaaS-слой",
  },
  {
    title: "Командная база знаний",
    anynote: "SaaS-подход, роли, публичные ссылки, AI поверх workspace",
    notion: "Сильная совместная работа, но тяжелее локальная и on-prem модель",
    obsidian: "Отличен для personal knowledge, сложнее для командного стандарта",
  },
  {
    title: "Инсталляция",
    anynote: "Одна продуктовая модель для cloud и on-prem",
    notion: "Только cloud",
    obsidian: "Локальный-first, но без полноценного SaaS-опыта из коробки",
  },
]

const distributionCards = [
  {
    title: "SaaS",
    pluses: "Мгновенный старт, обновления без участия команды, быстрый onboarding",
    minuses: "Ниже контроль над инфраструктурой и комплаенс-контуром",
    accent: "Для команд, которым важна скорость запуска",
  },
  {
    title: "On-Prem",
    pluses: "Полный контроль над данными, контуром безопасности и сетевым доступом",
    minuses: "Выше стоимость владения и длиннее цикл внедрения",
    accent: "Для enterprise и regulated environments",
  },
]

const urgencyPoints = [
  "Не теряйте контекст между Notion, Obsidian, Google Docs и файловыми папками",
  "Соберите AI-поиск поверх документов до того, как база знаний снова расползется",
  "Подготовьте платформу, которую можно продать как SaaS и внедрять как On-Prem",
]

export const metadata: Metadata = {
  title: "AnyNote",
}

export default async function HomePage() {
  const session = await getSession()

  return (
    <Box
      component="main"
      sx={{
        minHeight: "100vh",
        color: "text.primary",
        background:
          "radial-gradient(circle at 14% 16%, rgba(15, 118, 110, 0.12), transparent 18%), linear-gradient(180deg, rgba(7, 18, 24, 0.05) 0%, transparent 44%, rgba(255,255,255,0.02) 100%)",
      }}
    >
      <Box
        sx={{
          position: "fixed",
          inset: 0,
          pointerEvents: "none",
          opacity: 0.14,
          backgroundImage:
            "linear-gradient(rgba(148,163,184,0.12) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.12) 1px, transparent 1px)",
          backgroundSize: "42px 42px",
          maskImage:
            "linear-gradient(180deg, rgba(0,0,0,0.92), rgba(0,0,0,0.56) 42%, transparent 100%)",
        }}
      />

      <Container maxWidth="xl" sx={{ position: "relative", pb: { xs: 9, md: 14 } }}>
        <PublicHeader session={session} />

        <Box
          sx={{
            pt: { xs: 4, md: 7 },
            display: "grid",
            gridTemplateColumns: { xs: "1fr", xl: "minmax(0, 1.2fr) 430px" },
            gap: { xs: 5, xl: 4 },
            alignItems: "start",
          }}
        >
          <Stack spacing={4.5}>
            <Stack spacing={2.5} sx={{ maxWidth: 920 }}>
              <Chip
                label="Российский SaaS knowledge workspace нового поколения"
                sx={{
                  alignSelf: "flex-start",
                  borderRadius: 4,
                  height: 38,
                  px: 1.2,
                  backdropFilter: "blur(10px)",
                  color: "text.primary",
                  backgroundColor: "rgba(247,250,248,0.78)",
                  border: "1px solid rgba(148,163,184,0.18)",
                }}
              />
              <Typography
                variant="h1"
                sx={{
                  maxWidth: 1040,
                  fontSize: { xs: "3.2rem", sm: "4.7rem", md: "6.8rem" },
                }}
              >
                Notion-уровень интерфейса, Obsidian-уровень контроля, один продукт для вашей базы
                знаний
              </Typography>
              <Typography
                variant="h6"
                color="text.secondary"
                sx={{
                  maxWidth: 760,
                  lineHeight: 1.6,
                  fontSize: { xs: "1.02rem", md: "1.18rem" },
                }}
              >
                AnyNote создается как SaaS-платформа для команд, которым нужен markdown-first
                редактор, удобные блоки как в Notion, медиа, public sharing и AI-поиск поверх
                документов, а не поверх хаоса.
              </Typography>
            </Stack>

            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <Button href={session ? "/app" : "/registration"} size="large">
                {session ? "Открыть рабочее пространство" : "Начать бесплатно"}
              </Button>
              <Button href="/sign-in" variant="outlined" color="inherit" size="large">
                Запросить демо и войти
              </Button>
            </Stack>

            <Stack direction="row" flexWrap="wrap" gap={1.25}>
              {proofItems.map((item) => (
                <Chip
                  key={item}
                  label={item}
                  variant="outlined"
                  sx={{
                    borderRadius: 4,
                    backgroundColor: "rgba(247,250,248,0.74)",
                    borderColor: "rgba(148,163,184,0.18)",
                  }}
                />
              ))}
            </Stack>
          </Stack>

          <Paper
            elevation={0}
            sx={{
              p: 2.5,
              borderRadius: 4,
              border: "1px solid rgba(148,163,184,0.14)",
              background:
                "linear-gradient(180deg, rgba(16, 28, 33, 0.96) 0%, rgba(11, 21, 26, 0.98) 100%)",
              boxShadow: "0 18px 48px rgba(10, 18, 22, 0.18)",
              transform: { xl: "translateY(28px)" },
            }}
          >
            <Stack spacing={2.25}>
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Typography variant="overline" color="rgba(226,232,240,0.72)">
                  Live preview
                </Typography>
                <Typography variant="body2" color="rgba(226,232,240,0.58)">
                  md + blocks + ai
                </Typography>
              </Stack>

              <Paper
                elevation={0}
                sx={{
                  p: 2.5,
                  borderRadius: 4,
                  border: "1px solid rgba(148,163,184,0.14)",
                  backgroundColor: "rgba(255,255,255,0.03)",
                }}
              >
                <Stack spacing={2}>
                  <Typography variant="h6" fontWeight={800} sx={{ color: "#f8fafc" }}>
                    Product memory / launch brief
                  </Typography>
                  <Typography color="rgba(226,232,240,0.74)">
                    Документ выглядит как polished editor, хранится как понятный markdown-слой и
                    сразу готов для поиска, prompt actions и внешнего шаринга.
                  </Typography>
                  <Divider sx={{ borderColor: "rgba(148,163,184,0.12)" }} />
                  <Stack spacing={1.1}>
                    {[
                      "Slash-команды и визуальные блоки",
                      "Вложения: PDF, audio, images, text",
                      "RAG-индексация и AI prompts",
                      "Публичные ссылки для внешней аудитории",
                    ].map((item) => (
                      <Stack key={item} direction="row" spacing={1.2} alignItems="center">
                        <Box
                          sx={{
                            width: 8,
                            height: 8,
                            borderRadius: 999,
                            background: "#0f766e",
                          }}
                        />
                        <Typography variant="body2" color="rgba(241,245,249,0.88)">
                          {item}
                        </Typography>
                      </Stack>
                    ))}
                  </Stack>
                </Stack>
              </Paper>

              <Box
                sx={{
                  display: "grid",
                  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                  gap: 1.5,
                }}
              >
                {featureCards.map((card) => {
                  return (
                    <Paper
                      key={card.title}
                      elevation={0}
                      sx={{
                        p: 2,
                        borderRadius: 4,
                        minHeight: 156,
                        backgroundColor: "rgba(255,255,255,0.06)",
                        border: "1px solid rgba(148,163,184,0.14)",
                      }}
                    >
                      <Stack spacing={1.4}>
                        <Box
                          sx={{
                            width: 24,
                            height: 24,
                            borderRadius: 4,
                            display: "grid",
                            placeItems: "center",
                            fontSize: 10,
                            fontWeight: 800,
                            letterSpacing: "0.12em",
                            background: "rgba(15,118,110,0.18)",
                          }}
                        >
                          {card.marker}
                        </Box>
                        <Typography fontWeight={700} sx={{ color: "#f8fafc" }}>
                          {card.title}
                        </Typography>
                        <Typography variant="body2" color="rgba(226,232,240,0.74)">
                          {card.body}
                        </Typography>
                      </Stack>
                    </Paper>
                  )
                })}
              </Box>
            </Stack>
          </Paper>
        </Box>

        <Stack spacing={3} sx={{ mt: { xs: 9, md: 12 } }}>
          <Typography variant="overline" color="text.secondary">
            Почему стоит использовать нас вместо связки Notion + Obsidian
          </Typography>
          <Typography variant="h2" sx={{ maxWidth: 840 }}>
            Не просто альтернатива. Более цельная модель для командной памяти, документации и
            AI-поиска
          </Typography>
        </Stack>

        <Box
          sx={{
            mt: 4,
            display: "grid",
            gridTemplateColumns: { xs: "1fr", lg: "1.25fr 0.85fr" },
            gap: 3,
          }}
        >
          <Paper
            elevation={0}
            sx={{
              overflow: "hidden",
              borderRadius: 4,
              border: "1px solid rgba(148,163,184,0.16)",
              backgroundColor: "background.paper",
            }}
          >
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: "1.2fr 1fr 1fr 1fr",
              }}
            >
              {["Критерий", "AnyNote", "Notion", "Obsidian"].map((item) => (
                <Box
                  key={item}
                  sx={{
                    p: 2,
                    borderBottom: "1px solid rgba(148,163,184,0.12)",
                    backgroundColor: "rgba(148,163,184,0.06)",
                  }}
                >
                  <Typography fontWeight={800}>{item}</Typography>
                </Box>
              ))}
              {comparisonRows.flatMap((row) => [
                <Box
                  key={`${row.title}-label`}
                  sx={{
                    p: 2,
                    borderBottom: "1px solid rgba(148,163,184,0.12)",
                  }}
                >
                  <Typography fontWeight={700}>{row.title}</Typography>
                </Box>,
                <Box
                  key={`${row.title}-anynote`}
                  sx={{
                    p: 2,
                    borderBottom: "1px solid rgba(148,163,184,0.12)",
                  }}
                >
                  <Typography color="text.secondary">{row.anynote}</Typography>
                </Box>,
                <Box
                  key={`${row.title}-notion`}
                  sx={{
                    p: 2,
                    borderBottom: "1px solid rgba(148,163,184,0.12)",
                  }}
                >
                  <Typography color="text.secondary">{row.notion}</Typography>
                </Box>,
                <Box
                  key={`${row.title}-obsidian`}
                  sx={{
                    p: 2,
                    borderBottom: "1px solid rgba(148,163,184,0.12)",
                  }}
                >
                  <Typography color="text.secondary">{row.obsidian}</Typography>
                </Box>,
              ])}
            </Box>
          </Paper>

          <Stack spacing={3}>
            {featureCards.map((card, index) => {
              return (
                <Paper
                  key={card.title}
                  elevation={0}
                  sx={{
                    p: 3,
                    borderRadius: 4,
                    border: "1px solid rgba(148,163,184,0.16)",
                    backgroundColor: "background.paper",
                    backgroundImage:
                      index === 1
                        ? "linear-gradient(180deg, rgba(15, 118, 110, 0.10) 0%, rgba(255,255,255,0.02) 100%)"
                        : "none",
                  }}
                >
                  <Stack spacing={1.5}>
                    <Box
                      sx={{
                        width: 26,
                        height: 26,
                        borderRadius: 4,
                        display: "grid",
                        placeItems: "center",
                        fontSize: 10,
                        fontWeight: 800,
                        letterSpacing: "0.12em",
                        background: "rgba(15,118,110,0.18)",
                      }}
                    >
                      {card.marker}
                    </Box>
                    <Typography variant="h6">{card.title}</Typography>
                    <Typography color="text.secondary">{card.body}</Typography>
                  </Stack>
                </Paper>
              )
            })}
          </Stack>
        </Box>

        <Stack spacing={3} sx={{ mt: { xs: 9, md: 12 } }}>
          <Typography variant="overline" color="text.secondary">
            SaaS и On-Prem
          </Typography>
          <Typography variant="h2" sx={{ maxWidth: 820 }}>
            Одна продуктовая линия для cloud-команд и компаний, которым нужен свой контур
          </Typography>
        </Stack>

        <Box
          sx={{
            mt: 4,
            display: "grid",
            gridTemplateColumns: { xs: "1fr", md: "repeat(2, minmax(0, 1fr))" },
            gap: 3,
          }}
        >
          {distributionCards.map((card) => (
            <Paper
              key={card.title}
              elevation={0}
              sx={{
                p: { xs: 3, md: 4 },
                borderRadius: 4,
                border: "1px solid rgba(148,163,184,0.16)",
                backgroundColor: "background.paper",
              }}
            >
              <Stack spacing={2.2}>
                <Typography variant="h4">{card.title}</Typography>
                <Typography fontWeight={700}>{card.accent}</Typography>
                <Divider />
                <Typography color="text.secondary">
                  <strong>Плюсы:</strong> {card.pluses}
                </Typography>
                <Typography color="text.secondary">
                  <strong>Минусы:</strong> {card.minuses}
                </Typography>
              </Stack>
            </Paper>
          ))}
        </Box>

        <Stack spacing={3} sx={{ mt: { xs: 9, md: 12 } }}>
          <Typography variant="overline" color="text.secondary">
            Тарифы
          </Typography>
          <Typography variant="h2" sx={{ maxWidth: 720 }}>
            От бесплатного старта до корпоративного знания как инфраструктуры.
          </Typography>
        </Stack>

        <Box
          sx={{
            mt: 4,
            display: "grid",
            gridTemplateColumns: { xs: "1fr", lg: "repeat(3, minmax(0, 1fr))" },
            gap: 3,
          }}
        >
          {pricingCards.map((plan, index) => (
            <Paper
              key={plan.title}
              elevation={0}
              sx={{
                p: 3.5,
                borderRadius: 4,
                minHeight: 360,
                border:
                  index === 1
                    ? "1px solid rgba(15, 118, 110, 0.34)"
                    : "1px solid rgba(148,163,184,0.16)",
                backgroundColor: "background.paper",
                backgroundImage:
                  index === 1
                    ? "linear-gradient(180deg, rgba(15, 118, 110, 0.12) 0%, rgba(255,255,255,0.03) 100%)"
                    : "none",
                boxShadow: index === 1 ? "0 18px 42px rgba(15, 118, 110, 0.10)" : "none",
              }}
            >
              <Stack spacing={2}>
                <Typography variant="h5">{plan.title}</Typography>
                <Typography variant="h2" sx={{ fontSize: "3.2rem" }}>
                  {plan.price === "Custom" ? plan.price : `$${plan.price}`}
                </Typography>
                <Typography color="text.secondary">{plan.description}</Typography>
                <Divider />
                <Stack spacing={1.2}>
                  {plan.items.map((item) => (
                    <Typography key={item} color="text.secondary">
                      • {item}
                    </Typography>
                  ))}
                </Stack>
                <Box sx={{ pt: 1 }}>
                  <Button
                    href={session ? "/app" : "/registration"}
                    variant={index === 1 ? "contained" : "outlined"}
                    color={index === 1 ? "primary" : "inherit"}
                    fullWidth
                  >
                    Выбрать {plan.title}
                  </Button>
                </Box>
              </Stack>
            </Paper>
          ))}
        </Box>

        <Paper
          elevation={0}
          sx={{
            mt: { xs: 9, md: 12 },
            p: { xs: 3.5, md: 5 },
            borderRadius: 4,
            overflow: "hidden",
            position: "relative",
            background: "linear-gradient(180deg, #101c21 0%, #0b151a 100%)",
            color: "#f8fafc",
          }}
        >
          <Box
            sx={{
              position: "absolute",
              inset: 0,
              background:
                "radial-gradient(circle at top left, rgba(15,118,110,0.18), transparent 18%)",
            }}
          />
          <Box sx={{ position: "relative" }}>
            <Stack
              direction={{ xs: "column", xl: "row" }}
              justifyContent="space-between"
              spacing={4}
              alignItems={{ xs: "flex-start", xl: "center" }}
            >
              <Stack spacing={2} sx={{ maxWidth: 820 }}>
                <Typography variant="overline" color="rgba(248,250,252,0.66)">
                  Почему покупать сейчас
                </Typography>
                <Typography variant="h2" sx={{ color: "#f8fafc" }}>
                  Пока рынок выбирает между Notion и Obsidian, вы можете получить систему, которая
                  ближе к вашему сценарию и модели владения
                </Typography>
                <Stack spacing={1.1}>
                  {urgencyPoints.map((item) => (
                    <Typography key={item} color="rgba(226,232,240,0.84)">
                      • {item}
                    </Typography>
                  ))}
                </Stack>
              </Stack>
              <Stack spacing={1.5} sx={{ minWidth: { xl: 280 } }}>
                <Button href={session ? "/app" : "/registration"} size="large">
                  Начать сейчас
                </Button>
                <Button
                  href="/sign-in"
                  variant="outlined"
                  size="large"
                  sx={{
                    color: "#f8fafc",
                    borderColor: "rgba(248,250,252,0.18)",
                  }}
                >
                  Обсудить внедрение
                </Button>
              </Stack>
            </Stack>
          </Box>
        </Paper>
      </Container>
      <PublicFooter />
    </Box>
  )
}
