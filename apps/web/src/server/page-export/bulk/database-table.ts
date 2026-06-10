export type DbTableProperty = { id: string; name: string }
export type DbTableRow = { title: string | null; cells: Record<string, unknown> }

export function stringifyCellValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map(stringifyCellValue).filter(Boolean).join(', ')
  if (typeof value === 'object') {
    const o = value as Record<string, unknown>
    if (typeof o.label === 'string') return o.label
    if (typeof o.name === 'string') return o.name
    if (typeof o.title === 'string') return o.title
    return JSON.stringify(value)
  }
  return String(value)
}

const escapeMd = (s: string) => s.replaceAll('|', '\\|').replaceAll(/\r?\n/g, ' ')

const escapeHtml = (s: string) =>
  s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')

export function buildDatabaseTableMarkdown(props: DbTableProperty[], rows: DbTableRow[]): string {
  const header = `| Название |${props.map((p) => ` ${escapeMd(p.name)} |`).join('')}`
  const sep = `| --- |${props.map(() => ' --- |').join('')}`
  const lines = rows.map(
    (r) =>
      `| ${escapeMd(r.title ?? '')} |${props
        .map((p) => ` ${escapeMd(stringifyCellValue(r.cells[p.id]))} |`)
        .join('')}`,
  )
  return [header, sep, ...lines].join('\n') + '\n'
}

export function buildDatabaseTableHtml(props: DbTableProperty[], rows: DbTableRow[]): string {
  const head = `<tr><th>Название</th>${props.map((p) => `<th>${escapeHtml(p.name)}</th>`).join('')}</tr>`
  const body = rows
    .map(
      (r) =>
        `<tr><td>${escapeHtml(r.title ?? '')}</td>${props
          .map((p) => `<td>${escapeHtml(stringifyCellValue(r.cells[p.id]))}</td>`)
          .join('')}</tr>`,
    )
    .join('')
  return `<table>${head}${body}</table>`
}
