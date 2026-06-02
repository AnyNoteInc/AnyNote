const pad2 = (value: number) => String(value).padStart(2, '0')

export const toDateInputValue = (date: Date) =>
  `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`

export const dateFromInputValue = (value: string) => {
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) return null
  return new Date(year, month - 1, day)
}

export const formatDateText = (date: Date) =>
  new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date)

export const formatDateTimeText = (date: Date) =>
  new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)

// Render a stored ISO value as ru-RU display text for a date node. Falls back
// to the raw value if it isn't a parseable date so export never emits "Invalid".
export const formatIsoForDisplay = (iso: string, kind: 'date' | 'datetime'): string => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return kind === 'datetime' ? formatDateTimeText(d) : formatDateText(d)
}
