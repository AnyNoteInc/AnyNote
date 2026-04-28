import {
  createBirthGroup,
  createChildGroup,
  createEmptyGenogram,
  createPerson,
  createPregnancyLoss,
  createUnion,
  type CreatePersonInput,
  type CreateUnionInput,
} from '../../model/factories'
import type {
  BirthGroupId,
  ChildEntry,
  ChildGroupId,
  GenogramPageData,
  PersonId,
  PregnancyLossId,
  UnionId,
} from '../../types'

// ── builder helpers ─────────────────────────────────────

export function newGenogram(): GenogramPageData {
  return createEmptyGenogram()
}

export function addPerson(g: GenogramPageData, input: CreatePersonInput): PersonId {
  const p = createPerson(input)
  g.entities.people[p.id] = p
  return p.id
}

export function addUnion(
  g: GenogramPageData,
  maleId: PersonId,
  femaleId: PersonId,
  extra: Omit<CreateUnionInput, 'malePartnerId' | 'femalePartnerId'> = {},
): UnionId {
  const u = createUnion({ malePartnerId: maleId, femalePartnerId: femaleId, ...extra })
  g.entities.unions[u.id] = u
  return u.id
}

export function addChildGroup(
  g: GenogramPageData,
  unionId: UnionId,
  children: ChildEntry[] = [],
): ChildGroupId {
  const cg = createChildGroup({ unionId, children })
  g.entities.childGroups[cg.id] = cg
  const u = g.entities.unions[unionId]
  if (u) u.childGroupId = cg.id
  return cg.id
}

export function addBirthGroup(
  g: GenogramPageData,
  kind: 'twins' | 'fraternal',
  memberIds: PersonId[],
): BirthGroupId {
  const bg = createBirthGroup({ kind, memberIds })
  g.entities.birthGroups[bg.id] = bg
  return bg.id
}

export function addPregnancyLoss(
  g: GenogramPageData,
  kind: 'abortion' | 'miscarriage',
  childGroupId: ChildGroupId,
): PregnancyLossId {
  const pl = createPregnancyLoss({ kind, childGroupId })
  g.entities.pregnancyLosses[pl.id] = pl
  return pl.id
}

// ── scenarios ───────────────────────────────────────────

export function scenarioSolo(): { data: GenogramPageData; ownerId: PersonId } {
  const data = newGenogram()
  const ownerId = addPerson(data, { sex: 'male', bloodRelation: 'direct', role: 'owner' })
  return { data, ownerId }
}

export function scenarioCouple(): {
  data: GenogramPageData
  maleId: PersonId
  femaleId: PersonId
  unionId: UnionId
} {
  const data = newGenogram()
  const maleId = addPerson(data, { sex: 'male', bloodRelation: 'direct', role: 'owner' })
  const femaleId = addPerson(data, { sex: 'female', bloodRelation: 'partner', partnerOrder: 1 })
  const unionId = addUnion(data, maleId, femaleId)
  return { data, maleId, femaleId, unionId }
}

export function scenarioNuclearFamily(): {
  data: GenogramPageData
  maleId: PersonId
  femaleId: PersonId
  unionId: UnionId
  child1Id: PersonId
  child2Id: PersonId
  childGroupId: ChildGroupId
} {
  const data = newGenogram()
  const maleId = addPerson(data, { sex: 'male', bloodRelation: 'direct', role: 'owner' })
  const femaleId = addPerson(data, { sex: 'female', bloodRelation: 'partner' })
  const unionId = addUnion(data, maleId, femaleId)
  const child1Id = addPerson(data, { sex: 'female', bloodRelation: 'direct' })
  const child2Id = addPerson(data, { sex: 'male', bloodRelation: 'direct' })
  const childGroupId = addChildGroup(data, unionId, [
    { kind: 'person', personId: child1Id },
    { kind: 'person', personId: child2Id },
  ])
  return { data, maleId, femaleId, unionId, child1Id, child2Id, childGroupId }
}

export function scenarioTwins(): {
  data: GenogramPageData
  unionId: UnionId
  twin1Id: PersonId
  twin2Id: PersonId
  birthGroupId: BirthGroupId
} {
  const data = newGenogram()
  const maleId = addPerson(data, { sex: 'male', bloodRelation: 'direct', role: 'owner' })
  const femaleId = addPerson(data, { sex: 'female', bloodRelation: 'partner' })
  const unionId = addUnion(data, maleId, femaleId)
  const twin1Id = addPerson(data, { sex: 'male', bloodRelation: 'direct' })
  const twin2Id = addPerson(data, { sex: 'female', bloodRelation: 'direct' })
  const birthGroupId = addBirthGroup(data, 'twins', [twin1Id, twin2Id])
  addChildGroup(data, unionId, [
    { kind: 'person', personId: twin1Id, birthGroupId },
    { kind: 'person', personId: twin2Id, birthGroupId },
  ])
  return { data, unionId, twin1Id, twin2Id, birthGroupId }
}

export function scenarioWithLoss(): {
  data: GenogramPageData
  childGroupId: ChildGroupId
  child1Id: PersonId
  child2Id: PersonId
  lossId: PregnancyLossId
} {
  const data = newGenogram()
  const maleId = addPerson(data, { sex: 'male', bloodRelation: 'direct', role: 'owner' })
  const femaleId = addPerson(data, { sex: 'female', bloodRelation: 'partner' })
  const unionId = addUnion(data, maleId, femaleId)
  const child1Id = addPerson(data, { sex: 'female', bloodRelation: 'direct' })
  const child2Id = addPerson(data, { sex: 'male', bloodRelation: 'direct' })
  const childGroupId = addChildGroup(data, unionId, [])
  const lossId = addPregnancyLoss(data, 'miscarriage', childGroupId)
  data.entities.childGroups[childGroupId]!.children = [
    { kind: 'person', personId: child1Id },
    { kind: 'loss', lossId },
    { kind: 'person', personId: child2Id },
  ]
  return { data, childGroupId, child1Id, child2Id, lossId }
}

/**
 * Three generations: grandparents → parent (+ their partner) → pivot (+ spouse).
 * Grandparents have one child (parent). Parent marries, has pivot as child.
 * Pivot has spouse, no kids yet.
 */
export function scenarioThreeGenerations(): {
  data: GenogramPageData
  grandpaId: PersonId
  grandmaId: PersonId
  parentId: PersonId
  parentSpouseId: PersonId
  pivotId: PersonId
  pivotSpouseId: PersonId
  grandparentUnionId: UnionId
  parentUnionId: UnionId
  pivotUnionId: UnionId
} {
  const data = newGenogram()
  const grandpaId = addPerson(data, { sex: 'male', bloodRelation: 'direct' })
  const grandmaId = addPerson(data, { sex: 'female', bloodRelation: 'partner' })
  const grandparentUnionId = addUnion(data, grandpaId, grandmaId)

  const parentId = addPerson(data, { sex: 'male', bloodRelation: 'direct' })
  addChildGroup(data, grandparentUnionId, [{ kind: 'person', personId: parentId }])

  const parentSpouseId = addPerson(data, { sex: 'female', bloodRelation: 'partner' })
  const parentUnionId = addUnion(data, parentId, parentSpouseId)

  const pivotId = addPerson(data, { sex: 'male', bloodRelation: 'direct', role: 'owner' })
  addChildGroup(data, parentUnionId, [{ kind: 'person', personId: pivotId }])

  const pivotSpouseId = addPerson(data, { sex: 'female', bloodRelation: 'partner' })
  const pivotUnionId = addUnion(data, pivotId, pivotSpouseId)

  return {
    data,
    grandpaId,
    grandmaId,
    parentId,
    parentSpouseId,
    pivotId,
    pivotSpouseId,
    grandparentUnionId,
    parentUnionId,
    pivotUnionId,
  }
}

/**
 * Complex 4-generation genogram inspired by the reference image.
 *
 * Scope of the v1 layout engine: one partner-union per direct-blood person.
 * The source image has three wives on the central male — that requires the
 * multi-partner extension which is still TODO. This fixture keeps the
 * **spirit** of the reference (spanning 4 generations, twin cluster with a
 * deceased member, `?` unknowns, abortions, early-death cross, owner inner
 * shape) but represents every blood-line person with a single marriage.
 *
 *   gen -3: 2 great-grandparent couples (paternal A, maternal D).
 *   gen -2:
 *     - PaternalGranFather (`?`, "nothing known about him") + PaternalGranMother.
 *     - MaternalGranFather + MaternalGranMother.
 *       MaternalGranMother has 6 younger sisters: 3 alive, 1 died at 2, and a
 *       twin pair where one died at birth — exactly as in the image annotation.
 *   gen -1:
 *     - Dad (direct) married to Mom (partner #1, divorced).
 *     - Dad's sibling drowned at 6 (early-death cross).
 *   gen 0:
 *     - Owner (female, inner circle) + siblings (35, 30, 16) + two abortions +
 *       one miscarriage — covering A/B pregnancy loss kinds.
 */
export function scenarioComplexGenogram(): {
  data: GenogramPageData
  ownerId: PersonId
} {
  const data = newGenogram()

  // ── gen -3: great-grandparents ─────────────────────
  const gpA_m = addPerson(data, { sex: 'male', bloodRelation: 'direct' })
  const gpA_f = addPerson(data, { sex: 'female', bloodRelation: 'direct' })
  const uA = addUnion(data, gpA_m, gpA_f)

  const gpD_m = addPerson(data, { sex: 'male', bloodRelation: 'direct' })
  const gpD_f = addPerson(data, { sex: 'female', bloodRelation: 'direct' })
  const uD = addUnion(data, gpD_m, gpD_f)

  // ── gen -2: grandparents ───────────────────────────
  const paternalGranFather = addPerson(data, {
    sex: 'male',
    bloodRelation: 'unknown',
    partnerOrder: 1,
    identity: { isUnknown: true },
  })
  const paternalGranMother = addPerson(data, {
    sex: 'female',
    bloodRelation: 'direct',
  })
  const uPaternalGran = addUnion(data, paternalGranFather, paternalGranMother)
  addChildGroup(data, uA, [{ kind: 'person', personId: paternalGranMother }])

  const maternalGranFather = addPerson(data, {
    sex: 'male',
    bloodRelation: 'direct',
  })
  const maternalGranMother = addPerson(data, {
    sex: 'female',
    bloodRelation: 'direct',
  })
  const uMaternalGran = addUnion(data, maternalGranFather, maternalGranMother)

  const sis1 = addPerson(data, { sex: 'female', bloodRelation: 'sibling' })
  const sis2 = addPerson(data, { sex: 'female', bloodRelation: 'sibling' })
  const sis3 = addPerson(data, { sex: 'female', bloodRelation: 'sibling' })
  const sis4dead = addPerson(data, {
    sex: 'female',
    bloodRelation: 'sibling',
    lifeDates: { lifeStatus: 'deceased', tragically: false },
  })
  const twin1 = addPerson(data, { sex: 'female', bloodRelation: 'sibling' })
  const twin2dead = addPerson(data, {
    sex: 'female',
    bloodRelation: 'sibling',
    lifeDates: { lifeStatus: 'deceased', tragically: false },
  })
  const twinBG = addBirthGroup(data, 'twins', [twin1, twin2dead])

  addChildGroup(data, uD, [
    { kind: 'person', personId: maternalGranMother },
    { kind: 'person', personId: sis1 },
    { kind: 'person', personId: sis2 },
    { kind: 'person', personId: sis3 },
    { kind: 'person', personId: sis4dead },
    { kind: 'person', personId: twin1, birthGroupId: twinBG },
    { kind: 'person', personId: twin2dead, birthGroupId: twinBG },
  ])

  // ── gen -1: parents ────────────────────────────────
  const dad = addPerson(data, { sex: 'male', bloodRelation: 'direct' })
  const deadUncle = addPerson(data, {
    sex: 'male',
    bloodRelation: 'sibling',
    lifeDates: { lifeStatus: 'deceased', tragically: false },
  })
  addChildGroup(data, uPaternalGran, [
    { kind: 'person', personId: dad },
    { kind: 'person', personId: deadUncle },
  ])

  const mom = addPerson(data, {
    sex: 'female',
    bloodRelation: 'partner',
    partnerOrder: 1,
  })
  addChildGroup(data, uMaternalGran, [{ kind: 'person', personId: mom }])

  const uParents = addUnion(data, dad, mom, {
    divorce: { custodySide: 'female' },
  })

  // ── gen 0: owner's generation ──────────────────────
  const son35 = addPerson(data, { sex: 'male', bloodRelation: 'direct' })
  const son30 = addPerson(data, { sex: 'male', bloodRelation: 'direct' })
  const daughter28 = addPerson(data, { sex: 'female', bloodRelation: 'direct' })
  const owner = addPerson(data, {
    sex: 'female',
    role: 'owner',
    bloodRelation: 'direct',
  })
  const son16 = addPerson(data, { sex: 'male', bloodRelation: 'direct' })

  const cgParents = addChildGroup(data, uParents)
  const abortion1 = addPregnancyLoss(data, 'abortion', cgParents)
  const abortion2 = addPregnancyLoss(data, 'abortion', cgParents)
  const miscarriage = addPregnancyLoss(data, 'miscarriage', cgParents)

  data.entities.childGroups[cgParents]!.children = [
    { kind: 'person', personId: son35 },
    { kind: 'person', personId: son30 },
    { kind: 'person', personId: daughter28 },
    { kind: 'loss', lossId: abortion1 },
    { kind: 'loss', lossId: abortion2 },
    { kind: 'person', personId: owner },
    { kind: 'loss', lossId: miscarriage },
    { kind: 'person', personId: son16 },
  ]

  return { data, ownerId: owner }
}
