'use client'

import { Avatar, Stack, Tooltip } from '@repo/ui/components'

import type { BoardAssignee } from '../types'
import { participantImage, participantInitials, participantName } from './participant-display'

interface AssigneeAvatarsProps {
  readonly assignees: BoardAssignee[]
  readonly size?: number
  readonly max?: number
}

export function AssigneeAvatars({ assignees, size = 24, max = 3 }: AssigneeAvatarsProps) {
  if (assignees.length === 0) return null
  return (
    <Stack direction="row" spacing={-0.5}>
      {assignees.slice(0, max).map((a) => {
        const p = a.participant
        return (
          <Tooltip key={a.participantId} title={participantName(p)}>
            <Avatar
              src={participantImage(p) ?? undefined}
              sx={{
                width: size,
                height: size,
                fontSize: 11,
                border: 2,
                borderColor: 'background.paper',
                bgcolor: 'primary.main',
                color: 'primary.contrastText',
              }}
            >
              {participantInitials(p)}
            </Avatar>
          </Tooltip>
        )
      })}
      {assignees.length > max ? (
        <Avatar
          sx={{
            width: size,
            height: size,
            fontSize: 11,
            border: 2,
            borderColor: 'background.paper',
            bgcolor: 'action.disabledBackground',
            color: 'text.secondary',
          }}
        >
          +{assignees.length - max}
        </Avatar>
      ) : null}
    </Stack>
  )
}
