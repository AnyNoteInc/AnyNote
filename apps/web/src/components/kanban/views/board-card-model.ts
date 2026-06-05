import type { BoardData, BoardTaskData } from '../types'

const VISIBLE_LABEL_LIMIT = 2
const SOON_WINDOW_DAYS = 7

export type CardDateTone = 'default' | 'soon' | 'overdue'
export type CardPriorityTone = 'low' | 'medium' | 'high' | 'critical'

type BoardMetaItem = { id: string; title: string; position: number }

export interface BoardCardModel {
  readonly type: BoardData['types'][number] | null
  readonly priority: BoardData['priorities'][number] | null
  readonly priorityTone: CardPriorityTone | null
  readonly priorityColor: string | null
  readonly visibleLabels: BoardTaskData['labels']
  readonly hiddenLabelCount: number
  readonly dateLabel: string | null
  readonly dateTone: CardDateTone
  readonly childCount: number
}

export function getBoardCardModel(
  task: BoardTaskData,
  board: BoardData,
  childCount: number,
  now = new Date(),
): BoardCardModel {
  const type = task.typeId ? (board.types.find((item) => item.id === task.typeId) ?? null) : null
  const priority = task.priorityId
    ? (board.priorities.find((item) => item.id === task.priorityId) ?? null)
    : null
  const dueDate = toValidDate(task.dueDate)
  const visibleLabels = task.labels.slice(0, VISIBLE_LABEL_LIMIT)

  return {
    type,
    priority,
    priorityTone: priority ? getPriorityTone(priority, board.priorities) : null,
    priorityColor: priority
      ? (priority.color ?? getPriorityFallbackColor(getPriorityTone(priority, board.priorities)))
      : null,
    visibleLabels,
    hiddenLabelCount: Math.max(task.labels.length - visibleLabels.length, 0),
    dateLabel: getDateLabel(task.startDate, task.dueDate, now),
    dateTone: getDateTone(dueDate, now),
    childCount,
  }
}

function getPriorityFallbackColor(tone: CardPriorityTone): string {
  switch (tone) {
    case 'critical':
      return '#EF4444'
    case 'high':
      return '#F97316'
    case 'medium':
      return '#3B82F6'
    case 'low':
      return '#6B7280'
  }
}

export function getPriorityTone(
  priority: BoardMetaItem,
  priorities: readonly BoardMetaItem[],
): CardPriorityTone {
  const ordered = [...priorities].sort((a, b) => a.position - b.position)
  const index = Math.max(
    ordered.findIndex((item) => item.id === priority.id),
    0,
  )
  const ratio = ordered.length <= 1 ? 1 : index / (ordered.length - 1)

  if (ratio >= 0.85) return 'critical'
  if (ratio >= 0.55) return 'high'
  if (ratio >= 0.25) return 'medium'
  return 'low'
}

export function getDateTone(dueDate: Date | null, now = new Date()): CardDateTone {
  if (!dueDate) return 'default'

  const today = startOfDay(now)
  const dueDay = startOfDay(dueDate)
  const diffDays = Math.floor((dueDay.getTime() - today.getTime()) / 86_400_000)

  if (diffDays < 0) return 'overdue'
  if (diffDays <= SOON_WINDOW_DAYS) return 'soon'
  return 'default'
}

function getDateLabel(
  startValue: BoardTaskData['startDate'],
  dueValue: BoardTaskData['dueDate'],
  now: Date,
): string | null {
  const startDate = toValidDate(startValue)
  const dueDate = toValidDate(dueValue)

  if (startDate && dueDate)
    return `${formatCardDate(startDate, now)} - ${formatCardDate(dueDate, now)}`
  if (dueDate) return formatCardDate(dueDate, now)
  if (startDate) return `старт ${formatCardDate(startDate, now)}`
  return null
}

function formatCardDate(date: Date, now: Date): string {
  const options: Intl.DateTimeFormatOptions =
    date.getFullYear() === now.getFullYear()
      ? { day: 'numeric', month: 'short' }
      : { day: 'numeric', month: 'short', year: 'numeric' }

  return date.toLocaleDateString('ru-RU', options).replace(/\.$/, '')
}

function toValidDate(value: BoardTaskData['dueDate']): Date | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}
