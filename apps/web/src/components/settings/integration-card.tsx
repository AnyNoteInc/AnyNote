"use client"

import Link from "next/link"

import { Box, Button, Chip, Stack, Typography } from "@repo/ui/components"

import { trpc } from "@/trpc/client"

type Provider = {
  id: string
  slug: string
  name: string
  description: string | null
  scope: "USER" | "WORKSPACE" | "BOTH"
}

type Integration = {
  id: string
  providerId: string
  status: "PENDING" | "CONNECTED" | "DISCONNECTED" | "ERROR"
}

type Props = {
  provider: Provider
  integration: Integration | null
  defaultWorkspaceId: string | null
}

const statusLabel: Record<Integration["status"], string> = {
  PENDING: "Ожидание OAuth",
  CONNECTED: "Подключено",
  DISCONNECTED: "Не подключено",
  ERROR: "Ошибка",
}

const statusColor: Record<Integration["status"], "default" | "success" | "warning" | "error"> = {
  PENDING: "warning",
  CONNECTED: "success",
  DISCONNECTED: "default",
  ERROR: "error",
}

export function IntegrationCard({ provider, integration, defaultWorkspaceId }: Props) {
  const connect = trpc.integration.connect.useMutation()
  const disconnect = trpc.integration.disconnect.useMutation()
  const utils = trpc.useUtils()

  const needsWorkspace = provider.scope === "WORKSPACE" && !defaultWorkspaceId
  const isConnected = integration?.status === "CONNECTED" || integration?.status === "PENDING"

  const handleConnect = async () => {
    if (needsWorkspace) return
    await connect.mutateAsync({
      providerId: provider.id,
      scope: provider.scope === "USER" ? "USER" : "WORKSPACE",
      workspaceId: provider.scope === "WORKSPACE" ? defaultWorkspaceId! : undefined,
    })
    utils.integration.listMine.invalidate()
  }

  const handleDisconnect = async () => {
    if (!integration) return
    await disconnect.mutateAsync({ integrationId: integration.id })
    utils.integration.listMine.invalidate()
  }

  return (
    <Box
      sx={{
        border: "1px solid",
        borderColor: "divider",
        borderRadius: 2,
        p: 2.5,
        backgroundColor: "background.paper",
        height: "100%",
      }}
    >
      <Stack spacing={1.5} sx={{ height: "100%" }}>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
          <Stack spacing={0.5}>
            <Typography variant="subtitle1" fontWeight={700}>{provider.name}</Typography>
            <Chip size="small" label={provider.scope === "USER" ? "Личный аккаунт" : "Для workspace"} />
          </Stack>
          {integration && (
            <Chip
              size="small"
              label={statusLabel[integration.status]}
              color={statusColor[integration.status]}
            />
          )}
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
          {provider.description ?? "Без описания"}
        </Typography>
        {needsWorkspace ? (
          <Button component={Link} href="/workspaces/new" variant="outlined" size="small">
            Требуется рабочее пространство
          </Button>
        ) : isConnected ? (
          <Button
            variant="outlined"
            color="error"
            size="small"
            onClick={handleDisconnect}
            disabled={disconnect.isPending}
          >
            Отключить
          </Button>
        ) : (
          <Button
            variant="contained"
            size="small"
            onClick={handleConnect}
            disabled={connect.isPending}
          >
            Подключить
          </Button>
        )}
      </Stack>
    </Box>
  )
}
