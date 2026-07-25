// Client-side helpers for the MONEY property type, whose cell value is an
// INTEGER count of kopecks (minor units) — see `validateCellValue` in
// `@repo/domain`. Every ruble↔kopeck conversion and ₽ formatting lives here so
// the rule can't drift between the cell editor, views, and filters.

const RUB_FORMAT = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB' })

/** Kopecks → read-only display, e.g. 12345 → "123,45 ₽". */
export function formatKopecks(kopecks: number): string {
  return RUB_FORMAT.format(kopecks / 100)
}

/** Kopecks → editable ruble text, e.g. 12345 → "123.45"; non-numbers → "". */
export function kopecksToRubleText(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return ''
  return String(value / 100)
}

/** Ruble text → integer kopecks; accepts both ',' and '.' as the decimal mark. */
export function parseRubleTextToKopecks(text: string): number | null {
  const parsed = Number(text.replace(',', '.'))
  if (!Number.isFinite(parsed)) return null
  return Math.round(parsed * 100)
}
