import type { Metadata } from 'next'

import { Stack, Typography } from '@repo/ui/components'

import { PublicPageShell } from '@/components/public/public-page-shell'

export const metadata: Metadata = {
  title: 'Документация',
}

export default function DocsPage() {
  return (
    <PublicPageShell
      eyebrow="Документация"
      title="Тут скоро будет документация"
      description="Раздел подготовлен под продуктовые гайды, API-справку, инструкции по развертыванию и интеграциям."
    >
      <Stack spacing={2}>
        <Typography variant="body1">
          Мы готовим структуру документации для администраторов, разработчиков и команд внедрения.
        </Typography>
        <Typography color="text.secondary">
          В ближайших обновлениях здесь появятся quick start, описание архитектуры монорепы и
          материалы по интеграциям.
        </Typography>
      </Stack>
    </PublicPageShell>
  )
}
