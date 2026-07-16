import { describe, expect, it } from 'vitest'

import {
  openOwnResponseSelection,
  sealOwnResponseSelection,
  type OwnResponseSelectionContext,
} from '../../../src/database/forms/own-response-selection-token.ts'

const SECRET = 'own-response-selection-test-secret-at-least-32-bytes'
const TARGET_ID = '11111111-1111-7111-8111-111111111111'
const context: OwnResponseSelectionContext = {
  locator: 'anf_form',
  submissionId: '22222222-2222-7222-8222-222222222222',
  actorUserId: '33333333-3333-7333-8333-333333333333',
  versionId: '44444444-4444-7444-8444-444444444444',
  questionId: 'relation',
  kind: 'RELATION',
}

describe('own-response selection token', () => {
  it('is stable only inside the same response/question context and remains reversible', () => {
    const first = sealOwnResponseSelection(TARGET_ID, SECRET, context)
    const second = sealOwnResponseSelection(TARGET_ID, SECRET, context)
    const anotherQuestion = sealOwnResponseSelection(TARGET_ID, SECRET, {
      ...context,
      questionId: 'another-relation',
    })

    expect(second).toBe(first)
    expect(anotherQuestion).not.toBe(first)
    expect(first).not.toContain(TARGET_ID)
    expect(openOwnResponseSelection(first, SECRET, context)).toBe(TARGET_ID)
    expect(
      openOwnResponseSelection(first, SECRET, { ...context, actorUserId: TARGET_ID }),
    ).toBeNull()
    expect(openOwnResponseSelection(`${first}x`, SECRET, context)).toBeNull()
  })
})
