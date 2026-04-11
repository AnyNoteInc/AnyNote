import type { Metadata } from "next"

import { Box, Paper, Stack, Typography } from "@repo/ui/components"

import { ContactForm } from "@/components/public/contact-form"
import { PublicPageShell } from "@/components/public/public-page-shell"

export const metadata: Metadata = {
  title: "Контакты",
}

export default function ContactPage() {
  return (
    <PublicPageShell
      eyebrow="Контакты"
      title="Оставьте заявку на демо или внедрение"
      description="Форма пока пишет данные в консоль браузера, но уже готова как клиентский блок для будущей REST-отправки в backend."
    >
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", lg: "0.9fr 1.1fr" },
          gap: 3,
        }}
      >
        <Paper
          elevation={0}
          sx={{
            p: 3,
            borderRadius: 2,
            border: "1px solid rgba(148,163,184,0.16)",
            background:
              "linear-gradient(180deg, rgba(15, 118, 110, 0.10) 0%, rgba(255,255,255,0.03) 100%)",
          }}
        >
          <Stack spacing={2}>
            <Typography variant="h5">Свяжемся по вашему сценарию</Typography>
            <Typography color="text.secondary">
              Подходит для SaaS-запуска, пилота с AI-поиском, демонстрации редактора и обсуждения
              on-prem внедрения.
            </Typography>
            <Typography color="text.secondary">
              Оставьте имя, email и телефон. Следующий этап легко подключить к tRPC или
              REST-контракту.
            </Typography>
          </Stack>
        </Paper>

        <Paper
          elevation={0}
          sx={{
            p: 3,
            borderRadius: 2,
            border: "1px solid rgba(148,163,184,0.16)",
          }}
        >
          <ContactForm />
        </Paper>
      </Box>
    </PublicPageShell>
  )
}
