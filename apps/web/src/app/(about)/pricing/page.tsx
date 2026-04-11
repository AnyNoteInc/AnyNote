import type { Metadata } from "next"

import { Box, Button, Divider, Paper, Stack, Typography } from "@repo/ui/components"

import { PublicPageShell } from "@/components/public/public-page-shell"
import { pricingCards } from "@/components/public/content"

export const metadata: Metadata = {
  title: "Цены",
}

export default function PricingPage() {
  return (
    <PublicPageShell
      eyebrow="Тарифы"
      title="Выберите модель запуска под вашу команду"
      description="Три базовых тарифа повторяют продуктовую матрицу с главной страницы: от бесплатного старта до корпоративного контура."
    >
      <Box
        sx={{
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
              borderRadius: 2,
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
                  href="/registration"
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
    </PublicPageShell>
  )
}
