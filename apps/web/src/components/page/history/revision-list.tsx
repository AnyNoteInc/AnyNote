'use client'

import { formatDistanceToNow, isSameDay, isToday, isYesterday } from 'date-fns'
import { ru } from 'date-fns/locale/ru'

import { Box, ListItemButton, Stack, Typography } from '@repo/ui/components'

export type RevisionItem = {
  id: string
  actorId: string | null
  action: string
  metadata: unknown
  createdAt: string | Date
}

const ACTION_LABELS: Record<string, string> = {
  EDIT: 'Редактирование',
  TITLE_CHANGE: 'Переименование',
  MOVE: 'Перемещение',
  ARCHIVE: 'Архивирование',
  RESTORE: 'Восстановление',
  PUBLISH: 'Публикация',
}

export function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action
}

function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value)
}

/** A short human label for the calendar day a group of revisions falls on. */
function dayLabel(date: Date): string {
  if (isToday(date)) return 'Сегодня'
  if (isYesterday(date)) return 'Вчера'
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
}

export type RevisionDayGroup = {
  key: string
  label: string
  items: RevisionItem[]
}

/**
 * Pure: bucket already-sorted (newest-first) revisions into per-day groups,
 * preserving order. Exported for a focused unit test.
 */
export function groupRevisionsByDate(revisions: RevisionItem[]): RevisionDayGroup[] {
  const groups: RevisionDayGroup[] = []
  for (const rev of revisions) {
    const date = toDate(rev.createdAt)
    const last = groups[groups.length - 1]
    if (last && isSameDay(toDate(last.items[0]!.createdAt), date)) {
      last.items.push(rev)
    } else {
      groups.push({ key: date.toISOString().slice(0, 10), label: dayLabel(date), items: [rev] })
    }
  }
  return groups
}

/** Best-effort compact summary from a revision's metadata JSON (title rename etc.). */
export function revisionSummary(metadata: unknown): string | null {
  if (metadata == null || typeof metadata !== 'object') return null
  const m = metadata as Record<string, unknown>
  if (typeof m.title === 'string' && m.title.trim()) return `«${m.title.trim()}»`
  if (typeof m.toTitle === 'string' && m.toTitle.trim()) return `«${m.toTitle.trim()}»`
  if (typeof m.summary === 'string' && m.summary.trim()) return m.summary.trim()
  return null
}

export function RevisionList({
  revisions,
  selectedId,
  resolveActorName,
  onSelect,
}: {
  revisions: RevisionItem[]
  selectedId: string | null
  resolveActorName: (actorId: string | null) => string
  onSelect: (id: string) => void
}) {
  const groups = groupRevisionsByDate(revisions)

  return (
    <Stack spacing={1.5}>
      {groups.map((group) => (
        <Box key={group.key}>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: 'block', mb: 0.5, fontWeight: 600 }}
          >
            {group.label}
          </Typography>
          <Stack spacing={0.25}>
            {group.items.map((rev) => {
              const summary = revisionSummary(rev.metadata)
              return (
                <ListItemButton
                  key={rev.id}
                  selected={rev.id === selectedId}
                  onClick={() => onSelect(rev.id)}
                  sx={{ borderRadius: 1, py: 0.5, px: 1, display: 'block' }}
                >
                  <Typography variant="body2" sx={{ fontWeight: 500 }}>
                    {actionLabel(rev.action)}
                    {summary ? (
                      <Box component="span" sx={{ fontWeight: 400, color: 'text.secondary' }}>
                        {' '}
                        {summary}
                      </Box>
                    ) : null}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {resolveActorName(rev.actorId)} ·{' '}
                    {formatDistanceToNow(toDate(rev.createdAt), { addSuffix: true, locale: ru })}
                  </Typography>
                </ListItemButton>
              )
            })}
          </Stack>
        </Box>
      ))}
    </Stack>
  )
}
