import type { ErrorEvent, EventHint } from '@sentry/nextjs'

/** Browser/network noise that is never actionable. */
export const IGNORE_ERRORS: (string | RegExp)[] = [
  'ResizeObserver loop limit exceeded',
  'ResizeObserver loop completed with undelivered notifications.',
  /AbortError/,
  'Failed to fetch',
  'NetworkError when attempting to fetch resource.',
  'Load failed',
]

/**
 * Drops events in development so local work never eats the free-tier quota.
 * Set SENTRY_DEBUG=1 (or NEXT_PUBLIC_SENTRY_DEBUG=1) to opt back in while
 * testing the integration locally.
 */
export function makeBeforeSend({
  environment,
  debug,
}: {
  environment: string
  debug: boolean
}): (event: ErrorEvent, hint: EventHint) => ErrorEvent | null {
  return (event) => {
    if (environment === 'development' && !debug) return null
    return event
  }
}

/** Shared init fragment used by browser/server/edge configs. */
export function commonInitOptions(runtime: 'browser' | 'server' = 'server') {
  // The browser bundle only receives NEXT_PUBLIC_*-prefixed env (Next inlines
  // those at build time); non-prefixed process.env reads are undefined client-
  // side. Server/edge runtimes read the plain vars at runtime from the env file.
  const isBrowser = runtime === 'browser'
  const environment =
    (isBrowser ? process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT : process.env.SENTRY_ENVIRONMENT) ??
    process.env.NODE_ENV ??
    'development'
  const release = isBrowser ? process.env.NEXT_PUBLIC_SENTRY_RELEASE : process.env.SENTRY_RELEASE
  const tracesSampleRate = Number(
    (isBrowser
      ? process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE
      : process.env.SENTRY_TRACES_SAMPLE_RATE) ?? '0.1',
  )
  // SENTRY_DEBUG works on server/edge; NEXT_PUBLIC_SENTRY_DEBUG is the browser one.
  const debug = process.env.SENTRY_DEBUG === '1' || process.env.NEXT_PUBLIC_SENTRY_DEBUG === '1'
  return {
    environment,
    release,
    tracesSampleRate,
    sendDefaultPii: false,
    ignoreErrors: IGNORE_ERRORS,
    beforeSend: makeBeforeSend({ environment, debug }),
  }
}
