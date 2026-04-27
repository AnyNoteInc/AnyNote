import { describe, expect, it } from 'vitest'
import { computeLayout } from './computeLayout'
import type { GenogramPageData } from '../types/page'
import type { PersonId } from '../types/ids'
import {
  createEmptyGenogram,
  createPerson,
  createUnion,
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
): void {
  const u = createUnion({ malePartnerId: maleId, femalePartnerId: femaleId })
  data.entities.unions[u.id] = u
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
