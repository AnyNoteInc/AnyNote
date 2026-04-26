import type { Metadata } from "next"

import { Alert, Stack, Typography } from "@repo/ui/components"

import { PublicPageShell } from "@/components/public/public-page-shell"

export const metadata: Metadata = {
  title: "Договор-оферта",
}

export default function OfertaPage() {
  return (
    <PublicPageShell
      eyebrow="Oferta"
      title="Договор-оферта"
      description="Юридический документ сервиса AnyNote находится в подготовке."
    >
      <Stack spacing={3}>
        <Alert severity="info">Документ в подготовке. TODO: legal review.</Alert>
        <Typography color="text.secondary">
          Эта страница зарезервирована для публичной оферты AnyNote. Финальный текст будет
          опубликован после юридической проверки условий сервиса, тарифов и платежей.
        </Typography>
      </Stack>
    </PublicPageShell>
  )
}
