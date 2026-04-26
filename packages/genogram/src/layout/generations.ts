import type { GenogramPageData, Person, PersonId } from '../types'
import type { Relations } from './relations'

/**
 * BFS from pivot. Partners share generation; children are +1; parents -1.
 * Returns a map of personId → generation index (not normalized to ≥0).
 */
export function assignGenerations(
  data: GenogramPageData,
  relations: Relations,
): Map<PersonId, number> {
  const result = new Map<PersonId, number>()
  const pivot = pickPivot(data)
  if (!pivot) return result

  result.set(pivot.id, 0)
  const queue: PersonId[] = [pivot.id]

  while (queue.length > 0) {
    const personId = queue.shift()!
    const gen = result.get(personId)!

    visitPartners(personId, gen, data, relations, result, queue)
    visitChildren(personId, gen, data, relations, result, queue)
    visitParents(personId, gen, data, relations, result, queue)
    visitSiblings(personId, gen, data, relations, result, queue)
  }

  return result
}

function pickPivot(data: GenogramPageData): Person | null {
  const people = Object.values(data.entities.people)
  return (
    people.find((p) => p.role === 'owner') ??
    people.find((p) => p.bloodRelation === 'direct') ??
    people[0] ??
    null
  )
}

function visitPartners(
  personId: PersonId,
  gen: number,
  data: GenogramPageData,
  relations: Relations,
  result: Map<PersonId, number>,
  queue: PersonId[],
): void {
  const unions = relations.unionsByPerson.get(personId) ?? []
  for (const uid of unions) {
    const u = data.entities.unions[uid]
    if (!u) continue
    const partnerId = u.malePartnerId === personId ? u.femalePartnerId : u.malePartnerId
    if (!result.has(partnerId) && data.entities.people[partnerId]) {
      result.set(partnerId, gen)
      queue.push(partnerId)
    }
  }
}

function visitChildren(
  personId: PersonId,
  gen: number,
  data: GenogramPageData,
  relations: Relations,
  result: Map<PersonId, number>,
  queue: PersonId[],
): void {
  const unions = relations.unionsByPerson.get(personId) ?? []
  for (const uid of unions) {
    const cgId = relations.childGroupByUnion.get(uid)
    if (!cgId) continue
    const cg = data.entities.childGroups[cgId]
    if (!cg) continue
    for (const entry of cg.children) {
      if (entry.kind !== 'person') continue
      if (!result.has(entry.personId) && data.entities.people[entry.personId]) {
        result.set(entry.personId, gen + 1)
        queue.push(entry.personId)
      }
    }
  }
}

function visitParents(
  personId: PersonId,
  gen: number,
  data: GenogramPageData,
  relations: Relations,
  result: Map<PersonId, number>,
  queue: PersonId[],
): void {
  const parentUnionId = relations.parentUnionByPerson.get(personId)
  if (!parentUnionId) return
  const u = data.entities.unions[parentUnionId]
  if (!u) return
  for (const pid of [u.malePartnerId, u.femalePartnerId]) {
    if (!result.has(pid) && data.entities.people[pid]) {
      result.set(pid, gen - 1)
      queue.push(pid)
    }
  }
}

function visitSiblings(
  personId: PersonId,
  gen: number,
  data: GenogramPageData,
  relations: Relations,
  result: Map<PersonId, number>,
  queue: PersonId[],
): void {
  const parentUnionId = relations.parentUnionByPerson.get(personId)
  if (!parentUnionId) return
  const cgId = relations.childGroupByUnion.get(parentUnionId)
  if (!cgId) return
  const cg = data.entities.childGroups[cgId]
  if (!cg) return
  for (const entry of cg.children) {
    if (entry.kind !== 'person') continue
    if (entry.personId === personId) continue
    if (!result.has(entry.personId) && data.entities.people[entry.personId]) {
      result.set(entry.personId, gen)
      queue.push(entry.personId)
    }
  }
}
