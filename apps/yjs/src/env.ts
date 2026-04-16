type Env = {
  port: number
  authBaseUrl: string
  jwksUrl: string
  jwtAudience: string | undefined
}

function required(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required env var: ${name}`)
  }
  return value
}

export function loadEnv(): Env {
  const authBaseUrl = required("BETTER_AUTH_URL").replace(/\/$/, "")
  return {
    // YJS_PORT and BETTER_AUTH_JWT_AUDIENCE are documented in the README;
    // turbo.json registration is handled in a later phase.
    // eslint-disable-next-line turbo/no-undeclared-env-vars -- TODO(phase-7): register YJS_PORT and BETTER_AUTH_JWT_AUDIENCE in turbo.json globalEnv and remove this disable
    port: Number(process.env.YJS_PORT ?? 1234),
    authBaseUrl,
    jwksUrl: `${authBaseUrl}/api/auth/jwks`,
    // eslint-disable-next-line turbo/no-undeclared-env-vars -- TODO(phase-7): register YJS_PORT and BETTER_AUTH_JWT_AUDIENCE in turbo.json globalEnv and remove this disable
    jwtAudience: process.env.BETTER_AUTH_JWT_AUDIENCE,
  }
}
