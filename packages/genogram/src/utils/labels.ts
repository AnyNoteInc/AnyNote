import type { Person } from '../types'
import { calcAge, calcAgeAtDeath, resolveLabelPosition } from '../model/computed'
import { formatPartialDate } from '../i18n/format-date'
import { RU } from '../i18n/ru'

// Visual constants — kept in sync with PersonLabel rendering.
const CHAR_WIDTH_PX = 6.5 // approximate per-glyph width at fontSize 10 (Cyrillic)
const LABEL_GAP_BIG = 12
const LABEL_GAP_SMALL = 8

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

/**
 * Approximate the longest label line in characters without rendering or
 * computing the age line (which depends on creationDate not available at
 * layout time). Caps for date lines are upper bounds — "15 апреля 2026"
 * (≈14 chars) and "† 15 апреля 2026" (≈16 chars) define the worst case.
 */
function approxLabelMaxLineChars(p: Person): number {
  if (p.label.hidden) return 0
  let maxChars = 0

  const fullName = `${p.identity.firstName ?? ''} ${p.identity.lastName ?? ''}`.trim()
  if (fullName) {
    const suffix = p.lifeDates.lifeStatus === 'unknown' ? 2 : 0
    maxChars = Math.max(maxChars, fullName.length + suffix)
  } else if (p.identity.isUnknown) {
    const placeholder =
      p.sex === 'male' ? RU.labels.unknownPerson.male : RU.labels.unknownPerson.female
    maxChars = Math.max(maxChars, placeholder.length)
  }

  // Age line is short ("XX лет" ≈ 6 chars) — counted only when other lines exist.
  if (maxChars > 0) maxChars = Math.max(maxChars, 8)

  if (p.lifeDates.birthMode === 'date' && p.lifeDates.birthDate?.year !== undefined) {
    maxChars = Math.max(maxChars, 16)
  }
  if (p.lifeDates.lifeStatus === 'deceased' && p.lifeDates.deathDate?.year !== undefined) {
    maxChars = Math.max(maxChars, 18)
  }
  return maxChars
}

/** Approximate rendered label width in pixels (worst case across lines). */
export function approximateLabelWidthPx(p: Person): number {
  return Math.ceil(approxLabelMaxLineChars(p) * CHAR_WIDTH_PX)
}

/**
 * Horizontal space the right-aligned label extends past the shape, including
 * the gap between shape and label and a matching gap on the right of the
 * label. Returns 0 when the label is not on the right (or hidden).
 *
 * Layout uses this so that whenever an element is placed to the right of a
 * right-labelled neighbour, it sits beyond the label's reach instead of
 * covering the text.
 */
export function rightLabelExtensionPx(p: Person): number {
  if (resolveLabelPosition(p) !== 'right') return 0
  const labelW = approximateLabelWidthPx(p)
  if (labelW === 0) return 0
  const gap = p.size === 'big' ? LABEL_GAP_BIG : LABEL_GAP_SMALL
  return gap + labelW + gap
}
