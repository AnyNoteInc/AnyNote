import { describe, expect, it } from 'vitest'

import { shouldShowTextToolbar } from './floating-toolbar'

function visibilityArgs(selection: unknown, isEditable = true) {
  return {
    editor: { isEditable },
    state: { selection },
  } as Parameters<typeof shouldShowTextToolbar>[0]
}

describe('shouldShowTextToolbar', () => {
  it('shows for non-empty inline text selections', () => {
    expect(
      shouldShowTextToolbar(
        visibilityArgs({
          empty: false,
          $from: { parent: { inlineContent: true } },
          $to: { parent: { inlineContent: true } },
        }),
      ),
    ).toBe(true)
  })

  it('hides for selected atom nodes such as images and files', () => {
    expect(
      shouldShowTextToolbar(
        visibilityArgs({
          empty: false,
          node: { type: { name: 'image' } },
          $from: { parent: { inlineContent: false } },
          $to: { parent: { inlineContent: false } },
        }),
      ),
    ).toBe(false)

    expect(
      shouldShowTextToolbar(
        visibilityArgs({
          empty: false,
          node: { type: { name: 'fileAttachment' } },
          $from: { parent: { inlineContent: false } },
          $to: { parent: { inlineContent: false } },
        }),
      ),
    ).toBe(false)
  })

  it('hides for cursor-only selections and readonly editors', () => {
    const selection = {
      empty: true,
      $from: { parent: { inlineContent: true } },
      $to: { parent: { inlineContent: true } },
    }

    expect(shouldShowTextToolbar(visibilityArgs(selection))).toBe(false)
    expect(shouldShowTextToolbar(visibilityArgs({ ...selection, empty: false }, false))).toBe(
      false,
    )
  })
})
