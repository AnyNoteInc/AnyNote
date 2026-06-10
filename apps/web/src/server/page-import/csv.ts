/** Minimal RFC-4180 CSV parser (quotes, escaped quotes, embedded commas/newlines, CRLF, BOM). */
export function parseCsv(text: string): string[][] {
  const src = text.startsWith('﻿') ? text.slice(1) : text
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0
  const pushField = () => {
    row.push(field)
    field = ''
  }
  const pushRow = () => {
    pushField()
    rows.push(row)
    row = []
  }
  while (i < src.length) {
    const ch = src[i]!
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i += 1
        continue
      }
      field += ch
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
    field += ch
    i += 1
  }
  if (field !== '' || row.length > 0) pushRow()
  return rows.filter((r) => !(r.length === 1 && r[0] === ''))
}
