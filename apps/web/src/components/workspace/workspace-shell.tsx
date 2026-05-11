'use client'

import type { ReactNode } from 'react'

import { Box } from '@repo/ui/components'

import { SIDEBAR_MINI_WIDTH } from './workspace-sidebar-mini'
import { SIDEBAR_WIDTH } from './workspace-layout-client'

export type SidebarMode = 'hidden' | 'mini' | 'full'

type Props = {
  readonly sidebar: ReactNode
  readonly main: ReactNode
  readonly mode: SidebarMode
}

function getColumns(mode: SidebarMode): string {
  if (mode === 'hidden') return '1fr'
  if (mode === 'mini') return `${SIDEBAR_MINI_WIDTH}px minmax(0, 1fr)`
  return `${SIDEBAR_WIDTH}px minmax(0, 1fr)`
}

export function WorkspaceShell({ sidebar, main, mode }: Props) {
  const columns = getColumns(mode)

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: columns,
        height: '100vh',
        bgcolor: 'background.default',
        color: 'text.primary',
        overflow: 'hidden',
        transition: 'grid-template-columns 150ms ease',
      }}
    >
      {mode === 'hidden' ? null : (
        <Box className="workspace-sidebar" sx={{ height: '100%', minHeight: 0, display: 'flex' }}>
          {sidebar}
        </Box>
      )}
      <Box component="main" sx={{ overflow: 'auto' }}>
        {main}
      </Box>
    </Box>
  )
}
