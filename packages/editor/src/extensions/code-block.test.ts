import { describe, expect, it } from 'vitest'

import * as codeBlockModule from './code-block'

describe('code block language picker', () => {
  it('does not expose LikeC4 as a selectable code-block language', () => {
    const languages = (codeBlockModule as { CODE_LANGUAGES?: { value: string; label: string }[] })
      .CODE_LANGUAGES

    expect(languages).toBeDefined()
    expect(languages?.map((lang) => lang.value)).not.toContain('likec4')
    expect(languages?.map((lang) => lang.label)).not.toContain('LikeC4')
  })
})
