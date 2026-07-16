import { describe, expect, it } from 'vitest'

import { updateFormDraftInput } from '../../../src/database/forms/database-form.dto.ts'
import { MAX_FORM_QUESTIONS } from '../../../src/database/forms/form-document.ts'

const propertyId = (index: number): string =>
  `00000000-0000-4000-8000-${index.toString().padStart(12, '0')}`

describe('updateFormDraftInput propertyNameIntents', () => {
  const schema = updateFormDraftInput.shape.propertyNameIntents

  it('preserves trailing whitespace in the exact property name', () => {
    expect(schema.parse({ [propertyId(1)]: 'Название ' })).toEqual({
      [propertyId(1)]: 'Название ',
    })
  })

  it(`accepts ${MAX_FORM_QUESTIONS} intents and rejects one more`, () => {
    const maximum = Object.fromEntries(
      Array.from({ length: MAX_FORM_QUESTIONS }, (_, index) => [propertyId(index), 'Name']),
    )
    const overLimit = { ...maximum, [propertyId(MAX_FORM_QUESTIONS)]: 'Name' }

    expect(schema.safeParse(maximum).success).toBe(true)
    expect(schema.safeParse(overLimit).success).toBe(false)
  })
})
