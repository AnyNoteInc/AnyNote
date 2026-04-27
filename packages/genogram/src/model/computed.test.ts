import { describe, expect, it } from 'vitest'
import { calcAge, calcAgeAtDeath, shouldShowDeathCross } from './computed'
import type { Person } from '../types/domain'

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
