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

import { AppUserMenu } from "@/components/app/app-user-menu"
import { requireSession } from "@/lib/get-session"

const navItems = ["Overview", "Documents", "Shared", "Media", "AI Search"]

const quickDrafts = [
  "Product brief / Q2 launch",
  "AI assistant prompts",
  "Customer interview notes",
  "Architecture decisions",
]

export const metadata: Metadata = {
  title: "Рабочее пространство",
}

export default async function AppHomePage() {
  const session = await requireSession()

  return (
    <Box
      component="main"
      sx={{
        minHeight: "100vh",
        background:
          "linear-gradient(180deg, rgba(248, 250, 252, 1) 0%, rgba(240, 249, 255, 1) 100%)",
      }}
    >
      <Box
        sx={{
          borderBottom: "1px solid",
          borderColor: "divider",
          backdropFilter: "blur(12px)",
          backgroundColor: "rgba(255,255,255,0.72)",
          position: "sticky",
          top: 0,
          zIndex: 10,
        }}
      >
        <Container maxWidth="xl" sx={{ py: 2 }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={2}>
            <Stack direction="row" spacing={1.5} alignItems="center">
              <Box
                sx={{
                  width: 36,
                  height: 36,
                  borderRadius: 3,
                  background: "linear-gradient(135deg, #0f766e 0%, #0284c7 55%, #f59e0b 100%)",
                }}
              />
              <Stack spacing={0}>
                <Typography variant="subtitle1" fontWeight={800}>
                  AnyNote
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Workspace
                </Typography>
              </Stack>
            </Stack>
            <AppUserMenu session={session} />
          </Stack>
        </Container>
      </Box>

      <Container maxWidth="xl" sx={{ py: 4 }}>
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", lg: "260px minmax(0, 1fr)" },
            gap: 3,
          }}
        >
          <Paper
            elevation={0}
            sx={{
              p: 2,
              borderRadius: 2,
              border: "1px solid",
              borderColor: "divider",
              alignSelf: "start",
              position: { lg: "sticky" },
              top: { lg: 96 },
            }}
          >
            <Stack spacing={1}>
              <Typography variant="overline" color="text.secondary">
                Navigation
              </Typography>
              {navItems.map((item) => (
                <Button
                  key={item}
                  variant={item === "Overview" ? "contained" : "text"}
                  color={item === "Overview" ? "primary" : "inherit"}
                  sx={{ justifyContent: "flex-start" }}
                >
                  {item}
                </Button>
              ))}
            </Stack>
          </Paper>

          <Stack spacing={3}>
            <Paper
              elevation={0}
              sx={{
                p: { xs: 3, md: 4 },
                borderRadius: 2,
                border: "1px solid",
                borderColor: "divider",
                backgroundColor: "background.paper",
              }}
            >
              <Stack spacing={2.5}>
                <Chip label="Phase 2 foundation" color="primary" sx={{ alignSelf: "flex-start" }} />
                <Typography variant="h3" fontWeight={800}>
                  {`Здравствуйте, ${session.user.firstName}`}
                </Typography>
                <Typography variant="body1" color="text.secondary" maxWidth={760}>
                  Базовая продуктовая оболочка уже собрана внутри `apps/web`. Следующий рабочий срез
                  здесь: документы, навигация, редактор, медиа и AI-пайплайн поверх Prisma и
                  storage.
                </Typography>
              </Stack>
            </Paper>

            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: { xs: "1fr", xl: "1.5fr 0.9fr" },
                gap: 3,
              }}
            >
              <Paper
                elevation={0}
                sx={{
                  p: 3,
                  borderRadius: 2,
                  border: "1px solid",
                  borderColor: "divider",
                }}
              >
                <Stack spacing={2}>
                  <Typography variant="h5" fontWeight={800}>
                    Документы в работе
                  </Typography>
                  <Divider />
                  <Stack spacing={1.5}>
                    {quickDrafts.map((draft, index) => (
                      <Paper
                        key={draft}
                        elevation={0}
                        sx={{
                          p: 2,
                          borderRadius: 2,
                          backgroundColor: index === 0 ? "rgba(2, 132, 199, 0.08)" : "action.hover",
                        }}
                      >
                        <Typography fontWeight={600}>{draft}</Typography>
                        <Typography variant="body2" color="text.secondary">
                          Черновик для следующего вертикального среза продукта.
                        </Typography>
                      </Paper>
                    ))}
                  </Stack>
                </Stack>
              </Paper>

              <Stack spacing={3}>
                <Paper
                  elevation={0}
                  sx={{
                    p: 3,
                    borderRadius: 2,
                    border: "1px solid",
                    borderColor: "divider",
                  }}
                >
                  <Stack spacing={1.5}>
                    <Typography variant="h6" fontWeight={800}>
                      Infrastructure
                    </Typography>
                    <Typography color="text.secondary">
                      PostgreSQL, Prisma, Better Auth, MinIO, Redis и Weaviate уже подключены на
                      уровне foundation.
                    </Typography>
                  </Stack>
                </Paper>
                <Paper
                  elevation={0}
                  sx={{
                    p: 3,
                    borderRadius: 2,
                    border: "1px solid",
                    borderColor: "divider",
                  }}
                >
                  <Stack spacing={1.5}>
                    <Typography variant="h6" fontWeight={800}>
                      Следующий этап
                    </Typography>
                    <Typography color="text.secondary">
                      Нужны полноценные модели страниц и папок, dashboard navigation state и
                      block-editor вместо статической оболочки.
                    </Typography>
                  </Stack>
                </Paper>
              </Stack>
            </Box>
          </Stack>
        </Box>
      </Container>
    </Box>
  )
}
