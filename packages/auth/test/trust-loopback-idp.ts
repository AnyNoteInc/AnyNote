/**
 * Side-effect module — MUST be imported before `../src/auth.js`.
 *
 * @better-auth/sso (>=1.6.x) hardened server-side OIDC endpoint fetching against
 * SSRF: it rejects any token/userinfo/jwks endpoint whose host is not publicly
 * routable (loopback, RFC 1918, link-local, cloud-metadata, …) unless the
 * origin is allowlisted via better-auth `trustedOrigins`. That allowlist is
 * baked once, at `betterAuth()` init, from `BETTER_AUTH_TRUSTED_ORIGINS` — so
 * the env var has to be set before auth.ts is evaluated, which is why this runs
 * as a pre-import side effect rather than in a `beforeAll`.
 *
 * The loopback wildcards let sso-flow.test.ts's mock OIDC IdP (bound to an
 * ephemeral 127.0.0.1 port) pass the guard. Production internal-IdP deployments
 * use the same env var with their real private origin.
 */
const LOOPBACK_ORIGINS = 'http://127.0.0.1:*,http://localhost:*'

process.env.BETTER_AUTH_TRUSTED_ORIGINS = [
  process.env.BETTER_AUTH_TRUSTED_ORIGINS,
  LOOPBACK_ORIGINS,
]
  .filter(Boolean)
  .join(',')
