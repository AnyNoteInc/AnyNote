import { Stack, Typography } from '@repo/ui/components'

import { ApiKeysSection } from '@/components/settings/api-keys-section'
import { getServerTRPC } from '@/trpc/server'

export const metadata = { title: 'API-ключи · Настройки' }

export default async function ApiKeysSettingsPage() {
  const trpc = await getServerTRPC()
  const rawKeys = await trpc.apiKey.list()
  const initialKeys = rawKeys.map((k) => ({
    ...k,
    createdAt: k.createdAt.toISOString(),
    expiresAt: k.expiresAt?.toISOString() ?? null,
    lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
  }))

  return (
    <Stack spacing={3}>
      <Stack spacing={0.5}>
        <Typography variant="h5" fontWeight={700}>
          API-ключи
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Подключите MCP-клиенты (Cursor, Claude Desktop) к{' '}
          {process.env.NEXT_PUBLIC_API_BASE_URL ?? 'https://api.anynote.ru'} с помощью персональных
          Bearer-ключей.
        </Typography>
      </Stack>
      <ApiKeysSection initialKeys={initialKeys} />
    </Stack>
  )
}
