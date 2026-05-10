import { describe, expect, it } from 'vitest'
import { NotificationEventType } from '@repo/db'

import { EVENT_CATALOG } from '../src/catalog.ts'

describe('EVENT_CATALOG', () => {
  it('has an entry for every NotificationEventType enum value', () => {
    for (const value of Object.values(NotificationEventType)) {
      expect(EVENT_CATALOG, `missing entry for ${value}`).toHaveProperty(value)
    }
  })

  it('locked channels are a subset of default channels (or include IN_APP, which is implicit)', () => {
    for (const [type, descriptor] of Object.entries(EVENT_CATALOG)) {
      for (const locked of descriptor.lockedChannels) {
        const inDefaults = descriptor.defaultChannels.includes(locked)
        const isInApp = locked === 'IN_APP'
        expect(inDefaults || isInApp, `${type}: locked channel ${locked} not in defaults`).toBe(true)
      }
    }
  })

  it('MARKETING events require MARKETING consent', () => {
    for (const [type, descriptor] of Object.entries(EVENT_CATALOG)) {
      if (descriptor.category === 'MARKETING') {
        expect(descriptor.requiresConsent, `${type}: must require MARKETING consent`).toBe('MARKETING')
      }
    }
  })

  it('SERVICE events have EMAIL locked', () => {
    for (const [type, descriptor] of Object.entries(EVENT_CATALOG)) {
      if (descriptor.category === 'SERVICE') {
        expect(descriptor.lockedChannels, `${type}: EMAIL must be locked`).toContain('EMAIL')
      }
    }
  })
})
