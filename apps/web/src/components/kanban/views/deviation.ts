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

export interface DeviationColors {
  readonly color: string
  readonly borderColor: string
  readonly bgcolor: string
}

// Red for a late deviation, green for early/on-time. Also used for the green
// "Факт" badge via deviationColors('early').
export function deviationColors(tone: Deviation['tone']): DeviationColors {
  return tone === 'late'
    ? { color: '#B91C1C', borderColor: '#FCA5A5', bgcolor: '#FEE2E2' }
    : { color: '#15803D', borderColor: '#86EFAC', bgcolor: '#DCFCE7' }
}
