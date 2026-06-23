import { describe, expect, it } from 'vitest'
import { IGNORE_ERRORS, makeBeforeSend } from '../src/lib/sentry-shared'

describe('makeBeforeSend', () => {
  it('drops events in development unless SENTRY_DEBUG is set', () => {
    const beforeSend = makeBeforeSend({ environment: 'development', debug: false })
    expect(beforeSend({ message: 'boom' } as never, {} as never)).toBeNull()
  })

  it('keeps events in development when debug is on', () => {
    const beforeSend = makeBeforeSend({ environment: 'development', debug: true })
    const evt = { message: 'boom' } as never
    expect(beforeSend(evt, {} as never)).toBe(evt)
  })

  it('keeps events in production', () => {
    const beforeSend = makeBeforeSend({ environment: 'production', debug: false })
    const evt = { message: 'boom' } as never
    expect(beforeSend(evt, {} as never)).toBe(evt)
  })
})

describe('IGNORE_ERRORS', () => {
  it('includes the common browser noise patterns', () => {
    expect(IGNORE_ERRORS).toContain('ResizeObserver loop limit exceeded')
    expect(IGNORE_ERRORS.some((p) => String(p).includes('AbortError'))).toBe(true)
  })
})
