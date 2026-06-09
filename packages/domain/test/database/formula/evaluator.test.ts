import { describe, it, expect } from 'vitest'

import { tokenize } from '../../../src/database/formula/tokenizer.ts'
import { parse } from '../../../src/database/formula/parser.ts'
import { evaluate } from '../../../src/database/formula/evaluator.ts'
import { runFormula, type FormulaValue } from '../../../src/database/formula/index.ts'

const ev = (src: string, scope: Record<string, unknown> = {}): FormulaValue =>
  evaluate(parse(tokenize(src)), scope)

const isError = (v: FormulaValue): v is { __error: string } =>
  typeof v === 'object' && v !== null && !(v instanceof Date) && '__error' in v

describe('evaluate — arithmetic and precedence', () => {
  it('adds two numbers', () => {
    expect(ev('1 + 2')).toBe(3)
  })

  it('respects operator precedence', () => {
    expect(ev('1 + 2 * 3')).toBe(7)
    expect(ev('(1 + 2) * 3')).toBe(9)
  })

  it('subtracts, multiplies, divides', () => {
    expect(ev('10 - 4')).toBe(6)
    expect(ev('6 * 7')).toBe(42)
    expect(ev('9 / 3')).toBe(3)
  })

  it('negates with unary minus', () => {
    expect(ev('-5 + 2')).toBe(-3)
  })
})

describe('evaluate — prop refs', () => {
  it('reads a prop from scope', () => {
    expect(ev('prop("A")', { A: 41 })).toBe(41)
  })

  it('uses prop values in arithmetic', () => {
    expect(ev('prop("A") + prop("B")', { A: 2, B: 3 })).toBe(5)
  })

  it('returns null for an unknown prop', () => {
    expect(ev('prop("Missing")', {})).toBeNull()
  })

  it('propagates an {__error} scope value', () => {
    const r = ev('prop("X")', { X: { __error: 'boom' } })
    expect(r).toEqual({ __error: 'boom' })
  })
})

describe('evaluate — comparison and logical operators', () => {
  it('compares numbers', () => {
    expect(ev('2 > 1')).toBe(true)
    expect(ev('2 < 1')).toBe(false)
    expect(ev('2 >= 2')).toBe(true)
    expect(ev('2 <= 1')).toBe(false)
    expect(ev('2 == 2')).toBe(true)
    expect(ev('2 != 3')).toBe(true)
  })

  it('evaluates && and ||', () => {
    expect(ev('true && false')).toBe(false)
    expect(ev('true || false')).toBe(true)
  })

  it('evaluates logical not', () => {
    expect(ev('!true')).toBe(false)
    expect(ev('!false')).toBe(true)
  })
})

describe('evaluate — division by zero', () => {
  it('returns an error sentinel', () => {
    const r = ev('1 / 0')
    expect(isError(r)).toBe(true)
    expect(r).toEqual({ __error: 'division by zero' })
  })
})

describe('functions — logic and value', () => {
  it('if() picks the branch', () => {
    expect(ev('if(true, "x", "y")')).toBe('x')
    expect(ev('if(false, "x", "y")')).toBe('y')
  })

  it('empty() detects null, empty string, empty array', () => {
    expect(ev('empty(prop("X"))', { X: null })).toBe(true)
    expect(ev('empty(prop("X"))', { X: '' })).toBe(true)
    expect(ev('empty(prop("X"))', { X: [] })).toBe(true)
    expect(ev('empty(prop("X"))', { X: 'hi' })).toBe(false)
    expect(ev('empty(prop("X"))', { X: 0 })).toBe(false)
  })

  it('not()/and()/or()', () => {
    expect(ev('not(true)')).toBe(false)
    expect(ev('and(true, true, false)')).toBe(false)
    expect(ev('or(false, false, true)')).toBe(true)
  })

  it('concat() stringifies and joins', () => {
    expect(ev('concat("a", "b")')).toBe('ab')
    expect(ev('concat("x", 1, true)')).toBe('x1true')
  })

  it('length() and contains()', () => {
    expect(ev('length("abc")')).toBe(3)
    expect(ev('contains("abcdef", "cd")')).toBe(true)
    expect(ev('contains("abcdef", "zz")')).toBe(false)
  })
})

describe('functions — numeric', () => {
  it('round() with and without precision', () => {
    expect(ev('round(3.14159, 2)')).toBe(3.14)
    expect(ev('round(2.5)')).toBe(3)
  })

  it('abs()', () => {
    expect(ev('abs(-7)')).toBe(7)
  })

  it('min()/max()/sum()', () => {
    expect(ev('min(3, 1, 2)')).toBe(1)
    expect(ev('max(3, 1, 2)')).toBe(3)
    expect(ev('sum(1, 2, 3)')).toBe(6)
  })
})

describe('functions — dates', () => {
  const d1 = new Date('2026-01-01T00:00:00.000Z')
  const d2 = new Date('2026-01-11T00:00:00.000Z')

  it('dateBetween() counts days', () => {
    expect(ev('dateBetween(prop("A"), prop("B"), "days")', { A: d1, B: d2 })).toBe(10)
  })

  it('dateAdd() adds days', () => {
    const r = ev('dateAdd(prop("A"), 5, "days")', { A: d1 })
    expect(r).toBeInstanceOf(Date)
    expect((r as Date).toISOString()).toBe('2026-01-06T00:00:00.000Z')
  })

  it('dateSubtract() subtracts days', () => {
    const r = ev('dateSubtract(prop("B"), 1, "days")', { B: d2 })
    expect((r as Date).toISOString()).toBe('2026-01-10T00:00:00.000Z')
  })

  it('formatDate() formats via date-fns', () => {
    expect(ev('formatDate(prop("A"), "yyyy-MM-dd")', { A: d1 })).toBe('2026-01-01')
  })

  it('year()/month()/day() extract parts', () => {
    expect(ev('year(prop("A"))', { A: d1 })).toBe(2026)
    expect(ev('month(prop("A"))', { A: d1 })).toBe(1)
    expect(ev('day(prop("A"))', { A: d1 })).toBe(1)
  })

  it('now() returns a Date', () => {
    expect(ev('now()')).toBeInstanceOf(Date)
  })

  it('accepts an ISO string as a date argument', () => {
    expect(ev('formatDate(prop("A"), "yyyy")', { A: '2026-05-05T00:00:00.000Z' })).toBe('2026')
  })
})

describe('functions — errors', () => {
  it('unknown function → error sentinel', () => {
    const r = ev('frobnicate(1)')
    expect(isError(r)).toBe(true)
    expect((r as { __error: string }).__error).toContain('unknown function')
  })

  it('propagates an {__error} argument through a function', () => {
    const r = ev('round(prop("X"))', { X: { __error: 'upstream' } })
    expect(r).toEqual({ __error: 'upstream' })
  })
})

describe('runFormula — wrapper', () => {
  it('runs a full pipeline', () => {
    expect(runFormula('1 + 2 * 3', {})).toBe(7)
  })

  it('catches a syntax error into an error sentinel', () => {
    const r = runFormula('1 +', {})
    expect(isError(r)).toBe(true)
  })

  it('catches an unterminated string into an error sentinel', () => {
    const r = runFormula('"oops', {})
    expect(isError(r)).toBe(true)
  })

  it('returns the formula value for a prop ref', () => {
    expect(runFormula('concat(prop("Name"), " !")', { Name: 'Task' })).toBe('Task !')
  })
})

describe('sandbox — no host access by construction', () => {
  it('eval(...) is just an unknown function, not host eval', () => {
    const r = runFormula('eval("1")', {})
    expect(isError(r)).toBe(true)
    expect((r as { __error: string }).__error).toContain('unknown function')
  })

  it('prop("constructor") does not reach Object.prototype.constructor', () => {
    expect(runFormula('prop("constructor")', {})).toBeNull()
  })

  it('prop("__proto__") does not reach the prototype', () => {
    expect(runFormula('prop("__proto__")', {})).toBeNull()
  })

  it('cannot reach process/global through any ident', () => {
    expect(runFormula('process', {})).toEqual(expect.objectContaining({ __error: expect.any(String) }))
    expect(runFormula('prop("process")', {})).toBeNull()
    expect(runFormula('Function("return 1")', {})).toEqual(
      expect.objectContaining({ __error: expect.any(String) }),
    )
  })
})
