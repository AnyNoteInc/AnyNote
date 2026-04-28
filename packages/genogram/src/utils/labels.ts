import type { Person } from '../types'
import { calcAge, calcAgeAtDeath } from '../model/computed'
import { formatPartialDate } from '../i18n/format-date'
import { RU } from '../i18n/ru'

/**
 * Compute display lines for a person label.
 * @param person - the person domain object
 * @param creationDate - ISO string of the genogram creation date (used as age reference for alive/unknown)
 */
export function formatPersonLabelLines(person: Person, creationDate?: string): string[] {
  const lines: string[] = []

  // Line 1: Full name or placeholder for unknown identity
  const { firstName, lastName, isUnknown } = person.identity
  const name = joinNonEmpty([firstName, lastName], ' ')
  if (name) {
    const suffix = person.lifeDates.lifeStatus === 'unknown' ? ' ?' : ''
    lines.push(name + suffix)
  } else if (isUnknown) {
    const placeholder =
      person.sex === 'male' ? RU.labels.unknownPerson.male : RU.labels.unknownPerson.female
    const suffix = person.lifeDates.lifeStatus === 'unknown' ? ' ?' : ''
    lines.push(placeholder + suffix)
  }

  // Line 2: Age
  const { lifeStatus, birthDate, deathDate, birthMode, approximateAge } = person.lifeDates
  if (birthMode === 'approximate' && approximateAge) {
    if (approximateAge.kind === 'value') {
      lines.push(RU.labels.yearsOldApprox(approximateAge.value))
    } else {
      lines.push(RU.labels.yearsOldRange(approximateAge.from, approximateAge.to))
    }
  } else if (lifeStatus === 'deceased') {
    const age = calcAgeAtDeath(person)
    if (age !== undefined) lines.push(RU.labels.yearsOld(age))
  } else {
    // alive or unknown — use creationDate as reference if available
    const ref = creationDate ?? new Date().toISOString()
    const age = calcAge(birthDate, ref)
    if (age !== undefined) lines.push(RU.labels.yearsOld(age))
  }

  // Line 3: Birth date (only if birthMode='date' and year is filled)
  if (birthMode === 'date' && birthDate?.year !== undefined) {
    const formatted = formatPartialDate(birthDate)
    if (formatted) lines.push(formatted)
  }

  // Line 4: Death date (only if deceased and year is filled)
  if (lifeStatus === 'deceased' && deathDate?.year !== undefined) {
    const formatted = formatPartialDate(deathDate)
    if (formatted) lines.push(`† ${formatted}`)
  }

  return lines
}

function joinNonEmpty(parts: (string | undefined)[], sep: string): string {
  return parts.filter((p): p is string => !!p && p.trim().length > 0).join(sep)
}
