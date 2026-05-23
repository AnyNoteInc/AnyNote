import { describe, expect, it } from 'vitest'
import { resolveSelectedViewId, viewLabel } from './view-utils'

const v = (id: string, title: string | null) => ({ id, title })

describe('viewLabel', () => {
  it('uses the title when present', () => {
    expect(viewLabel(v('index', 'Landscape'))).toBe('Landscape')
  })
  it('falls back to the id when title is null/empty', () => {
    expect(viewLabel(v('index', null))).toBe('index')
    expect(viewLabel(v('index', ''))).toBe('index')
  })
})

describe('resolveSelectedViewId', () => {
  const views = [v('index', 'Landscape'), v('ctx', 'Context')]
  it('keeps the current id when still present', () => {
    expect(resolveSelectedViewId(views, 'ctx')).toBe('ctx')
  })
  it('falls back to the first view when current is missing', () => {
    expect(resolveSelectedViewId(views, 'gone')).toBe('index')
  })
  it('returns undefined for an empty model', () => {
    expect(resolveSelectedViewId([], 'index')).toBeUndefined()
  })
})
