'use client'

import { Box } from '@repo/ui/components'

export function WorkspaceAvatar({
  icon,
  size = 24,
}: Readonly<{ icon: string | null; size?: number }>) {
  return (
    <Box
      sx={{
        width: size,
        height: size,
        borderRadius: 0.75,
        background: 'linear-gradient(135deg,#0f766e,#155e75)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: Math.round(size * 0.58),
        flexShrink: 0,
      }}
    >
      {icon ?? '📒'}
    </Box>
  )
}
