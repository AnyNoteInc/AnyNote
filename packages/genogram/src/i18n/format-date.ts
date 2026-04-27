import type { PartialDate } from '../types/domain'

const MONTHS_NOMINATIVE = [
  'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
  'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь',
] as const

const MONTHS_GENITIVE = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
] as const

export function formatPartialDate(d: PartialDate | undefined): string {
  if (!d) return ''
  const { day, month, year } = d
  const monthIdx = month !== undefined ? month - 1 : -1
  const monthNom = monthIdx >= 0 ? MONTHS_NOMINATIVE[monthIdx] : undefined
  const monthGen = monthIdx >= 0 ? MONTHS_GENITIVE[monthIdx] : undefined

  if (day !== undefined && monthGen && year !== undefined) return `${day} ${monthGen} ${year}`
  if (monthNom && year !== undefined) return `${monthNom} ${year}`
  if (year !== undefined && day === undefined && month === undefined) return `${year}`
  if (day !== undefined && monthGen && year === undefined) return `${day} ${monthGen}`
  return ''
}
