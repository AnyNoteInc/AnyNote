import * as Sentry from '@sentry/nextjs'

import { commonInitOptions } from './src/lib/sentry-shared'

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  ...commonInitOptions(),
  initialScope: { tags: { service: 'web-edge' } },
})
