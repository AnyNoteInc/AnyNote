import { pluralizeRu } from '../lib/pluralize-ru'

export interface Deviation {
  readonly days: number
  readonly tone: 'onTime' | 'late' | 'early'
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

// Факт − План, в полных днях. Положительное = просрочка, отрицательное = раньше срока.
export function computeDeviation(due: Date | null, actual: Date | null): Deviation | null {
  if (!due || !actual) return null
  const days = Math.round(
    (startOfDay(actual).getTime() - startOfDay(due).getTime()) / 86_400_000,
  )
  return { days, tone: days > 0 ? 'late' : days < 0 ? 'early' : 'onTime' }
}

export function formatDeviation(d: Deviation): string {
  if (d.days === 0) return 'в срок'
  const n = Math.abs(d.days)
  const word = pluralizeRu(n, ['день', 'дня', 'дней'])
  return d.days > 0 ? `+${n} ${word}` : `−${n} ${word}`
}
