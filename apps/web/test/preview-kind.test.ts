import { describe, expect, it } from 'vitest'

import {
  TEXT_PREVIEW_MAX_BYTES,
  extFromFileName,
  extractApiFileId,
  resolvePreviewType,
} from '../src/lib/preview-kind'

describe('resolvePreviewType', () => {
  it('classifies svg by mime and by ext (before generic image/*)', () => {
    expect(resolvePreviewType('image/svg+xml', null)).toBe('svg')
    expect(resolvePreviewType('application/octet-stream', 'svg')).toBe('svg')
  })

  it('classifies pdf by mime and by ext', () => {
    expect(resolvePreviewType('application/pdf', null)).toBe('pdf')
    expect(resolvePreviewType(null, 'pdf')).toBe('pdf')
  })

  it('classifies raster images, video and audio by mime family', () => {
    expect(resolvePreviewType('image/png', null)).toBe('image')
    expect(resolvePreviewType('image/webp', 'webp')).toBe('image')
    expect(resolvePreviewType('video/mp4', null)).toBe('video')
    expect(resolvePreviewType('audio/mpeg', null)).toBe('audio')
  })

  it('classifies text by mime and by ext fallback (attachment mime is client-declared)', () => {
    expect(resolvePreviewType('text/plain', null)).toBe('text')
    expect(resolvePreviewType('text/markdown', null)).toBe('text')
    expect(resolvePreviewType('application/json', null)).toBe('text')
    expect(resolvePreviewType('application/octet-stream', 'md')).toBe('text')
    expect(resolvePreviewType(null, 'log')).toBe('text')
  })

  it('classifies office formats by mime and by ext fallback', () => {
    expect(
      resolvePreviewType(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        null,
      ),
    ).toBe('office')
    expect(resolvePreviewType('application/msword', null)).toBe('office')
    expect(resolvePreviewType('application/vnd.oasis.opendocument.text', null)).toBe('office')
    expect(resolvePreviewType('application/octet-stream', 'xlsx')).toBe('office')
    expect(resolvePreviewType(null, 'pptx')).toBe('office')
    expect(resolvePreviewType('text/rtf', null)).toBe('office')
  })

  it('is case-insensitive and tolerates a leading dot in ext', () => {
    expect(resolvePreviewType('APPLICATION/PDF', null)).toBe('pdf')
    expect(resolvePreviewType(null, '.DOCX')).toBe('office')
  })

  it('returns null for unknown types', () => {
    expect(resolvePreviewType('application/zip', 'zip')).toBeNull()
    expect(resolvePreviewType(null, null)).toBeNull()
    expect(resolvePreviewType('', '')).toBeNull()
  })
})

describe('extFromFileName', () => {
  it('extracts the lowercased extension', () => {
    expect(extFromFileName('Отчёт.DOCX')).toBe('docx')
    expect(extFromFileName('archive.tar.gz')).toBe('gz')
  })

  it('returns null without an extension or name', () => {
    expect(extFromFileName('README')).toBeNull()
    expect(extFromFileName(null)).toBeNull()
    expect(extFromFileName('')).toBeNull()
  })
})

describe('extractApiFileId', () => {
  it('extracts the uuid from an /api/files url', () => {
    expect(extractApiFileId('/api/files/0197a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b')).toBe(
      '0197a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
    )
  })

  it('returns null for foreign or malformed urls', () => {
    expect(extractApiFileId('https://evil.example/api/files/x')).toBeNull()
    expect(extractApiFileId('/api/files/not-a-uuid')).toBeNull()
    expect(
      extractApiFileId('/api/files/0197a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b/preview-pdf'),
    ).toBeNull()
  })
})

it('caps text preview at 1 MB', () => {
  expect(TEXT_PREVIEW_MAX_BYTES).toBe(1_048_576)
})
