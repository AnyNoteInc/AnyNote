import { describe, expect, it } from 'vitest'

import { COMING_EVENT_TYPES, WEBHOOK_EVENT_TYPES, isWebhookEventType } from '../src/catalog.ts'

describe('WEBHOOK_EVENT_TYPES', () => {
  it('contains exactly the 9 documented event types', () => {
    expect([...WEBHOOK_EVENT_TYPES]).toEqual([
      'page.created',
      'page.content_updated',
      'page.properties_updated',
      'page.moved',
      'page.deleted',
      'page.undeleted',
      'comment.created',
      'comment.resolved',
      'database.form.submitted',
    ])
  })

  it('isWebhookEventType returns true for every catalog value', () => {
    for (const type of WEBHOOK_EVENT_TYPES) {
      expect(isWebhookEventType(type)).toBe(true)
    }
  })

  it('isWebhookEventType returns false for unknown or coming-soon values', () => {
    expect(isWebhookEventType('page.viewed')).toBe(false)
    expect(isWebhookEventType('')).toBe(false)
    for (const type of COMING_EVENT_TYPES) {
      expect(isWebhookEventType(type)).toBe(false)
    }
  })

  it('COMING_EVENT_TYPES lists the documented-but-not-emitted types', () => {
    expect([...COMING_EVENT_TYPES]).toEqual([
      'collection.created',
      'collection.updated',
      'database.row_changed',
    ])
  })
})
