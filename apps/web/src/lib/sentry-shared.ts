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
export function commonInitOptions() {
  const environment = process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? 'development'
  // SENTRY_DEBUG is honored on every runtime; NEXT_PUBLIC_SENTRY_DEBUG is only
  // inlined into the client bundle by Next, so it has effect in the browser
  // config and is inert (always undefined) on the server/edge runtimes.
  const debug = process.env.SENTRY_DEBUG === '1' || process.env.NEXT_PUBLIC_SENTRY_DEBUG === '1'
  return {
    environment,
    release: process.env.SENTRY_RELEASE,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0.1'),
    sendDefaultPii: false,
    ignoreErrors: IGNORE_ERRORS,
    beforeSend: makeBeforeSend({ environment, debug }),
  }
}
