import { ImportSourceError } from './zip-plan'

const MAX_ROWS = 50_000
const MAX_COLS = 500
const MAX_FIELD_CHARS = 100_000

/** Minimal RFC-4180 CSV parser (quotes, escaped quotes, embedded commas/newlines, CRLF, BOM). */
export function parseCsv(text: string): string[][] {
  const src = text.startsWith('﻿') ? text.slice(1) : text
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0
  const appendToField = (ch: string) => {
    field += ch
    if (field.length > MAX_FIELD_CHARS) throw new ImportSourceError('Поле CSV слишком большое')
  }
  const pushField = () => {
    row.push(field)
    if (row.length > MAX_COLS) throw new ImportSourceError('CSV содержит слишком много колонок')
    field = ''
  }
  const pushRow = () => {
    pushField()
    rows.push(row)
    if (rows.length > MAX_ROWS) throw new ImportSourceError('CSV содержит слишком много строк')
    row = []
  }
  while (i < src.length) {
    const ch = src[i]!
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          appendToField('"')
          i += 2
          continue
        }
        inQuotes = false
        i += 1
        continue
      }
      appendToField(ch)
      i += 1
      continue
    }
    if (ch === '"') {
      inQuotes = true
      i += 1
      continue
    }
    if (ch === ',') {
      pushField()
      i += 1
      continue
    }
    if (ch === '\r') {
      i += 1
      continue
    }
    if (ch === '\n') {
      pushRow()
      i += 1
      continue
    }
    appendToField(ch)
    i += 1
  }
  if (field !== '' || row.length > 0) pushRow()
  return rows.filter((r) => !(r.length === 1 && r[0] === ''))
}
