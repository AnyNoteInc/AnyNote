import type { PartialDate } from '../types/domain'
import { RU } from './ru'

export function formatPartialDate(d: PartialDate | undefined): string {
  if (!d) return ''
  const { day, month, year } = d
  const monthIdx = month !== undefined ? month - 1 : -1
  const monthNom = monthIdx >= 0 ? RU.months.nominative[monthIdx] : undefined
  const monthGen = monthIdx >= 0 ? RU.months.genitive[monthIdx] : undefined

  if (day !== undefined && monthGen && year !== undefined) return `${day} ${monthGen} ${year}`
  if (monthNom && year !== undefined) return `${monthNom} ${year}`
  if (year !== undefined && day === undefined && month === undefined) return `${year}`
  if (day !== undefined && monthGen && year === undefined) return `${day} ${monthGen}`
  return ''
}
