import { Stack, Typography } from '@repo/ui/components'
import { prisma } from '@repo/db'
import { getCurrentConsents } from '@repo/trpc'

import { requireSession } from '@/lib/get-session'

import { ConsentsTable, type ConsentsTableRow } from './consents-table'

const TYPES = [
  'USER_AGREEMENT',
  'PRIVACY_POLICY',
  'PII_PROCESSING',
  'PUBLIC_OFFER',
  'MARKETING',
] as const

const TITLE: Record<(typeof TYPES)[number], string> = {
  USER_AGREEMENT: 'Пользовательское соглашение',
  PRIVACY_POLICY: 'Политика обработки персональных данных',
  PII_PROCESSING: 'Согласие на обработку персональных данных',
  PUBLIC_OFFER: 'Оферта на оказание услуг',
  MARKETING: 'Согласие на получение информационных и рекламных рассылок',
}

const URL: Record<(typeof TYPES)[number], string> = {
  USER_AGREEMENT: '/terms/user-agreement',
  PRIVACY_POLICY: '/terms/privacy-policy',
  PII_PROCESSING: '/terms/consent',
  PUBLIC_OFFER: '/terms/public-offer',
  MARKETING: '/terms/marketing-consent',
}

const REQUIRED: Record<(typeof TYPES)[number], boolean> = {
  USER_AGREEMENT: true,
  PRIVACY_POLICY: true,
  PII_PROCESSING: true,
  PUBLIC_OFFER: true,
  MARKETING: false,
}

export default async function ConsentsSettingsPage() {
  const session = await requireSession()
  const current = await getCurrentConsents(prisma, session.user.id)

  const rows: ConsentsTableRow[] = TYPES.map((type) => {
    const found = current.find((c) => c.documentType === type)
    return {
      documentType: type,
      title: TITLE[type],
      url: URL[type],
      required: REQUIRED[type],
      granted: found?.granted ?? false,
      grantedAt: found?.grantedAt ?? null,
    }
  })

  return (
    <Stack spacing={3}>
      <Stack spacing={1}>
        <Typography variant="h5" component="h1">
          Согласия
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Документы, которые вы приняли при регистрации. Маркетинговые рассылки можно включить или
          отключить в любой момент.
        </Typography>
      </Stack>
      <ConsentsTable rows={rows} />
    </Stack>
  )
}
