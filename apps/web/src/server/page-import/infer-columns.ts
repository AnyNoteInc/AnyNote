export type InferredType =
  | 'TEXT'
  | 'NUMBER'
  | 'CHECKBOX'
  | 'DATE'
  | 'SELECT'
  | 'MULTI_SELECT'
  | 'URL'
  | 'EMAIL'
  | 'PHONE'

export type InferredOption = { id: string; label: string; color: string | null }

export type InferredColumn = {
  name: string
  type: InferredType
  options?: InferredOption[]
  /** User chose to drop this column: create no property, import no cells. */
  skip?: boolean
  /** Convert a raw CSV cell to the DOMAIN cell value (option ids, numbers, ISO dates…); null = empty. */
  toValue: (raw: string) => string | number | boolean | string[] | null
}

export type InferOverrides = { overrides?: Record<number, InferredType | 'skip'> }

const NUM_RE = /^-?\d+(?:[.,]\d+)?$/
const TRUE_SET = new Set(['yes', 'true', 'да', '✓', 'x', '1', 'checked'])
const FALSE_SET = new Set(['no', 'false', 'нет', '', '0', 'unchecked'])
const URL_RE = /^https?:\/\/\S+$/i
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE_RE = /^\+?[\d\s().-]{7,}$/
// Date-ish guard so pure numbers/codes don't pass Date.parse coincidentally.
const DATEISH_RE =
  /^(\d{4}-\d{2}-\d{2}|[A-Za-zА-Яа-я]{3,}\s+\d{1,2},?\s+\d{4}|\d{1,2}[./]\d{1,2}[./]\d{2,4})/

const OPTION_COLORS = ['#9CA3AF', '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899']

const MAX_SELECT_OPTIONS = 24
const MAX_OPTION_LABEL = 60

export function inferColumns(
  header: string[],
  rows: string[][],
  opts: InferOverrides = {},
): InferredColumn[] {
  return header.map((name, idx) => {
    const ov = opts.overrides?.[idx]
    const cleanName = name.trim() || `Колонка ${idx + 1}`
    if (ov === 'skip') return { ...textColumn(cleanName), skip: true }
    const values = rows.map((r) => (r[idx] ?? '').trim()).filter((v) => v !== '')
    if (ov) return pinnedColumn(cleanName, ov, values)
    return buildColumn(cleanName, values)
  })
}

function buildColumn(name: string, values: string[]): InferredColumn {
  if (values.length === 0) return textColumn(name)
  const lower = values.map((v) => v.toLowerCase())

  if (values.every((v) => NUM_RE.test(v))) return numberColumn(name)
  if (lower.every((v) => TRUE_SET.has(v) || FALSE_SET.has(v))) return checkboxColumn(name)
  if (values.every((v) => DATEISH_RE.test(v) && !Number.isNaN(Date.parse(v)))) {
    return dateColumn(name)
  }
  if (values.every((v) => URL_RE.test(v))) return patternColumn(name, 'URL')
  if (values.every((v) => EMAIL_RE.test(v))) return patternColumn(name, 'EMAIL')
  if (values.every((v) => PHONE_RE.test(v))) return patternColumn(name, 'PHONE')

  // SELECT / MULTI_SELECT: bounded distinct short labels with repeats.
  // MULTI_SELECT only when parts RECUR across DISTINCT full values — an
  // incidental ', ' inside repeated free text must not shred the column.
  const hasSeparator = values.some((v) => v.includes(', '))
  const distinctFull = [...new Set(values)]
  const partsOfDistinct = distinctFull.flatMap((v) => v.split(', ').map((p) => p.trim()))
  const isMulti = hasSeparator && partsOfDistinct.length > new Set(partsOfDistinct).size
  const parts = isMulti ? values.flatMap((v) => v.split(', ').map((p) => p.trim())) : values
  const distinct = [...new Set(parts.filter((p) => p !== ''))]
  const shortEnough = distinct.every((p) => p.length <= MAX_OPTION_LABEL)
  const hasRepeats = parts.length > distinct.length
  if (distinct.length > 0 && distinct.length <= MAX_SELECT_OPTIONS && shortEnough && hasRepeats) {
    return selectColumn(name, distinct, isMulti)
  }
  return textColumn(name)
}

/** Same shapes `buildColumn` produces, but with the user-pinned type FORCED. */
function pinnedColumn(name: string, type: InferredType, values: string[]): InferredColumn {
  if (type === 'NUMBER') return numberColumn(name)
  if (type === 'CHECKBOX') return checkboxColumn(name)
  if (type === 'DATE') return dateColumn(name)
  if (type === 'URL' || type === 'EMAIL' || type === 'PHONE') return patternColumn(name, type)
  if (type === 'SELECT' || type === 'MULTI_SELECT') {
    const isMulti = type === 'MULTI_SELECT'
    const parts = isMulti ? values.flatMap((v) => v.split(', ').map((p) => p.trim())) : values
    const distinct = [...new Set(parts.filter((p) => p !== ''))]
    // Same guard as auto-inference: an unbounded/oversized option set would
    // bloat the property settings — degrade the pin to TEXT instead.
    if (distinct.length > MAX_SELECT_OPTIONS || distinct.some((p) => p.length > MAX_OPTION_LABEL)) {
      return textColumn(name)
    }
    return selectColumn(name, distinct, isMulti)
  }
  return textColumn(name)
}

function numberColumn(name: string): InferredColumn {
  return {
    name,
    type: 'NUMBER',
    toValue: (raw) => {
      const t = raw.trim()
      if (!t) return null
      const n = Number.parseFloat(t.replace(',', '.'))
      return Number.isFinite(n) ? n : null
    },
  }
}

function checkboxColumn(name: string): InferredColumn {
  return {
    name,
    type: 'CHECKBOX',
    toValue: (raw) => {
      const t = raw.trim().toLowerCase()
      if (!t) return null
      return TRUE_SET.has(t)
    },
  }
}

function dateColumn(name: string): InferredColumn {
  return {
    name,
    type: 'DATE',
    toValue: (raw) => {
      const t = raw.trim()
      if (!t) return null
      const d = new Date(t)
      return Number.isNaN(d.getTime()) ? null : d.toISOString()
    },
  }
}

function selectColumn(name: string, labels: string[], isMulti: boolean): InferredColumn {
  const options: InferredOption[] = labels.map((label, i) => ({
    id: `opt-${i + 1}`,
    label,
    color: OPTION_COLORS[i % OPTION_COLORS.length] ?? null,
  }))
  const idByLabel = new Map(options.map((o) => [o.label, o.id]))
  if (isMulti) {
    return {
      name,
      type: 'MULTI_SELECT',
      options,
      toValue: (raw) => {
        const ids = raw
          .split(', ')
          .map((p) => idByLabel.get(p.trim()))
          .filter((id): id is string => Boolean(id))
        return ids.length > 0 ? ids : null
      },
    }
  }
  return {
    name,
    type: 'SELECT',
    options,
    toValue: (raw) => idByLabel.get(raw.trim()) ?? null,
  }
}

function textColumn(name: string): InferredColumn {
  return { name, type: 'TEXT', toValue: (raw) => (raw.trim() ? raw.trim() : null) }
}

function patternColumn(name: string, type: 'URL' | 'EMAIL' | 'PHONE'): InferredColumn {
  return { name, type, toValue: (raw) => (raw.trim() ? raw.trim() : null) }
}
