const HUMAN_OFFSETS: Record<number, string> = {
  0: 'в момент истечения',
  60: '1 час',
  1440: '1 день',
  4320: '3 дня',
  10080: '1 неделя',
  43200: '1 месяц',
}

export function formatHumanOffset(minutes: number): string {
  return HUMAN_OFFSETS[minutes] ?? 'напоминание'
}
