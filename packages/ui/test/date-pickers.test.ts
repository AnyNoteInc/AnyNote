import { describe, expect, it } from 'vitest'

import { AdapterDateFns, LocalizationProvider, StaticDatePicker } from '../src/components'

describe('date picker exports', () => {
  it('re-exports the static date picker wiring from components', () => {
    expect(StaticDatePicker).toBeTruthy()
    expect(LocalizationProvider).toBeTypeOf('function')
    expect(AdapterDateFns).toBeTypeOf('function')
  })
})
