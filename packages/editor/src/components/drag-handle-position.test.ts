// @vitest-environment happy-dom
// Pins the first-line-centering math for the block controls: the crossAxis
// offset must target the FIRST rendered line box of the hovered block (not the
// block's own center), skip unrendered text, and fall back to a line-height
// band for text-less blocks. happy-dom has no layout engine, so line boxes and
// computed styles are stubbed per test.

import { afterEach, describe, expect, it, vi } from 'vitest'

import { dragHandleCrossAxis, firstLineCenter } from './drag-handle-position'

const rect = (top: number, height: number) => ({ top, height }) as DOMRect

const rects = (...items: DOMRect[]) => items as unknown as DOMRectList

function block(html: string, top = 100, height = 100): HTMLElement {
  const dom = document.createElement('div')
  dom.innerHTML = html
  vi.spyOn(dom, 'getBoundingClientRect').mockReturnValue(rect(top, height))
  return dom
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('firstLineCenter', () => {
  it('returns the center of the first text line box relative to block top', () => {
    const dom = block('Заголовок', 100)
    vi.spyOn(Range.prototype, 'getClientRects').mockReturnValue(rects(rect(104, 32)))
    // line box spans 104..136 → center 120, block top 100 → 20
    expect(firstLineCenter(dom)).toBe(20)
  })

  it('uses the first line of a multi-line paragraph, not the block middle', () => {
    const dom = block('строка одна строка два строка три', 100, 72)
    vi.spyOn(Range.prototype, 'getClientRects').mockReturnValue(
      rects(rect(100, 24), rect(124, 24), rect(148, 24)),
    )
    expect(firstLineCenter(dom)).toBe(12)
  })

  it('skips text nodes without rendered rects (hidden text)', () => {
    const dom = block('<span>скрытый</span><span>видимый</span>', 100)
    vi.spyOn(Range.prototype, 'getClientRects')
      .mockReturnValueOnce(rects())
      .mockReturnValueOnce(rects(rect(110, 20)))
    expect(firstLineCenter(dom)).toBe(20)
  })

  it('falls back to a line-height band when the block has no text', () => {
    const dom = block('<img alt="" />', 100, 300)
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      fontSize: '16px',
      lineHeight: '25.6px',
      paddingTop: '4px',
      borderTopWidth: '1px',
    } as CSSStyleDeclaration)
    // border 1 + padding 4 + half of the 25.6px line
    expect(firstLineCenter(dom)).toBeCloseTo(17.8)
  })

  it('derives the fallback line height from font-size when line-height is "normal"', () => {
    const dom = block('', 100, 300)
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      fontSize: '20px',
      lineHeight: 'normal',
      paddingTop: '0px',
      borderTopWidth: '0px',
    } as CSSStyleDeclaration)
    expect(firstLineCenter(dom)).toBe(12)
  })

  it('clamps the fallback to the block center for short blocks (divider)', () => {
    const dom = block('<hr />', 100, 10)
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      fontSize: '16px',
      lineHeight: '25.6px',
      paddingTop: '0px',
      borderTopWidth: '0px',
    } as CSSStyleDeclaration)
    expect(firstLineCenter(dom)).toBe(5)
  })
})

describe('dragHandleCrossAxis', () => {
  it('keeps top alignment when the hovered DOM node is unknown', () => {
    expect(dragHandleCrossAxis(null, 28)).toBe(0)
  })

  it('shifts the handle so its center matches the first-line center', () => {
    const dom = block('текст', 100)
    vi.spyOn(Range.prototype, 'getClientRects').mockReturnValue(rects(rect(104, 32)))
    // first-line center 20, handle 28 tall → shift down by 20 - 14 = 6
    expect(dragHandleCrossAxis(dom, 28)).toBe(6)
  })

  it('shifts a tall handle up above the block top when the first line is short', () => {
    const dom = block('текст', 100)
    vi.spyOn(Range.prototype, 'getClientRects').mockReturnValue(rects(rect(100, 20)))
    expect(dragHandleCrossAxis(dom, 28)).toBe(-4)
  })
})
