import type * as Y from 'yjs'
import {
  createAnnotation,
  createBirthGroup,
  createChildGroup,
  createPerson,
  createPregnancyLoss,
  createUnion,
  type CreateAnnotationInput,
  type CreateBirthGroupInput,
  type CreateChildGroupInput,
  type CreatePersonInput,
  type CreatePregnancyLossInput,
  type CreateUnionInput,
} from '../model/factories'
import type {
  Annotation,
  AnnotationId,
  ApproximateAge,
  BirthGroup,
  BirthGroupId,
  BirthMode,
  ChildEntry,
  ChildGroup,
  ChildGroupId,
  GenogramMeta,
  LifeStatus,
  PartialDate,
  Person,
  PersonId,
  PregnancyLoss,
  PregnancyLossId,
  Sex,
  Union,
  UnionDivorce,
  UnionId,
  UnionKind,
} from '../types'
import { getGenogramMaps, getMetaMap } from './schema'
import { assembleDomain } from './assembleDomain'
import { hasParents, getPartnersOf } from '../model/computed'

// ── creation ─────────────────────────────────────────────

export function addPerson(doc: Y.Doc, input: CreatePersonInput): Person {
  const person = createPerson(input)
  doc.transact(() => {
    getGenogramMaps(doc).people.set(person.id, person)
  })
  return person
}

export function addUnion(doc: Y.Doc, input: CreateUnionInput): Union {
  const union = createUnion(input)
  doc.transact(() => {
    getGenogramMaps(doc).unions.set(union.id, union)
  })
  return union
}

export function addChildGroup(doc: Y.Doc, input: CreateChildGroupInput): ChildGroup {
  const cg = createChildGroup(input)
  doc.transact(() => {
    const maps = getGenogramMaps(doc)
    maps.childGroups.set(cg.id, cg)
    const union = maps.unions.get(cg.unionId)
    if (union && !union.childGroupId) {
      maps.unions.set(union.id, { ...union, childGroupId: cg.id })
    }
  })
  return cg
}

export function addBirthGroup(doc: Y.Doc, input: CreateBirthGroupInput): BirthGroup {
  const bg = createBirthGroup(input)
  doc.transact(() => {
    getGenogramMaps(doc).birthGroups.set(bg.id, bg)
  })
  return bg
}

export function addPregnancyLoss(doc: Y.Doc, input: CreatePregnancyLossInput): PregnancyLoss {
  const loss = createPregnancyLoss(input)
  doc.transact(() => {
    getGenogramMaps(doc).pregnancyLosses.set(loss.id, loss)
  })
  return loss
}

export function addAnnotation(doc: Y.Doc, input: CreateAnnotationInput): Annotation {
  const annotation = createAnnotation(input)
  doc.transact(() => {
    getGenogramMaps(doc).annotations.set(annotation.id, annotation)
  })
  return annotation
}

// ── updates ──────────────────────────────────────────────

export function updatePerson(
  doc: Y.Doc,
  personId: PersonId,
  patch: Partial<Omit<Person, 'id'>>,
): void {
  const maps = getGenogramMaps(doc)
  const existing = maps.people.get(personId)
  if (!existing) return
  doc.transact(() => {
    maps.people.set(personId, { ...existing, ...patch, id: personId })
  })
}

export function updateUnion(doc: Y.Doc, unionId: UnionId, patch: Partial<Omit<Union, 'id'>>): void {
  const maps = getGenogramMaps(doc)
  const existing = maps.unions.get(unionId)
  if (!existing) return
  doc.transact(() => {
    maps.unions.set(unionId, { ...existing, ...patch, id: unionId })
  })
}

export function setUnionDivorce(
  doc: Y.Doc,
  unionId: UnionId,
  divorce: UnionDivorce | undefined,
): void {
  updateUnion(doc, unionId, { divorce })
}

export function appendChild(doc: Y.Doc, childGroupId: ChildGroupId, entry: ChildEntry): void {
  const maps = getGenogramMaps(doc)
  const cg = maps.childGroups.get(childGroupId)
  if (!cg) return
  doc.transact(() => {
    maps.childGroups.set(childGroupId, {
      ...cg,
      children: [...cg.children, entry],
    })
  })
}

export function removeChild(
  doc: Y.Doc,
  childGroupId: ChildGroupId,
  predicate: (entry: ChildEntry) => boolean,
): void {
  const maps = getGenogramMaps(doc)
  const cg = maps.childGroups.get(childGroupId)
  if (!cg) return
  doc.transact(() => {
    maps.childGroups.set(childGroupId, {
      ...cg,
      children: cg.children.filter((e) => !predicate(e)),
    })
  })
}

export function reorderChildren(
  doc: Y.Doc,
  childGroupId: ChildGroupId,
  order: (entries: ChildEntry[]) => ChildEntry[],
): void {
  const maps = getGenogramMaps(doc)
  const cg = maps.childGroups.get(childGroupId)
  if (!cg) return
  doc.transact(() => {
    maps.childGroups.set(childGroupId, {
      ...cg,
      children: order(cg.children),
    })
  })
}

// ── removals ─────────────────────────────────────────────
// Note: none of these cascade. Call-sites are expected to clean up
// references themselves; invariants checker flags orphan refs.

export function removePerson(doc: Y.Doc, personId: PersonId): void {
  doc.transact(() => {
    getGenogramMaps(doc).people.delete(personId)
  })
}

export function removeUnion(doc: Y.Doc, unionId: UnionId): void {
  doc.transact(() => {
    getGenogramMaps(doc).unions.delete(unionId)
  })
}

export function removeChildGroup(doc: Y.Doc, childGroupId: ChildGroupId): void {
  doc.transact(() => {
    getGenogramMaps(doc).childGroups.delete(childGroupId)
  })
}

export function removeBirthGroup(doc: Y.Doc, birthGroupId: BirthGroupId): void {
  doc.transact(() => {
    getGenogramMaps(doc).birthGroups.delete(birthGroupId)
  })
}

export function removePregnancyLoss(doc: Y.Doc, lossId: PregnancyLossId): void {
  doc.transact(() => {
    getGenogramMaps(doc).pregnancyLosses.delete(lossId)
  })
}

export function removeAnnotation(doc: Y.Doc, annotationId: AnnotationId): void {
  doc.transact(() => {
    getGenogramMaps(doc).annotations.delete(annotationId)
  })
}

// ── meta ──────────────────────────────────────────────────

export function getMeta(doc: Y.Doc): GenogramMeta | null {
  const map = getMetaMap(doc)
  const createdAt = map.get('createdAt')
  const ownerId = map.get('ownerId') as PersonId | undefined
  if (!createdAt || !ownerId) return null
  return { createdAt, ownerId }
}

export function setMeta(doc: Y.Doc, meta: GenogramMeta): void {
  doc.transact(() => {
    const map = getMetaMap(doc)
    map.set('createdAt', meta.createdAt)
    map.set('ownerId', meta.ownerId)
  })
}

// ── composite actions ─────────────────────────────────────

export interface OwnerDataDraft {
  firstName?: string
  lastName?: string
  middleName?: string
  sex: Sex
  birthDate?: PartialDate
}

export function createOwnerWithParents(
  doc: Y.Doc,
  draft: OwnerDataDraft,
): {
  ownerId: PersonId
  fatherId: PersonId
  motherId: PersonId
  unionId: UnionId
  childGroupId: ChildGroupId
} {
  let result!: ReturnType<typeof createOwnerWithParents>
  doc.transact(() => {
    const owner = addPerson(doc, {
      sex: draft.sex,
      bloodRelation: 'direct',
      role: 'owner',
      size: 'big',
      identity: {
        firstName: draft.firstName,
        lastName: draft.lastName,
        middleName: draft.middleName,
      },
      lifeDates: {
        birthMode: 'date',
        lifeStatus: 'alive',
        birthDate: draft.birthDate,
      },
    })
    const father = addPerson(doc, {
      sex: 'male',
      bloodRelation: 'direct',
      role: 'regular',
      size: 'big',
      identity: { isUnknown: true },
      lifeDates: { birthMode: 'date', lifeStatus: 'unknown' },
    })
    const mother = addPerson(doc, {
      sex: 'female',
      bloodRelation: 'direct',
      role: 'regular',
      size: 'big',
      identity: { isUnknown: true },
      lifeDates: { birthMode: 'date', lifeStatus: 'unknown' },
    })
    const union = addUnion(doc, {
      kind: 'marriage',
      malePartnerId: father.id,
      femalePartnerId: mother.id,
    })
    const cg = addChildGroup(doc, { unionId: union.id })
    appendChild(doc, cg.id, { kind: 'person', personId: owner.id })

    setMeta(doc, { createdAt: new Date().toISOString(), ownerId: owner.id })
    result = {
      ownerId: owner.id,
      fatherId: father.id,
      motherId: mother.id,
      unionId: union.id,
      childGroupId: cg.id,
    }
  })
  return result
}

export function addParents(
  doc: Y.Doc,
  childPersonId: PersonId,
): {
  fatherId: PersonId
  motherId: PersonId
  unionId: UnionId
  childGroupId: ChildGroupId
} {
  const domain = assembleDomain(doc)
  if (hasParents(childPersonId, domain.entities.childGroups)) {
    throw new Error(`Person ${childPersonId} already has parents`)
  }

  let result!: ReturnType<typeof addParents>
  doc.transact(() => {
    const father = addPerson(doc, {
      sex: 'male',
      bloodRelation: 'direct',
      role: 'regular',
      size: 'big',
      identity: { isUnknown: true },
      lifeDates: { birthMode: 'date', lifeStatus: 'unknown' },
    })
    const mother = addPerson(doc, {
      sex: 'female',
      bloodRelation: 'direct',
      role: 'regular',
      size: 'big',
      identity: { isUnknown: true },
      lifeDates: { birthMode: 'date', lifeStatus: 'unknown' },
    })
    const union = addUnion(doc, {
      kind: 'marriage',
      malePartnerId: father.id,
      femalePartnerId: mother.id,
    })
    const cg = addChildGroup(doc, { unionId: union.id })
    appendChild(doc, cg.id, { kind: 'person', personId: childPersonId })
    result = { fatherId: father.id, motherId: mother.id, unionId: union.id, childGroupId: cg.id }
  })
  return result
}

// ── addPartner ────────────────────────────────────────────

export interface PersonDataDraft {
  firstName?: string
  lastName?: string
  middleName?: string
  sex: Sex
  birthDate?: PartialDate
  birthMode: BirthMode
  approximateAge?: ApproximateAge
  lifeStatus: LifeStatus
  deathDate?: PartialDate
  tragically?: boolean
}

export interface UnionDraft {
  kind: UnionKind
  startDate?: PartialDate
  endDate?: PartialDate
  divorce?: UnionDivorce
}

/**
 * Adds a new partner to `basePersonId` and creates a Union linking them.
 *
 * `newPartnerOrder` must satisfy `newPartnerOrder === countPartnersOf(basePersonId) + 1`
 * (i.e., append-only — inserting at an already-occupied position is not supported and
 * will produce duplicate ordinals). The UI in `PersonDataForm` enforces this via
 * `min: existingPartnersOfBase + 1` and a default of `existingPartnersOfBase + 1`.
 *
 * When `newPartnerOrder === 1`, no `partnerOrder` is set on the partner.
 * When `newPartnerOrder > 1`, all existing partners of the base get `partnerOrder` 1..K
 * and the new partner gets `newPartnerOrder` (= K+1).
 */
export function addPartner(
  doc: Y.Doc,
  basePersonId: PersonId,
  personDraft: PersonDataDraft,
  unionDraft: UnionDraft,
  newPartnerOrder: number,
): { partnerId: PersonId; unionId: UnionId } {
  let result!: ReturnType<typeof addPartner>
  doc.transact(() => {
    const partner = addPerson(doc, {
      sex: personDraft.sex,
      bloodRelation: 'partner',
      role: 'regular',
      size: 'big',
      identity: {
        firstName: personDraft.firstName,
        lastName: personDraft.lastName,
        middleName: personDraft.middleName,
      },
      lifeDates: {
        birthMode: personDraft.birthMode,
        lifeStatus: personDraft.lifeStatus,
        birthDate: personDraft.birthDate,
        approximateAge: personDraft.approximateAge,
        deathDate: personDraft.deathDate,
        tragically: personDraft.tragically,
      },
      profile: {},
    })

    const malePartnerId = personDraft.sex === 'male' ? partner.id : basePersonId
    const femalePartnerId = personDraft.sex === 'female' ? partner.id : basePersonId
    const union = addUnion(doc, {
      kind: unionDraft.kind,
      malePartnerId,
      femalePartnerId,
      startDate: unionDraft.startDate,
      endDate: unionDraft.endDate,
      divorce: unionDraft.divorce,
    })

    if (newPartnerOrder > 1) {
      const domain = assembleDomain(doc)
      const partners = getPartnersOf(basePersonId, domain.entities.unions, domain.entities.people)
      partners.forEach((p, idx) => {
        const order = idx + 1
        if (p.partnerId === partner.id) return
        updatePerson(doc, p.partnerId, { partnerOrder: order })
      })
      updatePerson(doc, partner.id, { partnerOrder: newPartnerOrder })
    }

    result = { partnerId: partner.id, unionId: union.id }
  })
  return result
}
