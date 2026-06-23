import * as Sentry from '@sentry/nestjs'

// MUST be imported before any other module so the SDK can patch them.
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? 'development',
  release: process.env.SENTRY_RELEASE,
  tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0.1'),
  sendDefaultPii: false,
  initialScope: { tags: { service: 'engines' } },
})
