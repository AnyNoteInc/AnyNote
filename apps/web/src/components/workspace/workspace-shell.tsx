'use client'

import type { ReactNode } from 'react'

import { Box } from '@repo/ui/components'

import { SIDEBAR_MINI_WIDTH } from './workspace-sidebar-mini'
import { SIDEBAR_WIDTH } from './workspace-layout-client'

export type SidebarMode = 'mini' | 'full'

type Props = {
  sidebar: ReactNode
  main: ReactNode
  mode: SidebarMode
}

export function WorkspaceShell({ sidebar, main, mode }: Props) {
  const columns =
    mode === 'mini'
      ? `${SIDEBAR_MINI_WIDTH}px minmax(0, 1fr)`
      : `${SIDEBAR_WIDTH}px minmax(0, 1fr)`

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
      <Box className="workspace-sidebar" sx={{ height: '100%', minHeight: 0, display: 'flex' }}>
        {sidebar}
      </Box>
      <Box component="main" sx={{ overflow: 'auto' }}>
        {main}
      </Box>
    </Box>
  )
}
