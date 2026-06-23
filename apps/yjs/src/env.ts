type Env = {
  port: number
  authBaseUrl: string
  jwksUrl: string
  jwtAudience: string | undefined
  shareTokenSecret: string
  sentryDsn: string | undefined
  sentryEnvironment: string
  sentryTracesSampleRate: number
}

function required(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required env var: ${name}`)
  }
  return value
}

export function loadEnv(): Env {
  const authBaseUrl = required('BETTER_AUTH_URL').replace(/\/$/, '')
  return {
    port: Number(process.env.YJS_PORT ?? 1234),
    authBaseUrl,
    jwksUrl: `${authBaseUrl}/api/auth/jwks`,
    jwtAudience: process.env.BETTER_AUTH_JWT_AUDIENCE,
    shareTokenSecret: required('YJS_SHARE_TOKEN_SECRET'),
    sentryDsn: process.env.SENTRY_DSN,
    sentryEnvironment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? 'development',
    sentryTracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0.1'),
  }
}
