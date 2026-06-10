import { describe, expect, it } from 'vitest'

import {
  detectImportFormat,
  uploadMimeFor,
} from '../src/components/import-export/import-format'
import { SOURCE_CARDS } from '../src/components/import-export/import-sources'
import {
  describeJob,
  statusChip,
  type JobRow,
} from '../src/components/import-export/job-presentation'

describe('statusChip', () => {
  it('maps statuses to labels and colors', () => {
    expect(statusChip({ status: 'QUEUED', processed: 0, total: 0 }).color).toBe('default')
    expect(statusChip({ status: 'PROCESSING', processed: 2, total: 5 }).label).toBe(
      'Выполняется 2/5',
    )
    expect(statusChip({ status: 'DONE', processed: 5, total: 5 }).color).toBe('success')
    expect(statusChip({ status: 'FAILED', processed: 0, total: 0 }).color).toBe('error')
  })
})

describe('describeJob', () => {
  it('describes exports by scope+format and imports by source name', () => {
    expect(
      describeJob({
        id: '1',
        kind: 'export',
        status: 'DONE',
        scope: 'WORKSPACE',
        format: 'MARKDOWN_ZIP',
        processed: 1,
        total: 1,
        error: null,
        createdAt: new Date(),
        hasArtifact: true,
        sourceName: null,
        hasReport: false,
        warningsCount: 0,
      }),
    ).toBe('Экспорт: всё пространство · Markdown')
  })

  it('prefixes non-generic import sources and keeps the generic form byte-identical', () => {
    const base: Omit<JobRow, 'sourceName' | 'source'> = {
      id: '1',
      kind: 'import',
      status: 'DONE',
      scope: null,
      format: 'ZIP',
      processed: 1,
      total: 1,
      error: null,
      createdAt: new Date(),
      hasArtifact: false,
      hasReport: false,
      warningsCount: 0,
    }
    expect(describeJob({ ...base, sourceName: 'export.zip', source: 'NOTION' })).toBe(
      'Импорт (Notion): export.zip',
    )
    expect(describeJob({ ...base, sourceName: 'f.zip', source: 'GENERIC' })).toBe('Импорт: f.zip')
    expect(describeJob({ ...base, sourceName: 'f.zip', source: null })).toBe('Импорт: f.zip')
  })
})

describe('SOURCE_CARDS', () => {
  it('disables exactly ASANA and MONDAY and restricts Notion/Confluence to zip', () => {
    const disabled = SOURCE_CARDS.filter((c) => !c.enabled).map((c) => c.key)
    expect(disabled).toEqual(['ASANA', 'MONDAY'])
    expect(SOURCE_CARDS.find((c) => c.key === 'NOTION')?.accept).toBe('.zip')
    expect(SOURCE_CARDS.find((c) => c.key === 'CONFLUENCE')?.accept).toBe('.zip')
  })
})

describe('detectImportFormat / uploadMimeFor', () => {
  it('detects by extension and forces safe upload MIME', () => {
    expect(detectImportFormat('a.zip')).toBe('ZIP')
    expect(detectImportFormat('a.md')).toBe('MARKDOWN')
    expect(detectImportFormat('a.htm')).toBe('HTML')
    expect(detectImportFormat('a.pdf')).toBeNull()
    expect(uploadMimeFor('ZIP')).toBe('application/zip')
    expect(uploadMimeFor('HTML')).toBe('text/plain')
  })
})
