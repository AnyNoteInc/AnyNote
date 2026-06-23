import * as Sentry from '@sentry/nextjs'

import { commonInitOptions } from './src/lib/sentry-shared'

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  ...commonInitOptions('server'),
  initialScope: { tags: { service: 'web-server' } },
})
