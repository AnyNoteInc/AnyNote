import { describe, expect, it } from 'vitest'

import {
  FILE_PREVIEW_MIN_WIDTH,
  clampPreviewWidth,
  defaultPreviewWidth,
  resolveOpenAction,
} from '@/components/page/file-preview/file-preview-context'

describe('clampPreviewWidth', () => {
  it('не уже минимума и не шире 70% вьюпорта', () => {
    expect(clampPreviewWidth(100, 1600)).toBe(FILE_PREVIEW_MIN_WIDTH)
    expect(clampPreviewWidth(2000, 1600)).toBe(1120)
    expect(clampPreviewWidth(700, 1600)).toBe(700)
  })

  it('на узком вьюпорте минимум побеждает 70%', () => {
    expect(clampPreviewWidth(500, 400)).toBe(FILE_PREVIEW_MIN_WIDTH)
  })
})

describe('defaultPreviewWidth', () => {
  it('половина вьюпорта в пределах клампа (спека: «на половину»)', () => {
    expect(defaultPreviewWidth(1600)).toBe(800)
    expect(defaultPreviewWidth(600)).toBe(FILE_PREVIEW_MIN_WIDTH)
  })
})

describe('resolveOpenAction', () => {
  it('диаграммы всегда открываются в панели', () => {
    expect(resolveOpenAction({ kind: 'diagram', svg: '<svg/>' })).toBe('panel')
  })

  it('просматриваемый файл → panel, неизвестный тип → download', () => {
    expect(
      resolveOpenAction({
        kind: 'file',
        url: '/api/files/x',
        name: 'a.pdf',
        mimeType: 'application/pdf',
        size: 1,
      }),
    ).toBe('panel')
    expect(
      resolveOpenAction({
        kind: 'file',
        url: '/api/files/x',
        name: 'a.zip',
        mimeType: 'application/zip',
        size: 1,
      }),
    ).toBe('download')
  })

  it('ext-фолбэк из имени спасает octet-stream', () => {
    expect(
      resolveOpenAction({
        kind: 'file',
        url: '/api/files/x',
        name: 'Отчёт.docx',
        mimeType: 'application/octet-stream',
        size: 1,
      }),
    ).toBe('panel')
  })
})
