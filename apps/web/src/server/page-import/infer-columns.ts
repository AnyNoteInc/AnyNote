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
  /** Convert a raw CSV cell to the DOMAIN cell value (option ids, numbers, ISO dates…); null = empty. */
  toValue: (raw: string) => string | number | boolean | string[] | null
}

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

export function inferColumns(header: string[], rows: string[][]): InferredColumn[] {
  return header.map((name, idx) => {
    const values = rows.map((r) => (r[idx] ?? '').trim()).filter((v) => v !== '')
    return buildColumn(name.trim() || `Колонка ${idx + 1}`, values)
  })
}

function buildColumn(name: string, values: string[]): InferredColumn {
  if (values.length === 0) return textColumn(name)
  const lower = values.map((v) => v.toLowerCase())

  if (values.every((v) => NUM_RE.test(v))) {
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
  if (lower.every((v) => TRUE_SET.has(v) || FALSE_SET.has(v))) {
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
  if (values.every((v) => DATEISH_RE.test(v) && !Number.isNaN(Date.parse(v)))) {
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
    const options: InferredOption[] = distinct.map((label, i) => ({
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
  return textColumn(name)
}

function textColumn(name: string): InferredColumn {
  return { name, type: 'TEXT', toValue: (raw) => (raw.trim() ? raw.trim() : null) }
}

function patternColumn(name: string, type: 'URL' | 'EMAIL' | 'PHONE'): InferredColumn {
  return { name, type, toValue: (raw) => (raw.trim() ? raw.trim() : null) }
}
