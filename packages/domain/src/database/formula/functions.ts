// Whitelisted formula function library. Sandboxed by construction: the evaluator
// can only invoke functions present in this map — there is no path to host
// globals (eval/Function/process). Date math uses date-fns.

import {
  addDays,
  addWeeks,
  addMonths,
  addYears,
  subDays,
  subWeeks,
  subMonths,
  subYears,
  differenceInDays,
  differenceInWeeks,
  differenceInMonths,
  differenceInYears,
  format as formatDateFns,
  getYear,
  getMonth,
  getDate,
} from 'date-fns'

/** The value domain a formula can produce or consume. */
export type FormulaValue = string | number | boolean | Date | null | { __error: string }

export function isFormulaError(v: unknown): v is { __error: string } {
  return typeof v === 'object' && v !== null && !(v instanceof Date) && '__error' in v
}

function err(message: string): { __error: string } {
  return { __error: message }
}

// ── Coercion helpers ─────────────────────────────────────────────────────────

function toNumber(v: FormulaValue): number {
  if (typeof v === 'number') return v
  if (typeof v === 'boolean') return v ? 1 : 0
  if (v instanceof Date) return v.getTime()
  if (v === null) return 0
  if (typeof v === 'string') {
    const n = Number(v)
    return Number.isNaN(n) ? 0 : n
  }
  return 0
}

function toBool(v: FormulaValue): boolean {
  if (typeof v === 'boolean') return v
  if (v === null) return false
  if (typeof v === 'number') return v !== 0
  if (typeof v === 'string') return v.length > 0
  if (Array.isArray(v)) return (v as unknown[]).length > 0
  return Boolean(v)
}

function stringify(v: FormulaValue): string {
  if (v === null) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (v instanceof Date) return v.toISOString()
  return ''
}

function toDate(v: FormulaValue): Date | { __error: string } {
  if (v instanceof Date) return v
  if (typeof v === 'string' || typeof v === 'number') {
    const d = new Date(v)
    if (Number.isNaN(d.getTime())) return err('invalid date')
    return d
  }
  return err('invalid date')
}

type DateUnit = 'days' | 'weeks' | 'months' | 'years'

function isDateUnit(v: FormulaValue): v is DateUnit {
  return v === 'days' || v === 'weeks' || v === 'months' || v === 'years'
}

// ── The whitelist ────────────────────────────────────────────────────────────
// Each function receives already-evaluated argument values. Any `{__error}` in
// the arguments is short-circuited by the evaluator BEFORE the function runs, so
// implementations here may assume non-error operands.

export type FormulaFunction = (args: FormulaValue[]) => FormulaValue

export const FUNCTIONS: Record<string, FormulaFunction> = {
  if(args) {
    const [cond, a, b] = args
    return toBool(cond ?? null) ? (a ?? null) : (b ?? null)
  },

  empty(args) {
    const v = args[0] ?? null
    if (v === null) return true
    if (typeof v === 'string') return v.length === 0
    if (Array.isArray(v)) return (v as unknown[]).length === 0
    return false
  },

  not(args) {
    return !toBool(args[0] ?? null)
  },

  and(args) {
    return args.every((a) => toBool(a))
  },

  or(args) {
    return args.some((a) => toBool(a))
  },

  concat(args) {
    return args.map(stringify).join('')
  },

  length(args) {
    return stringify(args[0] ?? null).length
  },

  contains(args) {
    return stringify(args[0] ?? null).includes(stringify(args[1] ?? null))
  },

  round(args) {
    const n = toNumber(args[0] ?? null)
    const digits = args.length > 1 ? toNumber(args[1] ?? null) : 0
    const factor = Math.pow(10, digits)
    return Math.round(n * factor) / factor
  },

  abs(args) {
    return Math.abs(toNumber(args[0] ?? null))
  },

  min(args) {
    if (args.length === 0) return null
    return Math.min(...args.map(toNumber))
  },

  max(args) {
    if (args.length === 0) return null
    return Math.max(...args.map(toNumber))
  },

  sum(args) {
    return args.reduce<number>((acc, a) => acc + toNumber(a), 0)
  },

  now() {
    return new Date()
  },

  dateAdd(args) {
    const d = toDate(args[0] ?? null)
    if (isFormulaError(d)) return d
    const n = toNumber(args[1] ?? null)
    const unit = args[2] ?? null
    if (!isDateUnit(unit)) return err('dateAdd: unit must be days/weeks/months/years')
    switch (unit) {
      case 'days':
        return addDays(d, n)
      case 'weeks':
        return addWeeks(d, n)
      case 'months':
        return addMonths(d, n)
      case 'years':
        return addYears(d, n)
    }
  },

  dateSubtract(args) {
    const d = toDate(args[0] ?? null)
    if (isFormulaError(d)) return d
    const n = toNumber(args[1] ?? null)
    const unit = args[2] ?? null
    if (!isDateUnit(unit)) return err('dateSubtract: unit must be days/weeks/months/years')
    switch (unit) {
      case 'days':
        return subDays(d, n)
      case 'weeks':
        return subWeeks(d, n)
      case 'months':
        return subMonths(d, n)
      case 'years':
        return subYears(d, n)
    }
  },

  dateBetween(args) {
    const a = toDate(args[0] ?? null)
    if (isFormulaError(a)) return a
    const b = toDate(args[1] ?? null)
    if (isFormulaError(b)) return b
    const unit = args[2] ?? null
    if (!isDateUnit(unit)) return err('dateBetween: unit must be days/weeks/months/years')
    switch (unit) {
      case 'days':
        return differenceInDays(b, a)
      case 'weeks':
        return differenceInWeeks(b, a)
      case 'months':
        return differenceInMonths(b, a)
      case 'years':
        return differenceInYears(b, a)
    }
  },

  formatDate(args) {
    const d = toDate(args[0] ?? null)
    if (isFormulaError(d)) return d
    const fmt = stringify(args[1] ?? null)
    try {
      return formatDateFns(d, fmt)
    } catch {
      return err('formatDate: invalid format')
    }
  },

  year(args) {
    const d = toDate(args[0] ?? null)
    if (isFormulaError(d)) return d
    return getYear(d)
  },

  month(args) {
    const d = toDate(args[0] ?? null)
    if (isFormulaError(d)) return d
    // 1-based month, matching the spec's user-facing convention.
    return getMonth(d) + 1
  },

  day(args) {
    const d = toDate(args[0] ?? null)
    if (isFormulaError(d)) return d
    return getDate(d)
  },
}
