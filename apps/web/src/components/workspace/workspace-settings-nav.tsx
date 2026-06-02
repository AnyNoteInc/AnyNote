'use client'

import type { ReactNode } from 'react'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import {
  BarChartIcon,
  Box,
  GroupIcon,
  HubIcon,
  SettingsIcon,
  SmartToyIcon,
  Stack,
  StorageIcon,
  Typography,
  WarningAmberIcon,
} from '@repo/ui/components'

import { usePlanFeatures } from '@/components/workspace/plan-features-context'

type Props = { workspaceId: string }

export function WorkspaceSettingsNav({ workspaceId }: Props) {
  const pathname = usePathname()
  const features = usePlanFeatures()
  const base = `/workspaces/${workspaceId}/settings`

  const items: Array<{ label: string; slug: string; icon: ReactNode; show: boolean }> = [
    { label: 'Общее', slug: 'general', icon: <SettingsIcon fontSize="small" />, show: true },
    {
      label: 'Участники',
      slug: 'members',
      icon: <GroupIcon fontSize="small" />,
      show: features.membersSettingsEnabled,
    },
    {
      label: 'AI агент',
      slug: 'ai',
      icon: <SmartToyIcon fontSize="small" />,
      show: features.aiSettingsEnabled,
    },
    {
      label: 'MCP серверы',
      slug: 'mcp',
      icon: <HubIcon fontSize="small" />,
      show: features.customMcpEnabled,
    },
    {
      label: 'Библиотека',
      slug: 'files',
      icon: <StorageIcon fontSize="small" />,
      show: true,
    },
    {
      label: 'Использование',
      slug: 'usage',
      icon: <BarChartIcon fontSize="small" />,
      show: true,
    },
    {
      label: 'Опасная зона',
      slug: 'danger',
      icon: <WarningAmberIcon fontSize="small" />,
      show: true,
    },
  ].filter((item) => item.show)

  return (
    <Stack spacing={0.5} component="nav" aria-label="Настройки воркспейса">
      {items.map((item) => {
        const href = `${base}/${item.slug}`
        const active = pathname === href
        return (
          <Box
            key={item.slug}
            component={Link}
            href={href}
            aria-current={active ? 'page' : undefined}
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1.25,
              padding: '6px 10px',
              borderRadius: 0.75,
              textDecoration: 'none',
              fontSize: 14,
              color: active ? 'text.primary' : 'text.secondary',
              fontWeight: active ? 600 : 400,
              bgcolor: active ? 'action.selected' : 'transparent',
              '&:hover': { bgcolor: 'action.hover' },
            }}
          >
            {item.icon}
            <Typography variant="body2">{item.label}</Typography>
          </Box>
        )
      })}
    </Stack>
  )
}
