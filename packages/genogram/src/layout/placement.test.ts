import { describe, expect, it } from 'vitest'
import { computeLayout } from './computeLayout'
import type { GenogramPageData } from '../types/page'
import type { PersonId, UnionId } from '../types/ids'
import {
  createEmptyGenogram,
  createPerson,
  createUnion,
  createChildGroup,
} from '../model/factories'

// ── fixture helpers ─────────────────────────────────────────────────────────

function addPerson(
  data: GenogramPageData,
  input: Parameters<typeof createPerson>[0],
  customId?: PersonId,
): PersonId {
  const p = customId ? createPerson({ ...input, id: customId }) : createPerson(input)
  data.entities.people[p.id] = p
  return p.id
}

function addUnion(data: GenogramPageData, maleId: PersonId, femaleId: PersonId): UnionId {
  const u = createUnion({ malePartnerId: maleId, femalePartnerId: femaleId })
  data.entities.unions[u.id] = u
  return u.id
}

/**
 * Add a union that also has a child group with one child person.
 * Returns the unionId and the child's personId.
 */
function addUnionWithChild(
  data: GenogramPageData,
  maleId: PersonId,
  femaleId: PersonId,
): { unionId: UnionId; childId: PersonId } {
  const childId = addPerson(data, { sex: 'male', bloodRelation: 'direct' })
  const cg = createChildGroup({
    unionId: 'placeholder' as UnionId, // will be overwritten
    children: [{ kind: 'person', personId: childId }],
  })
  const u = createUnion({
    malePartnerId: maleId,
    femalePartnerId: femaleId,
    childGroupId: cg.id,
  })
  cg.unionId = u.id
  data.entities.unions[u.id] = u
  data.entities.childGroups[cg.id] = cg
  return { unionId: u.id, childId }
}

/**
 * Single-partner fixture.
 * baseSex determines which participant is the "base" (direct blood, owner).
 * partnerSex determines the partner's sex.
 */
function buildSinglePartnerFixture(
  baseSex: 'male' | 'female',
  partnerSex: 'male' | 'female',
): { data: GenogramPageData; baseId: PersonId; partnerId: PersonId } {
  const data = createEmptyGenogram()
  const baseId = addPerson(data, { sex: baseSex, bloodRelation: 'direct', role: 'owner' })
  const partnerId = addPerson(data, { sex: partnerSex, bloodRelation: 'partner', partnerOrder: 1 })

  // Union requires malePartnerId + femalePartnerId
  if (baseSex === 'male') {
    addUnion(data, baseId, partnerId)
  } else {
    addUnion(data, partnerId, baseId)
  }

  return { data, baseId, partnerId }
}

/**
 * Multi-partner fixture: male base with 3 female partners (partnerOrder 1, 2, 3).
 */
function buildMultiPartnerFixture(): {
  data: GenogramPageData
  baseId: PersonId
  p1Id: PersonId
  p2Id: PersonId
  p3Id: PersonId
} {
  const data = createEmptyGenogram()
  const baseId = addPerson(data, { sex: 'male', bloodRelation: 'direct', role: 'owner' })
  const p1Id = addPerson(data, { sex: 'female', bloodRelation: 'partner', partnerOrder: 1 })
  const p2Id = addPerson(data, { sex: 'female', bloodRelation: 'partner', partnerOrder: 2 })
  const p3Id = addPerson(data, { sex: 'female', bloodRelation: 'partner', partnerOrder: 3 })

  addUnion(data, baseId, p1Id)
  addUnion(data, baseId, p2Id)
  addUnion(data, baseId, p3Id)

  return { data, baseId, p1Id, p2Id, p3Id }
}

// ── tests ───────────────────────────────────────────────────────────────────

describe('partner placement', () => {
  it('places single male partner left of female base', () => {
    const { data, baseId, partnerId } = buildSinglePartnerFixture('female', 'male')
    const layout = computeLayout(data)
    const baseX = layout.positions[baseId]!.x
    const partnerX = layout.positions[partnerId]!.x
    expect(partnerX).toBeLessThan(baseX)
  })

  it('places single female partner right of male base', () => {
    const { data, baseId, partnerId } = buildSinglePartnerFixture('male', 'female')
    const layout = computeLayout(data)
    const baseX = layout.positions[baseId]!.x
    const partnerX = layout.positions[partnerId]!.x
    expect(partnerX).toBeGreaterThan(baseX)
  })

  it('orders 3 partners by partnerOrder ascending left-to-right', () => {
    const { data, p1Id, p2Id, p3Id } = buildMultiPartnerFixture()
    const layout = computeLayout(data)
    expect(layout.positions[p1Id]!.x).toBeLessThan(layout.positions[p2Id]!.x)
    expect(layout.positions[p2Id]!.x).toBeLessThan(layout.positions[p3Id]!.x)
  })

  it('all partners on same Y as base (one hierarchy line)', () => {
    const { data, baseId, p1Id, p2Id } = buildMultiPartnerFixture()
    const layout = computeLayout(data)
    const baseY = layout.positions[baseId]!.y
    expect(layout.positions[p1Id]!.y).toBe(baseY)
    expect(layout.positions[p2Id]!.y).toBe(baseY)
  })
})

describe('multi-partner layout — base in middle, children placed, anchor at base↔partner', () => {
  // ── Base sits opposite to its partners ───────────────────────────────────

  it('N=2 partners (male base): base is leftmost, partners ordered to its right', () => {
    const data = createEmptyGenogram()
    const baseId = addPerson(data, { sex: 'male', bloodRelation: 'direct', role: 'owner' })
    const p1Id = addPerson(data, { sex: 'female', bloodRelation: 'partner', partnerOrder: 1 })
    const p2Id = addPerson(data, { sex: 'female', bloodRelation: 'partner', partnerOrder: 2 })
    addUnion(data, baseId, p1Id)
    addUnion(data, baseId, p2Id)

    const layout = computeLayout(data)
    const baseX = layout.positions[baseId]!.x
    const p1X = layout.positions[p1Id]!.x
    const p2X = layout.positions[p2Id]!.x

    // base on left, then partners by partnerOrder ascending
    expect(baseX).toBeLessThan(p1X)
    expect(p1X).toBeLessThan(p2X)
  })

  it('N=3 partners (male base): base on left, partners ordered to its right', () => {
    const { data, baseId, p1Id, p2Id, p3Id } = buildMultiPartnerFixture()
    const layout = computeLayout(data)
    const baseX = layout.positions[baseId]!.x
    const p1X = layout.positions[p1Id]!.x
    const p2X = layout.positions[p2Id]!.x
    const p3X = layout.positions[p3Id]!.x

    // linear order: base < p1 < p2 < p3
    expect(baseX).toBeLessThan(p1X)
    expect(p1X).toBeLessThan(p2X)
    expect(p2X).toBeLessThan(p3X)
  })

  it('N=4 partners (male base): base on left, partners ordered to its right', () => {
    const data = createEmptyGenogram()
    const baseId = addPerson(data, { sex: 'male', bloodRelation: 'direct', role: 'owner' })
    const p1Id = addPerson(data, { sex: 'female', bloodRelation: 'partner', partnerOrder: 1 })
    const p2Id = addPerson(data, { sex: 'female', bloodRelation: 'partner', partnerOrder: 2 })
    const p3Id = addPerson(data, { sex: 'female', bloodRelation: 'partner', partnerOrder: 3 })
    const p4Id = addPerson(data, { sex: 'female', bloodRelation: 'partner', partnerOrder: 4 })
    addUnion(data, baseId, p1Id)
    addUnion(data, baseId, p2Id)
    addUnion(data, baseId, p3Id)
    addUnion(data, baseId, p4Id)

    const layout = computeLayout(data)
    const baseX = layout.positions[baseId]!.x
    const p1X = layout.positions[p1Id]!.x
    const p4X = layout.positions[p4Id]!.x

    // linear order: base < p1 < ... < p4
    expect(baseX).toBeLessThan(p1X)
    expect(p1X).toBeLessThan(p4X)
  })

  it('female base: partners on the left ordered ascending, base on the right', () => {
    const data = createEmptyGenogram()
    const baseId = addPerson(data, { sex: 'female', bloodRelation: 'direct', role: 'owner' })
    const p1Id = addPerson(data, { sex: 'male', bloodRelation: 'partner', partnerOrder: 1 })
    const p2Id = addPerson(data, { sex: 'male', bloodRelation: 'partner', partnerOrder: 2 })
    addUnion(data, p1Id, baseId)
    addUnion(data, p2Id, baseId)

    const layout = computeLayout(data)
    const baseX = layout.positions[baseId]!.x
    const p1X = layout.positions[p1Id]!.x
    const p2X = layout.positions[p2Id]!.x

    // linear order: p1 < p2 < base — newest partner sits closest to base
    expect(p1X).toBeLessThan(p2X)
    expect(p2X).toBeLessThan(baseX)
  })

  // ── Fix 2: children are placed ───────────────────────────────────────────

  it('children of a multi-partner union receive positions', () => {
    const data = createEmptyGenogram()
    const baseId = addPerson(data, { sex: 'male', bloodRelation: 'direct', role: 'owner' })
    const p1Id = addPerson(data, { sex: 'female', bloodRelation: 'partner', partnerOrder: 1 })
    const p2Id = addPerson(data, { sex: 'female', bloodRelation: 'partner', partnerOrder: 2 })

    // p1 union has a child; p2 union has no child
    const { childId } = addUnionWithChild(data, baseId, p1Id)
    addUnion(data, baseId, p2Id)

    const layout = computeLayout(data)

    // Child must have a position assigned
    expect(layout.positions[childId]).toBeDefined()
    // Child must be below the partner row (y > baseY)
    const baseY = layout.positions[baseId]!.y
    expect(layout.positions[childId]!.y).toBeGreaterThan(baseY)
  })

  it('children of two different multi-partner unions are both placed', () => {
    const data = createEmptyGenogram()
    const baseId = addPerson(data, { sex: 'male', bloodRelation: 'direct', role: 'owner' })
    const p1Id = addPerson(data, { sex: 'female', bloodRelation: 'partner', partnerOrder: 1 })
    const p2Id = addPerson(data, { sex: 'female', bloodRelation: 'partner', partnerOrder: 2 })

    const { childId: child1Id } = addUnionWithChild(data, baseId, p1Id)
    const { childId: child2Id } = addUnionWithChild(data, baseId, p2Id)

    const layout = computeLayout(data)

    expect(layout.positions[child1Id]).toBeDefined()
    expect(layout.positions[child2Id]).toBeDefined()
    const baseY = layout.positions[baseId]!.y
    expect(layout.positions[child1Id]!.y).toBeGreaterThan(baseY)
    expect(layout.positions[child2Id]!.y).toBeGreaterThan(baseY)
  })

  // ── Fix 3: union anchor at midpoint base ↔ partner ───────────────────────

  it('union anchor is at midpoint between base and its partner', () => {
    const data = createEmptyGenogram()
    const baseId = addPerson(data, { sex: 'male', bloodRelation: 'direct', role: 'owner' })
    const p1Id = addPerson(data, { sex: 'female', bloodRelation: 'partner', partnerOrder: 1 })
    const p2Id = addPerson(data, { sex: 'female', bloodRelation: 'partner', partnerOrder: 2 })
    const u1Id = addUnion(data, baseId, p1Id)
    const u2Id = addUnion(data, baseId, p2Id)

    const layout = computeLayout(data)
    const baseX = layout.positions[baseId]!.x
    const p1X = layout.positions[p1Id]!.x
    const p2X = layout.positions[p2Id]!.x
    const u1X = layout.positions[u1Id]!.x
    const u2X = layout.positions[u2Id]!.x

    // Each union anchor should be halfway between base and its partner
    expect(u1X).toBeCloseTo((baseX + p1X) / 2, 5)
    expect(u2X).toBeCloseTo((baseX + p2X) / 2, 5)
  })
})

describe('children placement', () => {
  it('places children left-to-right in ChildGroup.children order', () => {
    const data = buildFixtureWithChildren()
    const layout = computeLayout(data)
    expect(layout.positions['c1' as PersonId]!.x).toBeLessThan(
      layout.positions['c2' as PersonId]!.x,
    )
    expect(layout.positions['c2' as PersonId]!.x).toBeLessThan(
      layout.positions['c3' as PersonId]!.x,
    )
  })
})

describe('cross-subtree placement bugs (regression)', () => {
  it('only mother has parents: father+mother couple stays apart, owner inside their bracket', () => {
    // Reproduces the user-reported scenario: owner with both parents,
    // then "Add parents" called only on the mother. Previously the
    // reconciliation centred mother under her grandparents but didn't
    // shift father with her, so father and mother shapes overlapped and
    // father's label was hidden under mother's circle. The fix shifts
    // father (a "floating" partner with no own parents) along with mother
    // by the same delta, preserving couple distance.
    const data = createEmptyGenogram()
    const fatherId = addPerson(data, { sex: 'male', bloodRelation: 'direct' })
    const motherId = addPerson(data, { sex: 'female', bloodRelation: 'direct' })
    const ownerId = addPerson(data, { sex: 'male', bloodRelation: 'direct', role: 'owner' })

    const cgOwner = createChildGroup({
      unionId: 'placeholder' as UnionId,
      children: [{ kind: 'person', personId: ownerId }],
    })
    const uOwner = createUnion({
      malePartnerId: fatherId,
      femalePartnerId: motherId,
      childGroupId: cgOwner.id,
    })
    cgOwner.unionId = uOwner.id
    data.entities.unions[uOwner.id] = uOwner
    data.entities.childGroups[cgOwner.id] = cgOwner

    // Only mother gets parents
    const motherFather = addPerson(data, { sex: 'male', bloodRelation: 'direct' })
    const motherMother = addPerson(data, { sex: 'female', bloodRelation: 'direct' })
    const cgMother = createChildGroup({
      unionId: 'placeholder' as UnionId,
      children: [{ kind: 'person', personId: motherId }],
    })
    const uMother = createUnion({
      malePartnerId: motherFather,
      femalePartnerId: motherMother,
      childGroupId: cgMother.id,
    })
    cgMother.unionId = uMother.id
    data.entities.unions[uMother.id] = uMother
    data.entities.childGroups[cgMother.id] = cgMother

    const layout = computeLayout(data)
    const fatherX = layout.positions[fatherId]!.x
    const motherX = layout.positions[motherId]!.x
    const ownerX = layout.positions[ownerId]!.x

    // Father stays left of mother (men on the left).
    expect(fatherX).toBeLessThan(motherX)
    // Couple distance preserved — father shape (PERSON_BIG=80) and mother
    // shape don't overlap. Center distance must be ≥ PERSON_BIG so that
    // their right/left edges meet exactly at PARTNER_GAP=0 in the worst
    // case; the layout actually keeps PARTNER_GAP=48 so distance ≥ 128.
    expect(motherX - fatherX).toBeGreaterThanOrEqual(80)
    // Owner stays inside the father+mother bracket horizontal.
    expect(ownerX).toBeGreaterThan(fatherX)
    expect(ownerX).toBeLessThan(motherX)
  })


  it("solo child of multi-partner couple: owner.x ≠ mother.x so the child's vertical isn't collinear with the partner's bracket leg", () => {
    // Reproduces the user-reported scenario: owner with two parents, then
    // father gets a second wife. Before the fix, the owner sat directly
    // under mother (the partner-slot centre), so the cross+child line
    // looked like one straight line from mother through the bracket down
    // to owner. The fix is to centre children under the union midpoint.
    const data = createEmptyGenogram()
    const fatherId = addPerson(data, { sex: 'male', bloodRelation: 'direct', role: 'owner' })
    const motherId = addPerson(data, {
      sex: 'female',
      bloodRelation: 'partner',
      partnerOrder: 1,
    })
    const stepMotherId = addPerson(data, {
      sex: 'female',
      bloodRelation: 'partner',
      partnerOrder: 2,
    })
    const ownerId = addPerson(data, { sex: 'male', bloodRelation: 'direct' })

    const cg1 = createChildGroup({
      unionId: 'placeholder' as UnionId,
      children: [{ kind: 'person', personId: ownerId }],
    })
    const u1 = createUnion({
      malePartnerId: fatherId,
      femalePartnerId: motherId,
      childGroupId: cg1.id,
    })
    cg1.unionId = u1.id
    data.entities.unions[u1.id] = u1
    data.entities.childGroups[cg1.id] = cg1
    addUnion(data, fatherId, stepMotherId)

    const layout = computeLayout(data)
    const fatherX = layout.positions[fatherId]!.x
    const motherX = layout.positions[motherId]!.x
    const ownerX = layout.positions[ownerId]!.x

    // Owner must be strictly between mother and father — never collinear
    // with the partner's bracket leg.
    expect(ownerX).not.toBe(motherX)
    expect(ownerX).not.toBe(fatherX)
    expect(ownerX).toBeGreaterThan(fatherX)
    expect(ownerX).toBeLessThan(motherX)
  })

  it('grandparents on both sides: father lineage on the left, mother on the right (regardless of insertion order)', () => {
    // Reproduces the user-reported scenario: mother gets parents first,
    // then father gets parents. Insertion order alone would put mother's
    // parents on the left, violating the "men on the left" rule. The
    // root-leaning sort fixes the placement.
    const data = createEmptyGenogram()
    const fatherId = addPerson(data, { sex: 'male', bloodRelation: 'direct' })
    const motherId = addPerson(data, { sex: 'female', bloodRelation: 'direct' })
    const ownerId = addPerson(data, { sex: 'male', bloodRelation: 'direct', role: 'owner' })

    const cg = createChildGroup({
      unionId: 'placeholder' as UnionId,
      children: [{ kind: 'person', personId: ownerId }],
    })
    const u = createUnion({
      malePartnerId: fatherId,
      femalePartnerId: motherId,
      childGroupId: cg.id,
    })
    cg.unionId = u.id
    data.entities.unions[u.id] = u
    data.entities.childGroups[cg.id] = cg

    // Mother's parents added FIRST (mimics step 2 of the user's scenario)
    const motherFather = addPerson(data, { sex: 'male', bloodRelation: 'direct' })
    const motherMother = addPerson(data, { sex: 'female', bloodRelation: 'direct' })
    const cgMother = createChildGroup({
      unionId: 'placeholder' as UnionId,
      children: [{ kind: 'person', personId: motherId }],
    })
    const uMother = createUnion({
      malePartnerId: motherFather,
      femalePartnerId: motherMother,
      childGroupId: cgMother.id,
    })
    cgMother.unionId = uMother.id
    data.entities.unions[uMother.id] = uMother
    data.entities.childGroups[cgMother.id] = cgMother

    // Father's parents added SECOND (mimics step 3 of the user's scenario)
    const fatherFather = addPerson(data, { sex: 'male', bloodRelation: 'direct' })
    const fatherMother = addPerson(data, { sex: 'female', bloodRelation: 'direct' })
    const cgFather = createChildGroup({
      unionId: 'placeholder' as UnionId,
      children: [{ kind: 'person', personId: fatherId }],
    })
    const uFather = createUnion({
      malePartnerId: fatherFather,
      femalePartnerId: fatherMother,
      childGroupId: cgFather.id,
    })
    cgFather.unionId = uFather.id
    data.entities.unions[uFather.id] = uFather
    data.entities.childGroups[cgFather.id] = cgFather

    const layout = computeLayout(data)
    const fatherX = layout.positions[fatherId]!.x
    const motherX = layout.positions[motherId]!.x
    const ownerX = layout.positions[ownerId]!.x
    const fatherFatherX = layout.positions[fatherFather]!.x
    const motherFatherX = layout.positions[motherFather]!.x

    // Father's lineage on the left, mother's on the right
    expect(fatherFatherX).toBeLessThan(motherFatherX)
    // Father (male) on the left of his own union
    expect(fatherX).toBeLessThan(motherX)
    // Owner stays inside the father+mother bracket horizontal — the
    // post-placement reconciliation re-centres owner on the final bracket
    // midpoint instead of an off-screen, stale x from the first root.
    expect(ownerX).toBeGreaterThanOrEqual(fatherX)
    expect(ownerX).toBeLessThanOrEqual(motherX)
  })
})

function buildFixtureWithChildren(): GenogramPageData {
  const data = createEmptyGenogram()

  const fatherId = addPerson(data, { sex: 'male', bloodRelation: 'direct', role: 'owner' })
  const motherId = addPerson(data, { sex: 'female', bloodRelation: 'partner', partnerOrder: 1 })

  const c1Id = addPerson(data, { sex: 'male', bloodRelation: 'direct' }, 'c1' as PersonId)
  const c2Id = addPerson(data, { sex: 'female', bloodRelation: 'direct' }, 'c2' as PersonId)
  const c3Id = addPerson(data, { sex: 'male', bloodRelation: 'direct' }, 'c3' as PersonId)

  const cg = createChildGroup({
    unionId: 'placeholder' as UnionId,
    children: [
      { kind: 'person', personId: c1Id },
      { kind: 'person', personId: c2Id },
      { kind: 'person', personId: c3Id },
    ],
  })
  const u = createUnion({
    malePartnerId: fatherId,
    femalePartnerId: motherId,
    childGroupId: cg.id,
  })
  cg.unionId = u.id
  data.entities.unions[u.id] = u
  data.entities.childGroups[cg.id] = cg

  return data
}
