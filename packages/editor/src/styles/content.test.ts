import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const contentCssPath = fileURLToPath(new URL('./content.css', import.meta.url))

describe('editor task list styles', () => {
  it('aligns the task control to flex-start relative to the item content', () => {
    const css = readFileSync(contentCssPath, 'utf8')

    expect(css).toMatch(/\.anynote-editor \.anynote-task-item,[\s\S]*align-items:\s*flex-start;/)
    expect(css).toMatch(/\.anynote-editor \.anynote-task-item__checkbox,[\s\S]*margin-top:\s*-3px;/)
  })
})

describe('editor column layout styles', () => {
  it('declares column-layout as a flex container with column children using --column-width', () => {
    const css = readFileSync(contentCssPath, 'utf8')
    expect(css).toMatch(/\.anynote-editor \.column-layout[\s\S]*display:\s*flex/)
    expect(css).toMatch(
      /\.anynote-editor \.column[\s\S]*flex:\s*var\(--column-width,\s*1\)\s*1\s*0/,
    )
    expect(css).toMatch(/@media \(max-width: 600px\)[\s\S]*flex-direction:\s*column/)
  })

  it('declares column-divider hit-zone and visible bar on hover', () => {
    const css = readFileSync(contentCssPath, 'utf8')
    expect(css).toMatch(/\.anynote-editor \.column-divider\s*{[\s\S]*cursor:\s*col-resize/)
    expect(css).toMatch(/\.anynote-editor \.column-divider::before[\s\S]*background:\s*transparent/)
    expect(css).toMatch(
      /\.anynote-editor \.column-divider:hover::before[\s\S]*background:\s*var\(--editor-text-muted/,
    )
  })

  it('hides column-divider on narrow viewports', () => {
    const css = readFileSync(contentCssPath, 'utf8')
    expect(css).toMatch(
      /@media \(max-width: 600px\)[\s\S]*\.anynote-editor \.column-divider[\s\S]*display:\s*none/,
    )
  })

  it('declares drop targets with primary color', () => {
    const css = readFileSync(contentCssPath, 'utf8')
    expect(css).toMatch(/\.column-drop-target--left::before[\s\S]*width:\s*3px/)
    expect(css).toMatch(/\.column-drop-target--right::before[\s\S]*width:\s*3px/)
    expect(css).toMatch(/\.column-drop-target::before[\s\S]*background:\s*#1976d2/)
  })

  it('anchors absolute widgets on every top-level ProseMirror child', () => {
    const css = readFileSync(contentCssPath, 'utf8')
    expect(css).toMatch(/\.ProseMirror\s*>\s*\*[\s\S]*position:\s*relative/)
  })
})
