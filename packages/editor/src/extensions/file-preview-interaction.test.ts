import { describe, expect, it } from 'vitest'

import {
  attachmentPreviewPayload,
  imagePreviewPayload,
  mediaPreviewPayload,
  shouldOpenImagePreview,
} from './file-preview-interaction'

describe('shouldOpenImagePreview', () => {
  it('read-only: одинарный клик открывает просмотр', () => {
    expect(shouldOpenImagePreview({ isEditable: false, isDoubleClick: false })).toBe(true)
  })

  it('editable: одинарный клик — только выделение (ресайз/тулбар)', () => {
    expect(shouldOpenImagePreview({ isEditable: true, isDoubleClick: false })).toBe(false)
  })

  it('двойной клик открывает просмотр в обоих режимах', () => {
    expect(shouldOpenImagePreview({ isEditable: true, isDoubleClick: true })).toBe(true)
    expect(shouldOpenImagePreview({ isEditable: false, isDoubleClick: true })).toBe(true)
  })
})

describe('imagePreviewPayload', () => {
  it('собирает file-payload из атрибутов image-ноды', () => {
    expect(
      imagePreviewPayload({ src: '/api/files/abc', name: 'a.png', size: 10, mimeType: 'image/png' }),
    ).toEqual({ kind: 'file', url: '/api/files/abc', name: 'a.png', mimeType: 'image/png', size: 10 })
  })

  it('null без src (пустой плейсхолдер)', () => {
    expect(imagePreviewPayload({ src: null, name: null, size: null, mimeType: null })).toBeNull()
  })

  it('image-ноды без метаданных (legacy) дают null-поля, mimeType добирается из image/*', () => {
    expect(
      imagePreviewPayload({ src: '/api/files/abc', name: null, size: null, mimeType: null }),
    ).toEqual({ kind: 'file', url: '/api/files/abc', name: null, mimeType: 'image/*', size: null })
  })
})

describe('attachmentPreviewPayload / mediaPreviewPayload', () => {
  it('маппит атрибуты fileAttachment', () => {
    expect(
      attachmentPreviewPayload({ url: '/api/files/x', name: 'r.pdf', size: 5, mimeType: 'application/pdf', ext: 'pdf' }),
    ).toEqual({ kind: 'file', url: '/api/files/x', name: 'r.pdf', mimeType: 'application/pdf', size: 5 })
  })

  it('маппит атрибуты video/audio-нод, пустые строки → null', () => {
    expect(mediaPreviewPayload({ url: '/api/files/v', name: '', size: 0, mimeType: '' })).toEqual({
      kind: 'file',
      url: '/api/files/v',
      name: null,
      mimeType: null,
      size: null,
    })
  })
})
