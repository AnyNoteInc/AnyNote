import * as Sentry from '@sentry/nestjs'

const environment = process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? 'development'

// MUST be imported before any other module so the SDK can patch them.
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment,
  release: process.env.SENTRY_RELEASE,
  tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0.1'),
  sendDefaultPii: false,
  initialScope: { tags: { service: 'engines' } },
  // Drop dev events so local work never eats the free-tier quota (SENTRY_DEBUG=1 to opt in).
  beforeSend: (event) =>
    environment === 'development' && process.env.SENTRY_DEBUG !== '1' ? null : event,
})
