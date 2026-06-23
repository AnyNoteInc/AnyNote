import { afterEach, describe, expect, it } from 'vitest'
import { commonInitOptions, IGNORE_ERRORS, makeBeforeSend } from '../src/lib/sentry-shared'

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

describe('commonInitOptions runtime env selection', () => {
  const saved = { ...process.env }
  afterEach(() => {
    process.env = { ...saved }
  })

  it('browser runtime reads NEXT_PUBLIC_SENTRY_* and ignores the non-public vars', () => {
    process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT = 'staging'
    process.env.NEXT_PUBLIC_SENTRY_RELEASE = 'web-1.2.3'
    process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE = '0.25'
    process.env.SENTRY_ENVIRONMENT = 'server-should-be-ignored'
    process.env.SENTRY_RELEASE = 'server-rel-ignored'
    process.env.SENTRY_TRACES_SAMPLE_RATE = '0.99'
    const opts = commonInitOptions('browser')
    expect(opts.environment).toBe('staging')
    expect(opts.release).toBe('web-1.2.3')
    expect(opts.tracesSampleRate).toBe(0.25)
  })

  it('server runtime reads the non-public SENTRY_* vars', () => {
    process.env.SENTRY_ENVIRONMENT = 'production'
    process.env.SENTRY_RELEASE = 'srv-9.9.9'
    process.env.SENTRY_TRACES_SAMPLE_RATE = '0.5'
    const opts = commonInitOptions('server')
    expect(opts.environment).toBe('production')
    expect(opts.release).toBe('srv-9.9.9')
    expect(opts.tracesSampleRate).toBe(0.5)
  })

  it('falls back to 0.1 traces sample rate when the var is unset', () => {
    delete process.env.SENTRY_TRACES_SAMPLE_RATE
    delete process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE
    expect(commonInitOptions('server').tracesSampleRate).toBe(0.1)
    expect(commonInitOptions('browser').tracesSampleRate).toBe(0.1)
  })
})
