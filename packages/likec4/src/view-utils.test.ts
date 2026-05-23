import { describe, expect, it } from 'vitest'
import { formatLikec4Errors, resolveSelectedViewId } from './view-utils'

const v = (id: string, title: string | null) => ({ id, title })

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

describe('formatLikec4Errors', () => {
  it('returns null when there are no errors', () => {
    expect(formatLikec4Errors([])).toBeNull()
  })
  it('formats a diagnostic with a 1-based line number (getErrors reports 0-based)', () => {
    expect(formatLikec4Errors([{ line: 2, message: "Expecting token of type '}' but found `model`." }])).toBe(
      "Line 3: Expecting token of type '}' but found `model`.",
    )
  })
  it('joins multiple diagnostics with newlines', () => {
    expect(
      formatLikec4Errors([
        { line: 4, message: "Could not resolve reference to Referenceable named 'ghost'." },
        { line: 4, message: 'Target not resolved' },
      ]),
    ).toBe("Line 5: Could not resolve reference to Referenceable named 'ghost'.\nLine 5: Target not resolved")
  })
})
