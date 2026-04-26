import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import {
  addBirthGroup,
  addChildGroup,
  addPerson,
  addPregnancyLoss,
  addUnion,
  appendChild,
  removePerson,
  setUnionDivorce,
  updatePerson,
} from './actions'
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

    setUnionDivorce(doc, union.id, { date: '2020-06-01', custodySide: 'right' })
    let domain = assembleDomain(doc)
    expect(domain.entities.unions[union.id]!.divorce).toEqual({
      date: '2020-06-01',
      custodySide: 'right',
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
