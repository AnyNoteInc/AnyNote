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
