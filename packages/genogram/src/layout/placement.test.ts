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
  const p = customId
    ? createPerson({ ...input, id: customId })
    : createPerson(input)
  data.entities.people[p.id] = p
  return p.id
}

function addUnion(
  data: GenogramPageData,
  maleId: PersonId,
  femaleId: PersonId,
): UnionId {
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
  // ── Fix 1: base in the middle ────────────────────────────────────────────

  it('N=2 partners: base is between p1 and p2 (slot 1 of 3)', () => {
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

    // base must be to the right of p1 and to the left of p2
    expect(baseX).toBeGreaterThan(p1X)
    expect(baseX).toBeLessThan(p2X)
  })

  it('N=3 partners: base is between p1 and p2 (slot 1 of 4)', () => {
    const { data, baseId, p1Id, p2Id, p3Id } = buildMultiPartnerFixture()
    const layout = computeLayout(data)
    const baseX = layout.positions[baseId]!.x
    const p1X = layout.positions[p1Id]!.x
    const p2X = layout.positions[p2Id]!.x
    const p3X = layout.positions[p3Id]!.x

    // linear order: p1 < base < p2 < p3
    expect(baseX).toBeGreaterThan(p1X)
    expect(baseX).toBeLessThan(p2X)
    expect(p2X).toBeLessThan(p3X)
  })

  it('N=4 partners: base is between p2 and p3 (slot 2 of 5)', () => {
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
    const p2X = layout.positions[p2Id]!.x
    const p3X = layout.positions[p3Id]!.x

    // linear order: p1 < p2 < base < p3 < p4
    expect(baseX).toBeGreaterThan(p2X)
    expect(baseX).toBeLessThan(p3X)
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
