'use client'

import { Box, Stack } from '@repo/ui/components'

interface AssigneeLike {
  userId: string
  user?: { firstName: string | null; email: string }
}

interface AssigneeAvatarsProps {
  readonly assignees: AssigneeLike[]
  readonly memberLookup?: (userId: string) => { firstName: string | null; email: string } | undefined
  readonly size?: number
  readonly max?: number
}

export function AssigneeAvatars({
  assignees,
  memberLookup,
  size = 24,
  max = 3,
}: AssigneeAvatarsProps) {
  if (assignees.length === 0) return null
  return (
    <Stack direction="row" spacing={-0.5}>
      {assignees.slice(0, max).map((a) => {
        const user = a.user ?? memberLookup?.(a.userId)
        const initial = (user?.firstName?.[0] ?? user?.email[0] ?? '?').toUpperCase()
        return (
          <Box
            key={a.userId}
            sx={{
              width: size,
              height: size,
              bgcolor: 'primary.main',
              color: 'primary.contrastText',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 11,
              border: 2,
              borderColor: 'background.paper',
            }}
          >
            {initial}
          </Box>
        )
      })}
    </Stack>
  )
}
