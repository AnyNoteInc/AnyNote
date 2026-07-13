import { describe, expect, it } from 'vitest'

import { blockDisplayName, isConvertible } from './block-names'

const nodeOf = (name: string, attrs: Record<string, unknown> = {}) => ({ type: { name }, attrs })

describe('blockDisplayName', () => {
  it('labels the image node (нода зовётся image, не resizableImage)', () => {
    expect(blockDisplayName(nodeOf('image'))).toBe('Изображение')
  })

  it('labels media nodes', () => {
    expect(blockDisplayName(nodeOf('video'))).toBe('Видео')
    expect(blockDisplayName(nodeOf('audio'))).toBe('Аудио')
    expect(blockDisplayName(nodeOf('fileAttachment'))).toBe('Файл')
  })

  it('labels headings with their level', () => {
    expect(blockDisplayName(nodeOf('heading', { level: 2 }))).toBe('Заголовок 2')
  })

  it('falls back to the raw type name for unknown nodes', () => {
    expect(blockDisplayName(nodeOf('mysteryBlock'))).toBe('mysteryBlock')
  })
})

describe('isConvertible', () => {
  it('keeps media cards out of the text-conversion list', () => {
    expect(isConvertible(nodeOf('image'))).toBe(false)
    expect(isConvertible(nodeOf('fileAttachment'))).toBe(false)
    expect(isConvertible(nodeOf('paragraph'))).toBe(true)
  })
})
