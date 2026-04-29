import type {
  BloodRelation,
  ChildEntry,
  ChildGroup,
  ChildGroupId,
  PartialDate,
  Person,
  PersonId,
  PersonSize,
  RenderableLabel,
  Union,
  UnionId,
} from '../types'

export function resolveSize(bloodRelation: BloodRelation): PersonSize {
  return bloodRelation === 'direct' || bloodRelation === 'partner' ? 'big' : 'small'
}

export function resolveLabelPosition(p: Person): RenderableLabel['position'] {
  if (p.label.position && p.label.position !== 'auto') {
    return p.label.position
  }
  // Big shapes get the label on the right (per design spec); small shapes
  // get it under the shape. Right-side placement keeps the label outside
  // the union bracket area for the rightmost partner and keeps text from
  // overlapping the shape itself.
  return p.size === 'big' ? 'right' : 'bottom'
}

export function computeAge(p: Person, now: Date = new Date()): number | undefined {
  return p.lifeDates.lifeStatus === 'deceased'
    ? calcAgeAtDeath(p)
    : calcAge(p.lifeDates.birthDate, dateToPartial(now))
}

export function showDeathCross(p: Person): boolean {
  return shouldShowDeathCross(p)
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
  return dateToPartial(d)
}

function dateToPartial(d: Date): PartialDate {
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

function unionsOfPerson(personId: PersonId, unions: Record<UnionId, Union>): Union[] {
  return Object.values(unions).filter(
    (u) => u.malePartnerId === personId || u.femalePartnerId === personId,
  )
}

export function getBaseOf(partnerId: PersonId, unions: Record<UnionId, Union>): PersonId | null {
  const own = unionsOfPerson(partnerId, unions)
  if (own.length !== 1) return null
  const u = own[0]!
  return u.malePartnerId === partnerId ? u.femalePartnerId : u.malePartnerId
}

export function getPartnersOf(
  basePersonId: PersonId,
  unions: Record<UnionId, Union>,
  people: Record<PersonId, Person>,
): { unionId: UnionId; partnerId: PersonId; partnerOrder?: number }[] {
  const own = unionsOfPerson(basePersonId, unions)
  return own
    .map((u) => {
      const partnerId = u.malePartnerId === basePersonId ? u.femalePartnerId : u.malePartnerId
      const partnerOrder = people[partnerId]?.partnerOrder
      return { unionId: u.id, partnerId, partnerOrder }
    })
    .sort((a, b) => {
      if (a.partnerOrder === undefined) return 1
      if (b.partnerOrder === undefined) return -1
      return a.partnerOrder - b.partnerOrder
    })
}

export function countPartnersOf(personId: PersonId, unions: Record<UnionId, Union>): number {
  return unionsOfPerson(personId, unions).length
}

export function shouldShowPartnerOrder(
  personId: PersonId,
  people: Record<PersonId, Person>,
  unions: Record<UnionId, Union>,
): boolean {
  const baseId = getBaseOf(personId, unions)
  if (!baseId) return false
  return countPartnersOf(baseId, unions) > 1
}
