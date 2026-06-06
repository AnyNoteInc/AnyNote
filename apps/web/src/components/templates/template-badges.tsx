'use client'

import { Chip, Typography } from '@repo/ui/components'
import type { PageTemplateScope } from '@repo/db'

/** "Пространство" / "Глобальный" pill shown on a template card. */
export function TemplateScopeBadge({ scope }: { scope: PageTemplateScope }) {
  const isWorkspace = scope === 'WORKSPACE'
  return (
    <Chip
      size="small"
      label={isWorkspace ? 'Пространство' : 'Глобальный'}
      color={isWorkspace ? 'primary' : 'default'}
      variant="outlined"
      sx={{ height: 20, fontSize: 11 }}
    />
  )
}

/** Compact "применений: N" usage count. */
export function TemplateUsageBadge({ count }: { count: number }) {
  return (
    <Typography component="span" variant="caption" color="text.secondary">
      {`Применений: ${count}`}
    </Typography>
  )
}

const DATE_FMT = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})

/** Localized created-at date. Accepts a Date or an ISO/serialized string. */
export function TemplateCreatedAt({ date }: { date: Date | string }) {
  const d = typeof date === 'string' ? new Date(date) : date
  return (
    <Typography component="span" variant="caption" color="text.secondary">
      {DATE_FMT.format(d)}
    </Typography>
  )
}
