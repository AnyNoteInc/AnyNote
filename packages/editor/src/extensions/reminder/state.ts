export type ReminderColor = 'gray' | 'yellow' | 'red' | 'green'

export type ReminderStateInput = {
  dueAt: string
  offsets: number[]
  doneAt: string | null
}

export function computeReminderState(attrs: ReminderStateInput, now: Date): ReminderColor {
  if (attrs.doneAt) return 'green'
  if (!attrs.dueAt) return 'gray'
  const due = new Date(attrs.dueAt).getTime()
  const t = now.getTime()
  if (t >= due) return 'red'
  if (!attrs.offsets || attrs.offsets.length === 0) return 'gray'
  const earliestOffsetMinutes = Math.max(...attrs.offsets)
  const yellowStart = due - earliestOffsetMinutes * 60_000
  return t >= yellowStart ? 'yellow' : 'gray'
}
