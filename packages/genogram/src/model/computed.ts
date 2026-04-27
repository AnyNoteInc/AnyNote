import type { BloodRelation, Person, PersonSize, RenderableLabel } from '../types'
import type { ChildEntry, ChildGroup, ChildGroupId, PartialDate, PersonId, UnionId } from '../types/domain'
import { computeAge as computeAgeFromDates } from '../utils/dates'

export function resolveSize(bloodRelation: BloodRelation): PersonSize {
  return bloodRelation === 'direct' || bloodRelation === 'partner' ? 'big' : 'small'
}

export function resolveLabelPosition(p: Person): RenderableLabel['position'] {
  if (p.label.position && p.label.position !== 'auto') {
    return p.label.position
  }
  return p.size === 'big' ? 'left' : 'bottom'
}

export function computeAge(p: Person, now: Date = new Date()): number | undefined {
  return computeAgeFromDates(p.lifeDates.birthDate, p.lifeDates.deathDate, now)
}

export function showDeathCross(p: Person): boolean {
  if (!p.lifeDates.isDeceased) return false
  const kind = p.lifeDates.deathKind
  return kind === 'early' || kind === 'tragic'
}

export function isDirectBlood(p: Person): boolean {
  return p.bloodRelation === 'direct'
}

export function isPartnerPerson(p: Person): boolean {
  return p.bloodRelation === 'partner'
}

export function isOwner(p: Person): boolean {
  return p.role === 'owner'
}

export function calcAge(
  birth: PartialDate | undefined,
  ref: PartialDate | string | undefined,
): number | undefined {
  if (!birth || birth.year === undefined || !ref) return undefined
  const refPartial = typeof ref === 'string' ? isoToPartial(ref) : ref
  if (!refPartial || refPartial.year === undefined) return undefined

  if (
    birth.day !== undefined &&
    birth.month !== undefined &&
    refPartial.day !== undefined &&
    refPartial.month !== undefined
  ) {
    let age = refPartial.year - birth.year
    if (refPartial.month < birth.month || (refPartial.month === birth.month && refPartial.day < birth.day)) {
      age -= 1
    }
    return age
  }
  return refPartial.year - birth.year
}

export function calcAgeAtDeath(person: Person): number | undefined {
  if (person.lifeDates.lifeStatus !== 'deceased') return undefined
  return calcAge(person.lifeDates.birthDate, person.lifeDates.deathDate)
}

export function isoToPartial(iso: string): PartialDate | undefined {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return undefined
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() }
}

export function shouldShowDeathCross(person: Person): boolean {
  if (person.lifeDates.lifeStatus !== 'deceased') return false
  if (person.lifeDates.tragically === true) return true
  const age = calcAgeAtDeath(person)
  return age !== undefined && age < 65
}

export function getChildGroupOf(
  personId: PersonId,
  childGroups: Record<ChildGroupId, ChildGroup>,
): ChildGroup | null {
  for (const cg of Object.values(childGroups)) {
    if (cg.children.some((c) => c.kind === 'person' && c.personId === personId)) return cg
  }
  return null
}

export function hasParents(
  personId: PersonId,
  childGroups: Record<ChildGroupId, ChildGroup>,
): boolean {
  return getChildGroupOf(personId, childGroups) !== null
}

export function getChildrenOf(
  unionId: UnionId,
  childGroups: Record<ChildGroupId, ChildGroup>,
): ChildEntry[] {
  for (const cg of Object.values(childGroups)) {
    if (cg.unionId === unionId) return cg.children
  }
  return []
}
