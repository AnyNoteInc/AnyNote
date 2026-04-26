import { describe, expect, it } from 'vitest'
import { computeLayout } from '../computeLayout'
import { scenarioComplexGenogram } from './scenarios'

describe('scenarioComplexGenogram sanity', () => {
  it('fixture builds without hanging', () => {
    const { data, ownerId } = scenarioComplexGenogram()
    expect(Object.keys(data.entities.people).length).toBeGreaterThan(0)
    expect(data.entities.people[ownerId]).toBeDefined()
  })

  it('computeLayout returns without hanging', () => {
    const { data } = scenarioComplexGenogram()
    const layout = computeLayout(data)
    expect(Object.keys(layout.positions).length).toBeGreaterThan(0)
  }, 5000)
})
