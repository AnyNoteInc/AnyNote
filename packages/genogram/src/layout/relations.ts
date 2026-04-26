import type { BirthGroupId, ChildGroupId, GenogramPageData, PersonId, UnionId } from '../types'

export interface Relations {
  /** Union that produced this person (as a child). */
  parentUnionByPerson: Map<PersonId, UnionId>
  /** Unions where this person appears as a partner. */
  unionsByPerson: Map<PersonId, UnionId[]>
  /** Birth group this person belongs to. */
  birthGroupByPerson: Map<PersonId, BirthGroupId>
  /** ChildGroup ID for each union (denormalized for fast lookup). */
  childGroupByUnion: Map<UnionId, ChildGroupId>
}

export function buildRelations(data: GenogramPageData): Relations {
  const parentUnionByPerson = new Map<PersonId, UnionId>()
  const unionsByPerson = new Map<PersonId, UnionId[]>()
  const birthGroupByPerson = new Map<PersonId, BirthGroupId>()
  const childGroupByUnion = new Map<UnionId, ChildGroupId>()

  for (const u of Object.values(data.entities.unions)) {
    pushPartnerUnion(unionsByPerson, u.malePartnerId, u.id)
    pushPartnerUnion(unionsByPerson, u.femalePartnerId, u.id)
    if (u.childGroupId) {
      childGroupByUnion.set(u.id, u.childGroupId)
    }
  }

  for (const cg of Object.values(data.entities.childGroups)) {
    for (const entry of cg.children) {
      if (entry.kind !== 'person') continue
      parentUnionByPerson.set(entry.personId, cg.unionId)
      if (entry.birthGroupId) {
        birthGroupByPerson.set(entry.personId, entry.birthGroupId)
      }
    }
  }

  return { parentUnionByPerson, unionsByPerson, birthGroupByPerson, childGroupByUnion }
}

function pushPartnerUnion(
  map: Map<PersonId, UnionId[]>,
  personId: PersonId,
  unionId: UnionId,
): void {
  const existing = map.get(personId)
  if (existing) {
    existing.push(unionId)
  } else {
    map.set(personId, [unionId])
  }
}
