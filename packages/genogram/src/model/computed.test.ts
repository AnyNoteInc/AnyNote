import { describe, expect, it } from 'vitest'
import {
  calcAge,
  calcAgeAtDeath,
  shouldShowDeathCross,
  hasParents,
  getChildGroupOf,
  getChildrenOf,
  getBaseOf,
  getPartnersOf,
  countPartnersOf,
  shouldShowPartnerOrder,
} from './computed'
import type { ChildGroup, ChildGroupId, Person, PersonId, Union, UnionId } from '../types'

describe('calcAge', () => {
  it('returns exact age when full birthDate and full refDate', () => {
    expect(calcAge({ day: 5, month: 3, year: 1984 }, { day: 27, month: 4, year: 2026 })).toBe(42)
  })

  it('returns approximate age when only year in birthDate', () => {
    expect(calcAge({ year: 1984 }, { day: 27, month: 4, year: 2026 })).toBe(42)
  })

  it('returns undefined when no year in birthDate', () => {
    expect(calcAge({ day: 5, month: 3 }, { day: 27, month: 4, year: 2026 })).toBeUndefined()
  })

  it('accepts ISO string for refDate', () => {
    expect(calcAge({ day: 5, month: 3, year: 1984 }, '2026-04-27T00:00:00Z')).toBe(42)
  })

  it('accounts for not-yet-reached birthday', () => {
    expect(calcAge({ day: 5, month: 6, year: 1984 }, { day: 27, month: 4, year: 2026 })).toBe(41)
  })

  it('uses UTC for ISO strings (not local timezone)', () => {
    // 23:00 UTC = early next day in UTC+ timezones — ensure we use UTC consistently
    expect(calcAge({ day: 27, month: 4, year: 1984 }, '2026-04-26T23:00:00Z')).toBe(41)
  })
})

describe('calcAgeAtDeath', () => {
  it('returns age based on death date when both dates have full info', () => {
    const p: Person = personWith({
      birthDate: { day: 5, month: 3, year: 1950 },
      deathDate: { day: 5, month: 3, year: 2000 },
      lifeStatus: 'deceased',
    })
    expect(calcAgeAtDeath(p)).toBe(50)
  })

  it('returns undefined when not deceased', () => {
    const p: Person = personWith({
      birthDate: { day: 5, month: 3, year: 1950 },
      lifeStatus: 'alive',
    })
    expect(calcAgeAtDeath(p)).toBeUndefined()
  })

  it('returns undefined when missing year in either date', () => {
    const p: Person = personWith({
      birthDate: { day: 5, month: 3, year: 1950 },
      deathDate: { day: 5 },
      lifeStatus: 'deceased',
    })
    expect(calcAgeAtDeath(p)).toBeUndefined()
  })
})

describe('shouldShowDeathCross', () => {
  it('returns false when not deceased', () => {
    const p = personWith({ lifeStatus: 'alive' })
    expect(shouldShowDeathCross(p)).toBe(false)
  })

  it('returns true when tragically=true regardless of age', () => {
    const p = personWith({
      lifeStatus: 'deceased',
      tragically: true,
      birthDate: { year: 1900 },
      deathDate: { year: 1990 }, // age 90
    })
    expect(shouldShowDeathCross(p)).toBe(true)
  })

  it('returns true when ageAtDeath < 65', () => {
    const p = personWith({
      lifeStatus: 'deceased',
      birthDate: { year: 1950 },
      deathDate: { year: 2000 }, // age 50
    })
    expect(shouldShowDeathCross(p)).toBe(true)
  })

  it('returns false when ageAtDeath >= 65 and not tragically', () => {
    const p = personWith({
      lifeStatus: 'deceased',
      birthDate: { year: 1900 },
      deathDate: { year: 2000 }, // age 100
    })
    expect(shouldShowDeathCross(p)).toBe(false)
  })

  it('returns false when ageAtDeath unknown and not tragically', () => {
    const p = personWith({
      lifeStatus: 'deceased',
      // no birth/death dates
    })
    expect(shouldShowDeathCross(p)).toBe(false)
  })

  it('returns false when ageAtDeath is exactly 65 and not tragically', () => {
    const p = personWith({
      lifeStatus: 'deceased',
      birthDate: { year: 1935 },
      deathDate: { year: 2000 }, // age exactly 65
    })
    expect(shouldShowDeathCross(p)).toBe(false)
  })
})

// Helper for tests
function personWith(life: Partial<Person['lifeDates']>): Person {
  return {
    id: 'p1' as Person['id'],
    sex: 'male',
    role: 'regular',
    size: 'big',
    bloodRelation: 'direct',
    identity: {},
    profile: {},
    label: {} as Person['label'],
    lifeDates: { birthMode: 'date', lifeStatus: 'alive', ...life },
  }
}

describe('hasParents / getChildGroupOf', () => {
  const cgA: ChildGroup = {
    id: 'cgA' as ChildGroupId,
    unionId: 'u1' as UnionId,
    children: [
      { kind: 'person', personId: 'kid1' as PersonId },
      { kind: 'person', personId: 'kid2' as PersonId },
    ],
  }
  const groups = { cgA }

  it('hasParents returns true when person is in any childGroup', () => {
    expect(hasParents('kid1' as PersonId, groups)).toBe(true)
  })

  it('hasParents returns false when person is not a child', () => {
    expect(hasParents('outsider' as PersonId, groups)).toBe(false)
  })

  it('getChildGroupOf returns the matching group', () => {
    expect(getChildGroupOf('kid1' as PersonId, groups)?.id).toBe('cgA')
  })

  it('getChildGroupOf returns null when not a child', () => {
    expect(getChildGroupOf('outsider' as PersonId, groups)).toBeNull()
  })
})

describe('getChildrenOf', () => {
  it('returns children of the union, in order', () => {
    const cg: ChildGroup = {
      id: 'cg' as ChildGroupId,
      unionId: 'u1' as UnionId,
      children: [
        { kind: 'person', personId: 'a' as PersonId },
        { kind: 'person', personId: 'b' as PersonId },
      ],
    }
    const groups: Record<ChildGroupId, ChildGroup> = { [cg.id]: cg }
    expect(getChildrenOf('u1' as UnionId, groups)).toEqual(cg.children)
  })

  it('returns empty array when no group for union', () => {
    expect(getChildrenOf('uX' as UnionId, {})).toEqual([])
  })
})

describe('partner helpers', () => {
  const owner: Person = personWith({})
  owner.id = 'owner' as PersonId
  const wife1: Person = personWith({})
  wife1.id = 'w1' as PersonId
  wife1.sex = 'female'
  wife1.partnerOrder = 1
  const wife2: Person = personWith({})
  wife2.id = 'w2' as PersonId
  wife2.sex = 'female'
  wife2.partnerOrder = 2

  const u1: Union = {
    id: 'u1' as UnionId,
    kind: 'marriage',
    malePartnerId: 'owner' as PersonId,
    femalePartnerId: 'w1' as PersonId,
  }
  const u2: Union = {
    id: 'u2' as UnionId,
    kind: 'marriage',
    malePartnerId: 'owner' as PersonId,
    femalePartnerId: 'w2' as PersonId,
  }
  const unions: Record<UnionId, Union> = { [u1.id]: u1, [u2.id]: u2 }
  const people: Record<PersonId, Person> = {
    [owner.id]: owner,
    [wife1.id]: wife1,
    [wife2.id]: wife2,
  }

  it('getBaseOf returns the other side when partner has 1 union', () => {
    expect(getBaseOf('w1' as PersonId, unions)).toBe('owner')
  })

  it('getBaseOf returns null when person has 2+ unions (is the central one)', () => {
    expect(getBaseOf('owner' as PersonId, unions)).toBeNull()
  })

  it('getPartnersOf returns partners sorted by partnerOrder', () => {
    const partners = getPartnersOf('owner' as PersonId, unions, people)
    expect(partners.map((p) => p.partnerId)).toEqual(['w1', 'w2'])
  })

  it('getPartnersOf places partner without partnerOrder last', () => {
    const wife3: Person = personWith({})
    wife3.id = 'w3' as PersonId
    wife3.sex = 'female'
    // no partnerOrder set
    const u3: Union = {
      id: 'u3' as UnionId,
      kind: 'marriage',
      malePartnerId: 'owner' as PersonId,
      femalePartnerId: 'w3' as PersonId,
    }
    const partners = getPartnersOf(
      'owner' as PersonId,
      { ...unions, [u3.id]: u3 },
      { ...people, [wife3.id]: wife3 },
    )
    expect(partners[partners.length - 1]!.partnerId).toBe('w3')
  })

  it('countPartnersOf returns count', () => {
    expect(countPartnersOf('owner' as PersonId, unions)).toBe(2)
    expect(countPartnersOf('w1' as PersonId, unions)).toBe(1)
  })

  it('shouldShowPartnerOrder returns true for partner of base with >1 partners', () => {
    expect(shouldShowPartnerOrder('w1' as PersonId, people, unions)).toBe(true)
  })

  it('shouldShowPartnerOrder returns false for base itself', () => {
    expect(shouldShowPartnerOrder('owner' as PersonId, people, unions)).toBe(false)
  })

  it('shouldShowPartnerOrder returns false when single partner', () => {
    const onlyOne = { u1 }
    expect(shouldShowPartnerOrder('w1' as PersonId, people, onlyOne)).toBe(false)
  })
})
