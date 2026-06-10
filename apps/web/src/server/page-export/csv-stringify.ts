export type CsvProperty = {
  id: string
  name: string
  type: string
  settings: unknown
}

export type CsvRow = { title: string | null; cells: Record<string, unknown> }

function optionLabels(settings: unknown): Map<string, string> {
  const out = new Map<string, string>()
  if (settings && typeof settings === 'object') {
    const options = (settings as { options?: unknown }).options
    if (Array.isArray(options)) {
      for (const o of options) {
        if (o && typeof o === 'object') {
          const { id, label } = o as { id?: unknown; label?: unknown }
          if (typeof id === 'string' && typeof label === 'string') out.set(id, label)
        }
      }
    }
  }
  return out
}

/** Stringify one listRows cell value for CSV (labels, Да/Нет, chips by title). */
export function csvCellValue(prop: CsvProperty, value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object' && !Array.isArray(value)) {
    const o = value as Record<string, unknown>
    if (typeof o.__error === 'string') return ''
    if (typeof o.title === 'string') return o.title
    if (typeof o.label === 'string') return o.label
    if (typeof o.name === 'string') return o.name
    return JSON.stringify(value)
  }
  if (prop.type === 'CHECKBOX') return value === true ? 'Да' : 'Нет'
  if (prop.type === 'SELECT' || prop.type === 'STATUS') {
    const labels = optionLabels(prop.settings)
    return typeof value === 'string' ? (labels.get(value) ?? value) : String(value)
  }
  if (Array.isArray(value)) {
    const labels = optionLabels(prop.settings)
    return value
      .map((v) =>
        typeof v === 'string' ? (labels.get(v) ?? v) : csvCellValue({ ...prop, type: 'TEXT' }, v),
      )
      .filter(Boolean)
      .join(', ')
  }
  return String(value)
}

// CSV-injection guard: spreadsheets execute cells starting with =, +, @ or a
// non-numeric '-' as formulas — neutralize with a leading apostrophe (the
// Sheets/LibreOffice convention); legitimate negative numbers stay untouched.
const FORMULA_LEAD_RE = /^(?:[=+@]|-(?![\d.]))/

function escapeField(s: string): string {
  const safe = FORMULA_LEAD_RE.test(s) ? `'${s}` : s
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe
}

/** RFC-4180 CSV with BOM (Excel) and CRLF line endings; title column first. */
export function buildCsv(props: CsvProperty[], rows: CsvRow[]): string {
  const header = ['Название', ...props.map((p) => p.name)].map(escapeField).join(',')
  const lines = rows.map((r) =>
    [r.title ?? '', ...props.map((p) => csvCellValue(p, r.cells[p.id]))].map(escapeField).join(','),
  )
  return '\uFEFF' + [header, ...lines].join('\r\n') + '\r\n'
}
