'use client'

import { useMemo, useState, type KeyboardEvent } from 'react'
import {
  Avatar,
  Box,
  Button,
  ChatBubbleOutlineIcon,
  CloseIcon,
  IconButton,
  Stack,
  TextField,
  Typography,
} from '@repo/ui/components'
import type { TaskActivityType } from '@repo/db'

import { trpc } from '@/trpc/client'
import type { BoardData } from '../types'
import { pluralizeRu } from '../lib/pluralize-ru'

interface TaskSidePanelProps {
  readonly pageId: string
  readonly taskId: string
  readonly currentUserId: string
  readonly board: BoardData
  readonly canComment?: boolean
}

interface CommentRow {
  id: string
  authorId: string
  content: unknown
  createdAt: Date | string
  author: { id: string; firstName: string | null; lastName: string | null; email: string }
}

interface ActivityRow {
  id: string
  type: TaskActivityType
  payload: unknown
  createdAt: Date | string
  actor: { firstName: string | null; lastName: string | null; email: string }
}

type FeedItem =
  | { kind: 'comment'; id: string; createdAt: Date; data: CommentRow }
  | { kind: 'activity'; id: string; createdAt: Date; data: ActivityRow }

function personName(p: { firstName: string | null; lastName: string | null; email: string }) {
  const name = `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim()
  return name || p.email
}

function initials(p: { firstName: string | null; lastName: string | null; email: string }) {
  const first = p.firstName?.[0] ?? p.email[0] ?? '?'
  const last = p.lastName?.[0] ?? ''
  return `${first}${last}`.toUpperCase()
}

function readText(content: unknown): string {
  if (content && typeof content === 'object' && 'text' in content) {
    const value = content.text
    if (typeof value === 'string') return value
  }
  return typeof content === 'string' ? content : ''
}

function asString(value: unknown, fallback = '—'): string {
  return typeof value === 'string' ? value : fallback
}

function describeActivity(type: TaskActivityType, payload: unknown): string {
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

function formatDate(date: Date) {
  const now = new Date()
  const time = date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((startOf(now) - startOf(date)) / 86_400_000)
  if (days === 0) return `сегодня в ${time}`
  if (days === 1) return `вчера в ${time}`
  if (days === -1) return `завтра в ${time}`
  if (days > 1 && days < 7) return `${days} ${pluralizeRu(days, ['день', 'дня', 'дней'])} назад в ${time}`
  const sameYear = now.getFullYear() === date.getFullYear()
  const datePart = date.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: sameYear ? undefined : 'numeric',
  })
  return `${datePart} в ${time}`
}

export function TaskSidePanel({
  pageId,
  taskId,
  currentUserId,
  board,
  canComment = true,
}: TaskSidePanelProps) {
  const utils = trpc.useUtils()
  const { data: commentsData } = trpc.kanban.comment.list.useQuery({ pageId, taskId })
  const { data: activityData } = trpc.kanban.board.getActivity.useQuery({ pageId, taskId })

  const [showDetails, setShowDetails] = useState(false)
  const [draft, setDraft] = useState('')
  const me = board.members.find((m) => m.user.id === currentUserId)

  const invalidateComments = () => utils.kanban.comment.list.invalidate({ pageId, taskId })
  const create = trpc.kanban.comment.create.useMutation({ onSuccess: invalidateComments })
  const remove = trpc.kanban.comment.delete.useMutation({ onSuccess: invalidateComments })

  function submit() {
    const text = draft.trim()
    if (!text) return
    create.mutate({ pageId, taskId, content: { text } })
    setDraft('')
  }

  const feed = useMemo<FeedItem[]>(() => {
    const comments: CommentRow[] = (commentsData ?? []) as CommentRow[]
    const activity: ActivityRow[] = (activityData ?? []) as ActivityRow[]
    const items: FeedItem[] = [
      ...comments.map<FeedItem>((c) => ({
        kind: 'comment',
        id: `c-${c.id}`,
        createdAt: new Date(c.createdAt),
        data: c,
      })),
      ...activity
        .filter((a) => a.type !== 'COMMENTED')
        .filter((a) => showDetails || HIGHLIGHT_ACTIVITY.has(a.type))
        .map<FeedItem>((a) => ({
          kind: 'activity',
          id: `a-${a.id}`,
          createdAt: new Date(a.createdAt),
          data: a,
        })),
    ]
    items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    return items
  }, [commentsData, activityData, showDetails])

  return (
    <Stack sx={{ height: '100%', minHeight: 0 }}>
      <Stack
        direction="row"
        alignItems="center"
        spacing={1.5}
        sx={{ p: 2, borderBottom: 1, borderColor: 'divider' }}
      >
        <ChatBubbleOutlineIcon fontSize="small" sx={{ color: 'text.secondary' }} />
        <Typography variant="subtitle1" sx={{ flex: 1, fontWeight: 600 }}>
          Комментарии и события
        </Typography>
        <Button
          size="small"
          onClick={() => setShowDetails((v) => !v)}
          sx={{ textTransform: 'none', whiteSpace: 'nowrap' }}
        >
          {showDetails ? 'Скрыть подробности' : 'Показать подробности'}
        </Button>
      </Stack>

      {canComment ? (
        <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider' }}>
          <Stack direction="row" spacing={1.5} alignItems="flex-start">
            <Avatar sx={{ width: 32, height: 32, bgcolor: 'primary.main', fontSize: 12 }}>
              {me ? initials(me.user) : '?'}
            </Avatar>
            <TextField
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault()
                  submit()
                }
              }}
              placeholder="Напишите комментарий..."
              multiline
              minRows={2}
              fullWidth
              size="small"
            />
          </Stack>
          <Stack direction="row" justifyContent="flex-end" sx={{ mt: 1 }}>
            <Button
              variant="contained"
              size="small"
              onClick={submit}
              disabled={!draft.trim() || create.isPending}
            >
              Отправить (Ctrl+Enter)
            </Button>
          </Stack>
        </Box>
      ) : null}

      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', p: 2 }}>
        <Stack spacing={2}>
          {feed.length === 0 ? (
            <Typography variant="caption" color="text.secondary">
              Пока нет ни комментариев, ни событий.
            </Typography>
          ) : null}
          {feed.map((item) =>
            item.kind === 'comment' ? (
              <CommentRowView
                key={item.id}
                row={item.data}
                isOwn={item.data.authorId === currentUserId}
                onDelete={() => remove.mutate({ pageId, taskId, id: item.data.id })}
              />
            ) : (
              <ActivityRowView key={item.id} row={item.data} />
            ),
          )}
        </Stack>
      </Box>
    </Stack>
  )
}

const HIGHLIGHT_ACTIVITY = new Set<TaskActivityType>([
  'CREATED',
  'MOVED',
  'STATUS_CHANGED',
  'ARCHIVED',
  'UNARCHIVED',
])

interface CommentRowViewProps {
  readonly row: CommentRow
  readonly isOwn: boolean
  readonly onDelete: () => void
}

function CommentRowView({ row, isOwn, onDelete }: CommentRowViewProps) {
  return (
    <Stack direction="row" spacing={1.5} alignItems="flex-start">
      <Avatar sx={{ width: 32, height: 32, bgcolor: 'primary.main', fontSize: 12 }}>
        {initials(row.author)}
      </Avatar>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {personName(row.author)}
        </Typography>
        <Box
          sx={{
            mt: 0.5,
            p: 1.25,
            borderRadius: 1,
            bgcolor: 'background.paper',
            border: 1,
            borderColor: 'divider',
            position: 'relative',
            '&:hover .comment-delete': { opacity: 1 },
          }}
        >
          <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
            {readText(row.content)}
          </Typography>
          {isOwn ? (
            <IconButton
              size="small"
              className="comment-delete"
              onClick={onDelete}
              sx={{
                position: 'absolute',
                top: 2,
                right: 2,
                opacity: 0,
                transition: 'opacity 120ms',
              }}
              aria-label="Удалить комментарий"
            >
              <CloseIcon fontSize="small" />
            </IconButton>
          ) : null}
        </Box>
        <Typography
          component="a"
          variant="caption"
          color="text.secondary"
          sx={{ mt: 0.5, display: 'inline-block', cursor: 'pointer', textDecoration: 'underline' }}
        >
          {formatDate(new Date(row.createdAt))}
        </Typography>
      </Box>
    </Stack>
  )
}

interface ActivityRowViewProps {
  readonly row: ActivityRow
}

function ActivityRowView({ row }: ActivityRowViewProps) {
  return (
    <Stack direction="row" spacing={1.5} alignItems="flex-start">
      <Avatar sx={{ width: 32, height: 32, bgcolor: 'action.selected', color: 'text.primary', fontSize: 12 }}>
        {initials(row.actor)}
      </Avatar>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body2">
          <Box component="span" sx={{ fontWeight: 600 }}>
            {personName(row.actor)}
          </Box>{' '}
          {describeActivity(row.type, row.payload)}
        </Typography>
        <Typography
          component="a"
          variant="caption"
          color="text.secondary"
          sx={{ mt: 0.25, display: 'inline-block', cursor: 'pointer', textDecoration: 'underline' }}
        >
          {formatDate(new Date(row.createdAt))}
        </Typography>
      </Box>
    </Stack>
  )
}
