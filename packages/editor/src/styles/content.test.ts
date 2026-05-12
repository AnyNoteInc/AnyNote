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
  it('declares grid template for 1, 2, 3 column variants and a responsive collapse', () => {
    const css = readFileSync(contentCssPath, 'utf8')
    expect(css).toMatch(/\.column-layout--1[\s\S]*grid-template-columns:\s*1fr\b/)
    expect(css).toMatch(/\.column-layout--2[\s\S]*grid-template-columns:\s*1fr 1fr\b/)
    expect(css).toMatch(/\.column-layout--3[\s\S]*grid-template-columns:\s*1fr 1fr 1fr\b/)
    expect(css).toMatch(/@media \(max-width: 600px\)[\s\S]*grid-template-columns:\s*1fr;/)
  })

  it('declares drop indicators with primary color', () => {
    const css = readFileSync(contentCssPath, 'utf8')
    expect(css).toMatch(/\.column-drop-indicator--left[\s\S]*width:\s*3px/)
    expect(css).toMatch(/\.column-drop-indicator--right[\s\S]*width:\s*3px/)
    expect(css).toMatch(/\.column-drop-indicator\b[\s\S]*background:\s*#1976d2/)
  })

  it('anchors absolute widgets on every top-level ProseMirror child', () => {
    const css = readFileSync(contentCssPath, 'utf8')
    expect(css).toMatch(/\.ProseMirror\s*>\s*\*[\s\S]*position:\s*relative/)
  })
})
