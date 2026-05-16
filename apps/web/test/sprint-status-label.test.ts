import { describe, expect, it } from 'vitest'

import { sprintStatusLabel, sprintStatusColor } from '@/components/kanban/sprint/sprint-status-label'

describe('sprintStatusLabel', () => {
  it('translates PLANNED', () => {
    expect(sprintStatusLabel('PLANNED')).toBe('Планирование')
  })
  it('translates ACTIVE', () => {
    expect(sprintStatusLabel('ACTIVE')).toBe('Активный')
  })
  it('translates COMPLETED', () => {
    expect(sprintStatusLabel('COMPLETED')).toBe('Завершён')
  })
  it('returns the raw value for an unknown status', () => {
    expect(sprintStatusLabel('UNKNOWN')).toBe('UNKNOWN')
  })
})

describe('sprintStatusColor', () => {
  it('maps PLANNED to default', () => {
    expect(sprintStatusColor('PLANNED')).toBe('default')
  })
  it('maps ACTIVE to primary', () => {
    expect(sprintStatusColor('ACTIVE')).toBe('primary')
  })
  it('maps COMPLETED to success', () => {
    expect(sprintStatusColor('COMPLETED')).toBe('success')
  })
  it('maps unknown to default', () => {
    expect(sprintStatusColor('UNKNOWN')).toBe('default')
  })
})
