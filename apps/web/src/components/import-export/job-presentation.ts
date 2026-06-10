export type JobRow = {
  id: string
  kind: 'import' | 'export'
  status: 'QUEUED' | 'PROCESSING' | 'DONE' | 'FAILED'
  scope: string | null
  format: string
  processed: number
  total: number
  error: string | null
  createdAt: string | Date
  hasArtifact: boolean
  sourceName: string | null
  hasReport: boolean
  /** Uncapped warnings total (the `warnings` array itself is capped server-side). */
  warningsCount: number
  warnings?: string[]
  source?: string | null
}

export function statusChip(j: Pick<JobRow, 'status' | 'processed' | 'total'>): {
  label: string
  color: 'default' | 'info' | 'success' | 'error'
} {
  switch (j.status) {
    case 'QUEUED':
      return { label: 'В очереди', color: 'default' }
    case 'PROCESSING':
      return {
        label: j.total > 0 ? `Выполняется ${j.processed}/${j.total}` : 'Выполняется',
        color: 'info',
      }
    case 'DONE':
      return { label: 'Готово', color: 'success' }
    case 'FAILED':
      return { label: 'Ошибка', color: 'error' }
  }
}

const SCOPE_LABEL: Record<string, string> = {
  WORKSPACE: 'всё пространство',
  COLLECTION: 'раздел',
  SUBTREE: 'страница с подстраницами',
}

const FORMAT_LABEL: Record<string, string> = {
  MARKDOWN_ZIP: 'Markdown',
  HTML_ZIP: 'HTML',
  MARKDOWN: 'Markdown',
  HTML: 'HTML',
  ZIP: 'ZIP',
}

const SOURCE_LABEL: Record<string, string> = {
  GENERIC: 'Файлы',
  NOTION: 'Notion',
  CONFLUENCE: 'Confluence',
  YANDEX_WIKI: 'Яндекс Wiki',
}

export function describeJob(j: JobRow): string {
  if (j.kind === 'export') {
    return `Экспорт: ${SCOPE_LABEL[j.scope ?? ''] ?? j.scope ?? ''} · ${FORMAT_LABEL[j.format] ?? j.format}`
  }
  const subject = j.sourceName ?? FORMAT_LABEL[j.format] ?? j.format
  if (j.source && j.source !== 'GENERIC') {
    return `Импорт (${SOURCE_LABEL[j.source] ?? j.source}): ${subject}`
  }
  return `Импорт: ${subject}`
}
