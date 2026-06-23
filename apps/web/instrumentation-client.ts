import * as Sentry from '@sentry/nextjs'

import { commonInitOptions } from './src/lib/sentry-shared'

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  ...commonInitOptions('browser'),
  integrations: [
    Sentry.browserTracingIntegration(),
    Sentry.replayIntegration({ maskAllText: true, blockAllMedia: true }),
  ],
  // On-error-only replay: zero cost on healthy traffic, full replay on errors.
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 1.0,
  initialScope: { tags: { service: 'web-browser' } },
})

// Required by Next so client-side navigations are traced.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
