'use client'

import { AccountTreeIcon, Box, Tooltip } from '@repo/ui/components'

import { pluralizeRu } from '../lib/pluralize-ru'

/** [one, few, many] forms of "подзадача" for pluralizeRu. */
export const SUBTASK_FORMS = ['подзадача', 'подзадачи', 'подзадач'] as const

interface ParentBadgeProps {
  readonly count: number
}

export function ParentBadge({ count }: ParentBadgeProps) {
  const word = pluralizeRu(count, SUBTASK_FORMS)
  return (
    <Tooltip title={`Родительская задача · ${count} ${word}`}>
      <Box
        component="span"
        aria-label={`Родительская задача, ${count} ${word}`}
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 0.25,
          height: 20,
          px: 0.625,
          borderRadius: 1,
          bgcolor: 'action.hover',
          color: 'text.secondary',
          fontSize: 12,
          lineHeight: '20px',
          flexShrink: 0,
        }}
      >
        <AccountTreeIcon sx={{ fontSize: 14 }} />
        {count}
      </Box>
    </Tooltip>
  )
}
