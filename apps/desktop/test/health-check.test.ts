import { describe, expect, it, vi } from 'vitest'
import { pingHealth } from '../src/main/health-check'

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, json: async () => body } as unknown as Response
}

describe('pingHealth', () => {
  it('returns true when /api/health responds { status: "ok" }', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ status: 'ok' }))
    await expect(pingHealth('https://anynote.ru', fetchFn)).resolves.toBe(true)
    expect(fetchFn).toHaveBeenCalledWith(
      'https://anynote.ru/api/health',
      expect.objectContaining({ method: 'GET' }),
    )
  })
  it('returns false on non-ok HTTP status', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ status: 'ok' }, false))
    await expect(pingHealth('https://anynote.ru', fetchFn)).resolves.toBe(false)
  })
  it('returns false when body status is not "ok"', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ status: 'down' }))
    await expect(pingHealth('https://anynote.ru', fetchFn)).resolves.toBe(false)
  })
  it('returns false when fetch throws (unreachable host)', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))
    await expect(pingHealth('https://nope.invalid', fetchFn)).resolves.toBe(false)
  })
})
