'use client'

import { Box, Stack, Typography } from '@repo/ui/components'
import type { TaskActivityType } from '@repo/db'

import { trpc } from '@/trpc/client'

interface TaskActivityListProps {
  readonly pageId: string
  readonly taskId: string
}

interface ActivityRow {
  id: string
  type: TaskActivityType
  payload: unknown
  createdAt: Date | string
  actor: { firstName: string | null; lastName: string | null; email: string }
}

function actorName(actor: {
  firstName: string | null
  lastName: string | null
  email: string
}): string {
  const name = `${actor.firstName ?? ''} ${actor.lastName ?? ''}`.trim()
  return name || actor.email
}

function asString(value: unknown, fallback = '—'): string {
  return typeof value === 'string' ? value : fallback
}

function describe(type: TaskActivityType, payload: unknown): string {
  const p = (payload ?? {}) as Record<string, unknown>
  switch (type) {
    case 'CREATED':
      return 'создал(а) задачу'
    case 'RENAMED':
      return 'переименовал(а) задачу'
    case 'DESCRIPTION_CHANGED':
      return 'изменил(а) описание'
    case 'MOVED':
      return `перенёс(ла) из «${asString(p.fromColumnTitle)}» в «${asString(p.toColumnTitle)}»`
    case 'STATUS_CHANGED':
      return `статус сменился: ${asString(p.fromKind)} → ${asString(p.toKind)}`
    case 'PRIORITY_CHANGED':
      return 'изменил(а) приоритет'
    case 'TYPE_CHANGED':
      return 'изменил(а) тип'
    case 'SPRINT_CHANGED':
      return 'изменил(а) спринт'
    case 'PARENT_CHANGED':
      return 'изменил(а) родительскую задачу'
    case 'ASSIGNED':
      return 'назначил(а) исполнителя'
    case 'UNASSIGNED':
      return 'убрал(а) исполнителя'
    case 'LABELED':
      return 'добавил(а) метку'
    case 'UNLABELED':
      return 'убрал(а) метку'
    case 'DUE_DATE_CHANGED':
      return 'изменил(а) срок'
    case 'START_DATE_CHANGED':
      return 'изменил(а) дату старта'
    case 'ARCHIVED':
      return 'архивировал(а) задачу'
    case 'UNARCHIVED':
      return 'восстановил(а) задачу из архива'
    case 'ATTACHMENT_ADDED':
      return 'добавил(а) вложение'
    case 'ATTACHMENT_REMOVED':
      return 'удалил(а) вложение'
    case 'COMMENTED':
      return 'оставил(а) комментарий'
    default:
      return type
  }
}

export function TaskActivityList({ pageId, taskId }: TaskActivityListProps) {
  const { data } = trpc.kanban.board.getActivity.useQuery({ pageId, taskId })
  const entries: ActivityRow[] = data ?? []

  return (
    <Stack spacing={1.5}>
      <Typography variant="subtitle2">История</Typography>
      <Stack spacing={1}>
        {entries.map((entry) => (
          <Box key={entry.id}>
            <Typography variant="body2">
              <strong>{actorName(entry.actor)}</strong> {describe(entry.type, entry.payload)}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {new Date(entry.createdAt).toLocaleString('ru-RU', {
                dateStyle: 'short',
                timeStyle: 'short',
              })}
            </Typography>
          </Box>
        ))}
        {entries.length === 0 ? (
          <Typography variant="caption" color="text.secondary">
            История пуста.
          </Typography>
        ) : null}
      </Stack>
    </Stack>
  )
}
