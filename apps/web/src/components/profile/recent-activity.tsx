'use client'

import Link from 'next/link'

import { Paper, Stack, Typography } from '@repo/ui/components'

type Action = {
  action: string
  createdAt: string
  pageId: string
  pageTitle: string | null
}

// PageRevisionAction enum: EDIT | TITLE_CHANGE | MOVE | ARCHIVE | RESTORE | PUBLISH
const ACTION_LABEL: Record<string, string> = {
  EDIT: 'изменил',
  TITLE_CHANGE: 'переименовал',
  MOVE: 'переместил',
  ARCHIVE: 'архивировал',
  RESTORE: 'восстановил',
  PUBLISH: 'опубликовал',
}

export function RecentActivity({ actions }: { actions: Action[] }) {
  if (actions.length === 0) {
    return (
      <Paper variant="outlined" sx={{ p: 3, textAlign: 'center', mt: 1 }}>
        <Typography variant="body2" color="text.secondary">
          Пока нет активности
        </Typography>
      </Paper>
    )
  }
  return (
    <Stack spacing={1} sx={{ mt: 1, width: '100%' }}>
      {actions.map((a) => (
        <Link
          key={`${a.pageId}-${a.createdAt}`}
          href={`/pages/${a.pageId}`}
          style={{ textDecoration: 'none' }}
        >
          <Paper
            variant="outlined"
            sx={{
              p: 1.5,
              display: 'flex',
              gap: 1,
              alignItems: 'baseline',
              '&:hover': { bgcolor: 'action.hover' },
            }}
          >
            <Typography variant="body2" color="text.secondary">
              {ACTION_LABEL[a.action] ?? a.action}
            </Typography>
            <Typography variant="body2" noWrap sx={{ flex: 1 }}>
              {a.pageTitle || 'Без названия'}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {new Date(a.createdAt).toLocaleDateString('ru-RU')}
            </Typography>
          </Paper>
        </Link>
      ))}
    </Stack>
  )
}
