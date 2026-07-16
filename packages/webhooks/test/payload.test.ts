import { describe, expect, it } from 'vitest'

import { assertNoForbiddenKeys, buildWebhookPayload } from '../src/payload.ts'

import type { WebhookEventInput } from '../src/payload.ts'

const baseInput: WebhookEventInput = {
  eventId: '0197a3a0-0000-7000-8000-000000000001',
  event: 'page.created',
  workspaceId: '0197a3a0-0000-7000-8000-000000000002',
  actorId: '0197a3a0-0000-7000-8000-000000000003',
  resourceType: 'page',
  resourceId: '0197a3a0-0000-7000-8000-000000000004',
  occurredAt: new Date('2026-06-10T12:00:00.000Z'),
}

describe('buildWebhookPayload', () => {
  it('returns exactly the documented v1 shape', () => {
    expect(buildWebhookPayload(baseInput)).toEqual({
      version: 1,
      id: baseInput.eventId,
      event: 'page.created',
      timestamp: '2026-06-10T12:00:00.000Z',
      workspaceId: baseInput.workspaceId,
      actor: { id: baseInput.actorId },
      resource: { type: 'page', id: baseInput.resourceId },
      hints: {},
    })
  })

  it('passes hints through and keeps a null actor id', () => {
    const payload = buildWebhookPayload({
      ...baseInput,
      actorId: null,
      resourceType: 'comment',
      hints: { parentId: 'abc', resolved: true },
    })
    expect(payload.actor).toEqual({ id: null })
    expect(payload.resource).toEqual({ type: 'comment', id: baseInput.resourceId })
    expect(payload.hints).toEqual({ parentId: 'abc', resolved: true })
  })

  it('builds a metadata-only database form submission payload', () => {
    const payload = buildWebhookPayload({
      ...baseInput,
      event: 'database.form.submitted',
      actorId: null,
      hints: {
        formId: '0197a3a0-0000-7000-8000-000000000005',
        versionNumber: 3,
        rowId: '0197a3a0-0000-7000-8000-000000000006',
        itemPageId: '0197a3a0-0000-7000-8000-000000000007',
        submittedAt: '2026-06-10T12:00:00.000Z',
        respondentKind: 'anonymous',
      },
    })

    expect(payload).toEqual({
      version: 1,
      id: baseInput.eventId,
      event: 'database.form.submitted',
      timestamp: '2026-06-10T12:00:00.000Z',
      workspaceId: baseInput.workspaceId,
      actor: { id: null },
      resource: { type: 'page', id: baseInput.resourceId },
      hints: {
        formId: '0197a3a0-0000-7000-8000-000000000005',
        versionNumber: 3,
        rowId: '0197a3a0-0000-7000-8000-000000000006',
        itemPageId: '0197a3a0-0000-7000-8000-000000000007',
        submittedAt: '2026-06-10T12:00:00.000Z',
        respondentKind: 'anonymous',
      },
    })
    expect(JSON.stringify(payload)).not.toMatch(/"(title|content|body|text|name)"/)
  })

  it('throws when hints smuggle a forbidden top-level key', () => {
    expect(() => buildWebhookPayload({ ...baseInput, hints: { title: 'x' } })).toThrow()
  })

  it('throws when hints smuggle a nested forbidden key', () => {
    expect(() =>
      buildWebhookPayload({ ...baseInput, hints: { meta: { deep: [{ content: 'secret' }] } } }),
    ).toThrow()
  })

  it.each([
    ['answers', { email: 'secret@example.test' }],
    ['email', 'secret@example.test'],
    ['captcha', 'captcha-secret'],
    ['uploadToken', 'upload-secret'],
    ['rawIp', '203.0.113.10'],
  ])(
    'rejects database.form.submitted extra key %s even when it is not a generic content key',
    (key, value) => {
      expect(() =>
        buildWebhookPayload({
          ...baseInput,
          event: 'database.form.submitted',
          hints: {
            formId: '0197a3a0-0000-7000-8000-000000000005',
            versionNumber: 3,
            rowId: '0197a3a0-0000-7000-8000-000000000006',
            itemPageId: '0197a3a0-0000-7000-8000-000000000007',
            submittedAt: '2026-06-10T12:00:00.000Z',
            respondentKind: 'anonymous',
            [key]: value,
          },
        }),
      ).toThrow(/metadata-only contract/)
    },
  )
})

describe('assertNoForbiddenKeys', () => {
  it.each([['title'], ['content'], ['body'], ['text'], ['name']])(
    'throws on forbidden key "%s" anywhere in the tree',
    (key) => {
      expect(() => assertNoForbiddenKeys({ ok: { nested: { [key]: 'v' } } })).toThrow()
    },
  )

  it('walks arrays', () => {
    expect(() => assertNoForbiddenKeys({ items: [{ fine: 1 }, { name: 'x' }] })).toThrow()
  })

  it('accepts clean payloads, primitives and null', () => {
    expect(() =>
      assertNoForbiddenKeys({ id: '1', hints: { parentId: 'p', flags: [1, 2] } }),
    ).not.toThrow()
    expect(() => assertNoForbiddenKeys(null)).not.toThrow()
    expect(() => assertNoForbiddenKeys('title')).not.toThrow()
  })
})
