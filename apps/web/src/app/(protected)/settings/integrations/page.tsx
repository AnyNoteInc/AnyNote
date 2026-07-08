import { Box, Stack, Typography } from '@repo/ui/components'

import { IntegrationCard } from '@/components/settings/integration-card'
import { TelegramLinkCard } from '@/components/settings/telegram-link-card'
import { getServerTRPC } from '@/trpc/server'

export const metadata = { title: 'Интеграции · Настройки' }

export default async function IntegrationsSettingsPage() {
  const trpc = await getServerTRPC()
  const [providers, defaultWs] = await Promise.all([
    trpc.integration.listProviders(),
    trpc.workspace.getDefault(),
  ])
  const integrations = await trpc.integration.listMine({
    workspaceId: defaultWs?.id,
  })

  const integrationByProvider = new Map(integrations.map((i) => [i.providerId, i]))

  return (
    <Stack spacing={3}>
      <Stack spacing={0.5}>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>
          Интеграции
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Подключите внешние сервисы к своему аккаунту или рабочему пространству
        </Typography>
      </Stack>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: '1fr 1fr', lg: '1fr 1fr 1fr' },
          gap: 2,
        }}
      >
        <TelegramLinkCard />
        {providers.length > 0 &&
          providers.map((p) => (
            <IntegrationCard
              key={p.id}
              provider={p}
              integration={integrationByProvider.get(p.id) ?? null}
              defaultWorkspaceId={defaultWs?.id ?? null}
            />
          ))}
      </Box>
    </Stack>
  )
}
