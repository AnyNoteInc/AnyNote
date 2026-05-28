'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { Box, Stack } from '@repo/ui/components'

type Props = { workspaceId: string }

export function WorkspaceSettingsNav({ workspaceId }: Props) {
  const pathname = usePathname()
  const base = `/workspaces/${workspaceId}/settings`

  const items = [
    { label: 'Общее', slug: 'general', show: true },
    { label: 'Участники', slug: 'members', show: true },
    { label: 'AI агент', slug: 'ai', show: true },
    { label: 'MCP серверы', slug: 'mcp', show: true },
    { label: 'Файлы', slug: 'files', show: true },
    { label: 'Использование', slug: 'usage', show: true },
    { label: 'Опасная зона', slug: 'danger', show: true },
  ].filter((item) => item.show)

  return (
    <Stack spacing={0.5} component="nav">
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
              display: 'block',
              padding: '6px 10px',
              borderRadius: 0.75,
              textDecoration: 'none',
              fontSize: 14,
              color: active ? 'text.primary' : 'text.secondary',
              bgcolor: active ? 'action.selected' : 'transparent',
              '&:hover': { bgcolor: active ? 'action.selected' : 'action.hover' },
            }}
          >
            {item.label}
          </Box>
        )
      })}
    </Stack>
  )
}
