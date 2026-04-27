import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import {
  addBirthGroup,
  addChildGroup,
  addChildren,
  addParents,
  addPartner,
  addPerson,
  addPregnancyLoss,
  addUnion,
  appendChild,
  createOwnerWithParents,
  getMeta,
  removePerson,
  setMeta,
  setPartnerOrder,
  setUnionDivorce,
  updatePerson,
} from './actions'
import type { PersonId } from '../types'
import { assembleDomain } from './assembleDomain'
import { hydrateDoc } from './hydrateDoc'
import { snapshotFromDoc } from './snapshotFromDoc'

describe('yjs actions', () => {
  it('addPerson persists into Y.Doc and assembleDomain roundtrips', () => {
    const doc = new Y.Doc()
    const p = addPerson(doc, { sex: 'male', bloodRelation: 'direct', role: 'owner' })

    const domain = assembleDomain(doc)
    expect(domain.entities.people[p.id]).toEqual(p)
    expect(domain.version).toBe(1)
  })

  it('addChildGroup auto-links union.childGroupId', () => {
    const doc = new Y.Doc()
    const male = addPerson(doc, { sex: 'male', bloodRelation: 'direct' })
    const female = addPerson(doc, { sex: 'female', bloodRelation: 'partner' })
    const union = addUnion(doc, { malePartnerId: male.id, femalePartnerId: female.id })
    const cg = addChildGroup(doc, { unionId: union.id })

    const domain = assembleDomain(doc)
    expect(domain.entities.unions[union.id]!.childGroupId).toBe(cg.id)
    expect(domain.entities.childGroups[cg.id]!.unionId).toBe(union.id)
  })

  it('appendChild adds to ordering', () => {
    const doc = new Y.Doc()
    const male = addPerson(doc, { sex: 'male', bloodRelation: 'direct' })
    const female = addPerson(doc, { sex: 'female', bloodRelation: 'partner' })
    const union = addUnion(doc, { malePartnerId: male.id, femalePartnerId: female.id })
    const cg = addChildGroup(doc, { unionId: union.id })
    const child1 = addPerson(doc, { sex: 'female', bloodRelation: 'direct' })
    const child2 = addPerson(doc, { sex: 'male', bloodRelation: 'direct' })

    appendChild(doc, cg.id, { kind: 'person', personId: child1.id })
    appendChild(doc, cg.id, { kind: 'person', personId: child2.id })

    const domain = assembleDomain(doc)
    expect(domain.entities.childGroups[cg.id]!.children).toEqual([
      { kind: 'person', personId: child1.id },
      { kind: 'person', personId: child2.id },
    ])
  })

  it('setUnionDivorce toggles divorce field', () => {
    const doc = new Y.Doc()
    const male = addPerson(doc, { sex: 'male', bloodRelation: 'direct' })
    const female = addPerson(doc, { sex: 'female', bloodRelation: 'partner' })
    const union = addUnion(doc, { malePartnerId: male.id, femalePartnerId: female.id })

    setUnionDivorce(doc, union.id, { date: '2020-06-01', custodySide: 'female' })
    let domain = assembleDomain(doc)
    expect(domain.entities.unions[union.id]!.divorce).toEqual({
      date: '2020-06-01',
      custodySide: 'female',
    })

    setUnionDivorce(doc, union.id, undefined)
    domain = assembleDomain(doc)
    expect(domain.entities.unions[union.id]!.divorce).toBeUndefined()
  })

  it('updatePerson merges patch, id is immutable', () => {
    const doc = new Y.Doc()
    const p = addPerson(doc, { sex: 'male', bloodRelation: 'direct' })
    updatePerson(doc, p.id, {
      identity: { firstName: 'Иван' },
      lifeDates: { isDeceased: true, deathKind: 'tragic' },
    })

    const domain = assembleDomain(doc)
    const updated = domain.entities.people[p.id]!
    expect(updated.id).toBe(p.id)
    expect(updated.identity.firstName).toBe('Иван')
    expect(updated.lifeDates.isDeceased).toBe(true)
    expect(updated.lifeDates.deathKind).toBe('tragic')
  })

  it('removePerson deletes from the Y.Map', () => {
    const doc = new Y.Doc()
    const p = addPerson(doc, { sex: 'male', bloodRelation: 'direct' })
    expect(assembleDomain(doc).entities.people[p.id]).toBeDefined()
    removePerson(doc, p.id)
    expect(assembleDomain(doc).entities.people[p.id]).toBeUndefined()
  })

  it('birth groups and pregnancy losses roundtrip', () => {
    const doc = new Y.Doc()
    const male = addPerson(doc, { sex: 'male', bloodRelation: 'direct' })
    const female = addPerson(doc, { sex: 'female', bloodRelation: 'partner' })
    const union = addUnion(doc, { malePartnerId: male.id, femalePartnerId: female.id })
    const cg = addChildGroup(doc, { unionId: union.id })
    const t1 = addPerson(doc, { sex: 'male', bloodRelation: 'direct' })
    const t2 = addPerson(doc, { sex: 'female', bloodRelation: 'direct' })
    const bg = addBirthGroup(doc, { kind: 'twins', memberIds: [t1.id, t2.id] })
    const loss = addPregnancyLoss(doc, { kind: 'miscarriage', childGroupId: cg.id })

    appendChild(doc, cg.id, { kind: 'person', personId: t1.id, birthGroupId: bg.id })
    appendChild(doc, cg.id, { kind: 'person', personId: t2.id, birthGroupId: bg.id })
    appendChild(doc, cg.id, { kind: 'loss', lossId: loss.id })

    const domain = assembleDomain(doc)
    expect(domain.entities.birthGroups[bg.id]!.memberIds).toEqual([t1.id, t2.id])
    expect(domain.entities.pregnancyLosses[loss.id]!.kind).toBe('miscarriage')
    expect(domain.entities.childGroups[cg.id]!.children).toHaveLength(3)
  })
})

describe('hydrate + snapshot roundtrip', () => {
  it('hydrateDoc followed by assembleDomain reproduces the input', () => {
    const srcDoc = new Y.Doc()
    const male = addPerson(srcDoc, { sex: 'male', bloodRelation: 'direct', role: 'owner' })
    const female = addPerson(srcDoc, { sex: 'female', bloodRelation: 'partner' })
    const union = addUnion(srcDoc, { malePartnerId: male.id, femalePartnerId: female.id })
    const cg = addChildGroup(srcDoc, { unionId: union.id })
    const child = addPerson(srcDoc, { sex: 'female', bloodRelation: 'direct' })
    appendChild(srcDoc, cg.id, { kind: 'person', personId: child.id })

    const snapshot = snapshotFromDoc(srcDoc)

    const targetDoc = new Y.Doc()
    hydrateDoc(targetDoc, snapshot)
    const rehydrated = assembleDomain(targetDoc)

    expect(rehydrated).toEqual(snapshot)
  })

  it('snapshotFromDoc validates via zod and throws on corruption', () => {
    const doc = new Y.Doc()
    // Inject a person with an invalid sex value directly
    doc.getMap('genogram.people').set('bad', {
      id: 'bad',
      sex: 'nope',
      role: 'regular',
      size: 'big',
      bloodRelation: 'direct',
      identity: {},
      lifeDates: { isDeceased: false },
      profile: {},
      label: {},
    })
    expect(() => snapshotFromDoc(doc)).toThrow()
  })

  it('empty doc produces valid empty snapshot', () => {
    const doc = new Y.Doc()
    const snap = snapshotFromDoc(doc)
    expect(snap.version).toBe(1)
    expect(snap.entities.people).toEqual({})
    expect(snap.annotations).toEqual({})
  })
})

describe('meta', () => {
  it('returns null when meta empty', () => {
    const doc = new Y.Doc()
    expect(getMeta(doc)).toBeNull()
  })

  it('roundtrips createdAt and ownerId', () => {
    const doc = new Y.Doc()
    setMeta(doc, { createdAt: '2026-04-27T00:00:00Z', ownerId: 'p1' as PersonId })
    expect(getMeta(doc)).toEqual({ createdAt: '2026-04-27T00:00:00Z', ownerId: 'p1' })
  })
})

describe('createOwnerWithParents', () => {
  it('creates owner + father + mother + union + childGroup; sets meta', () => {
    const doc = new Y.Doc()
    const result = createOwnerWithParents(doc, {
      firstName: 'Иван',
      lastName: 'Иванов',
      sex: 'male',
      birthDate: { day: 5, month: 3, year: 1984 },
    })

    const domain = assembleDomain(doc)
    const owner = domain.entities.people[result.ownerId]!
    expect(owner.role).toBe('owner')
    expect(owner.size).toBe('big')
    expect(owner.sex).toBe('male')
    expect(owner.identity.firstName).toBe('Иван')
    expect(owner.lifeDates.lifeStatus).toBe('alive')
    expect(owner.lifeDates.birthDate).toEqual({ day: 5, month: 3, year: 1984 })

    const father = domain.entities.people[result.fatherId]!
    expect(father.role).toBe('regular')
    expect(father.sex).toBe('male')
    expect(father.identity.isUnknown).toBe(true)
    expect(father.lifeDates.lifeStatus).toBe('unknown')

    const mother = domain.entities.people[result.motherId]!
    expect(mother.sex).toBe('female')
    expect(mother.identity.isUnknown).toBe(true)

    const union = domain.entities.unions[result.unionId]!
    expect(union.kind).toBe('marriage')
    expect(union.malePartnerId).toBe(result.fatherId)
    expect(union.femalePartnerId).toBe(result.motherId)

    const cg = domain.entities.childGroups[result.childGroupId]!
    expect(cg.unionId).toBe(result.unionId)
    expect(cg.children).toHaveLength(1)
    expect(cg.children[0]).toEqual({ kind: 'person', personId: result.ownerId })

    const meta = getMeta(doc)
    expect(meta?.ownerId).toBe(result.ownerId)
    expect(meta?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('female owner produces female owner shape', () => {
    const doc = new Y.Doc()
    const result = createOwnerWithParents(doc, { sex: 'female' })
    expect(assembleDomain(doc).entities.people[result.ownerId]!.sex).toBe('female')
  })
})

describe('addParents', () => {
  it('creates two unknown parents and a marriage union with the child', () => {
    const doc = new Y.Doc()
    const child = addPerson(doc, {
      sex: 'male',
      bloodRelation: 'direct',
      role: 'regular',
      size: 'big',
      identity: {},
      lifeDates: { birthMode: 'date', lifeStatus: 'alive' },
      profile: {},
    })
    const result = addParents(doc, child.id)

    const domain = assembleDomain(doc)
    expect(domain.entities.people[result.fatherId]!.sex).toBe('male')
    expect(domain.entities.people[result.fatherId]!.identity.isUnknown).toBe(true)
    expect(domain.entities.people[result.motherId]!.sex).toBe('female')
    expect(domain.entities.people[result.motherId]!.identity.isUnknown).toBe(true)
    expect(domain.entities.unions[result.unionId]!.kind).toBe('marriage')
    const cg = domain.entities.childGroups[result.childGroupId]!
    expect(cg.children).toEqual([{ kind: 'person', personId: child.id }])
  })

  it('throws when child already has parents', () => {
    const doc = new Y.Doc()
    const owner = createOwnerWithParents(doc, { sex: 'male' })
    expect(() => addParents(doc, owner.ownerId)).toThrow()
  })
})

describe('addPartner', () => {
  it('creates partner with opposite sex and union (newPartnerOrder=1 → no ordinals)', () => {
    const doc = new Y.Doc()
    const owner = createOwnerWithParents(doc, { sex: 'male' })
    const result = addPartner(
      doc,
      owner.ownerId,
      { firstName: 'Анна', sex: 'female', lifeStatus: 'alive', birthMode: 'date' },
      { kind: 'marriage', startDate: { day: 5, month: 6, year: 2020 } },
      1,
    )

    const domain = assembleDomain(doc)
    const partner = domain.entities.people[result.partnerId]!
    expect(partner.sex).toBe('female')
    expect(partner.partnerOrder).toBeUndefined()
    expect(domain.entities.unions[result.unionId]!.kind).toBe('marriage')
  })

  it('with newPartnerOrder=2 numbers existing partner=1 and new partner=2', () => {
    const doc = new Y.Doc()
    const owner = createOwnerWithParents(doc, { sex: 'male' })
    const wife1 = addPartner(doc, owner.ownerId,
      { firstName: 'Анна', sex: 'female', lifeStatus: 'alive', birthMode: 'date' },
      { kind: 'marriage' }, 1)
    const wife2 = addPartner(doc, owner.ownerId,
      { firstName: 'Мария', sex: 'female', lifeStatus: 'alive', birthMode: 'date' },
      { kind: 'marriage' }, 2)

    const domain = assembleDomain(doc)
    expect(domain.entities.people[wife1.partnerId]!.partnerOrder).toBe(1)
    expect(domain.entities.people[wife2.partnerId]!.partnerOrder).toBe(2)
  })
})

describe('setPartnerOrder', () => {
  it('swaps partner ordinals when moving partner #1 to #2', () => {
    const doc = new Y.Doc()
    const owner = createOwnerWithParents(doc, { sex: 'male' })
    const w1 = addPartner(doc, owner.ownerId,
      { firstName: 'Анна', sex: 'female', lifeStatus: 'alive', birthMode: 'date' },
      { kind: 'marriage' }, 1)
    const w2 = addPartner(doc, owner.ownerId,
      { firstName: 'Мария', sex: 'female', lifeStatus: 'alive', birthMode: 'date' },
      { kind: 'marriage' }, 2)

    setPartnerOrder(doc, w1.partnerId, 2)

    const domain = assembleDomain(doc)
    expect(domain.entities.people[w1.partnerId]!.partnerOrder).toBe(2)
    expect(domain.entities.people[w2.partnerId]!.partnerOrder).toBe(1)
  })

  it('throws when newOrder out of range', () => {
    const doc = new Y.Doc()
    const owner = createOwnerWithParents(doc, { sex: 'male' })
    const w1 = addPartner(doc, owner.ownerId,
      { firstName: 'Анна', sex: 'female', lifeStatus: 'alive', birthMode: 'date' },
      { kind: 'marriage' }, 1)
    const w2 = addPartner(doc, owner.ownerId,
      { firstName: 'Мария', sex: 'female', lifeStatus: 'alive', birthMode: 'date' },
      { kind: 'marriage' }, 2)
    void w2

    expect(() => setPartnerOrder(doc, w1.partnerId, 0)).toThrow(RangeError)
    expect(() => setPartnerOrder(doc, w1.partnerId, 5)).toThrow(RangeError)
  })

  it('throws when person is not a partner of any base', () => {
    const doc = new Y.Doc()
    const orphan = addPerson(doc, {
      sex: 'male',
      bloodRelation: 'direct',
      role: 'regular',
      size: 'big',
      identity: {},
      lifeDates: { birthMode: 'date', lifeStatus: 'alive' },
    })
    expect(() => setPartnerOrder(doc, orphan.id, 1)).toThrow()
  })

  it('reorders 3 partners moving #1 to #3 → ordinals dense 1..3', () => {
    const doc = new Y.Doc()
    const owner = createOwnerWithParents(doc, { sex: 'male' })
    const w1 = addPartner(doc, owner.ownerId,
      { firstName: 'A', sex: 'female', lifeStatus: 'alive', birthMode: 'date' },
      { kind: 'marriage' }, 1)
    const w2 = addPartner(doc, owner.ownerId,
      { firstName: 'B', sex: 'female', lifeStatus: 'alive', birthMode: 'date' },
      { kind: 'marriage' }, 2)
    const w3 = addPartner(doc, owner.ownerId,
      { firstName: 'C', sex: 'female', lifeStatus: 'alive', birthMode: 'date' },
      { kind: 'marriage' }, 3)

    setPartnerOrder(doc, w1.partnerId, 3)

    const domain = assembleDomain(doc)
    expect(domain.entities.people[w1.partnerId]!.partnerOrder).toBe(3)
    expect(domain.entities.people[w2.partnerId]!.partnerOrder).toBe(1)
    expect(domain.entities.people[w3.partnerId]!.partnerOrder).toBe(2)
  })
})

describe('addChildren', () => {
  it('adds Person and PregnancyLoss entries to ChildGroup', () => {
    const doc = new Y.Doc()
    const owner = createOwnerWithParents(doc, { sex: 'male' })
    const partner = addPartner(doc, owner.ownerId,
      { firstName: 'Анна', sex: 'female', lifeStatus: 'alive', birthMode: 'date' },
      { kind: 'marriage' }, 1)

    addChildren(doc, partner.unionId, [
      { type: 'person', data: { firstName: 'Лиза', sex: 'female', lifeStatus: 'alive', birthMode: 'date' } },
      { type: 'miscarriage', date: { day: 5, month: 4, year: 2020 } },
    ])

    const domain = assembleDomain(doc)
    const childGroups = Object.values(domain.entities.childGroups)
    const cg = childGroups.find((c) => c.unionId === partner.unionId)!
    expect(cg.children).toHaveLength(2)
    expect(cg.children[0]!.kind).toBe('person')
    expect(cg.children[1]!.kind).toBe('loss')
  })

  it('reorders existing children when reorderExisting is provided', () => {
    const doc = new Y.Doc()
    const owner = createOwnerWithParents(doc, { sex: 'male' })
    const partner = addPartner(doc, owner.ownerId,
      { firstName: 'Анна', sex: 'female', lifeStatus: 'alive', birthMode: 'date' },
      { kind: 'marriage' }, 1)

    addChildren(doc, partner.unionId, [
      { type: 'person', data: { firstName: 'A', sex: 'female', lifeStatus: 'alive', birthMode: 'date' } },
      { type: 'person', data: { firstName: 'B', sex: 'male', lifeStatus: 'alive', birthMode: 'date' } },
    ])

    let domain = assembleDomain(doc)
    let cg = Object.values(domain.entities.childGroups).find((c) => c.unionId === partner.unionId)!
    const reversed = [...cg.children].reverse()

    addChildren(doc, partner.unionId, [], reversed)

    domain = assembleDomain(doc)
    cg = Object.values(domain.entities.childGroups).find((c) => c.unionId === partner.unionId)!
    expect(cg.children).toEqual(reversed)
  })
})
