import { TRPCError } from '@trpc/server'
import type { Prisma, PrismaClient } from '@repo/db'
import type { IdentitySsoPort, SsoRegistrationData } from '@repo/domain'
import { assertSafeWebhookUrl, SsrfBlockedError, type LookupFn } from '@repo/webhooks'

/**
 * The live `IdentitySsoPort` implementation — the runtime contract from
 * `packages/auth/src/sso.md`: direct `sso_providers` writes carrying a FULLY
 * HYDRATED `oidcConfig` (all of authorizationEndpoint/tokenEndpoint/
 * jwksEndpoint present), because the plugin's own runtime discovery would
 * reject any IdP origin missing from the startup-computed `trustedOrigins`.
 * So the port fetches `<issuer>/.well-known/openid-configuration` ITSELF,
 * server-side, and persists the hydrated shape.
 *
 * Hardening (the issuerUrl is admin-supplied):
 * - the issuer AND every server-fetched endpoint from the discovery document
 *   (token/jwks/userinfo) pass the `@repo/webhooks` SSRF guard — https-only,
 *   private/loopback/link-local/CGN/metadata ranges blocked;
 * - the discovery fetch is timeout-bounded and NEVER follows redirects (a 3xx
 *   could point at a private host and evade the guard);
 * - the discovery `issuer` must match the configured issuer URL (OIDC §4.3 —
 *   prevents issuer mix-up via a hijacked document).
 *
 * Crash-window convergence (sso.md): `register` AND `update` are upserts keyed
 * on the deterministic plugin `providerId` (= `WorkspaceAuthProvider.id`), so
 * a port-success/tx-crash retry converges on the same row; `unregister` is
 * delete-if-exists.
 *
 * The PLAINTEXT client secret never transits the domain layer: the router
 * builds this port per call with a lazy `resolveClientSecret` closure over
 * `decryptSecret(clientSecretEnc)` (or the fresh input). Unregister-only
 * flows pass a throwing resolver — `unregister` never asks for it.
 */
export type CreateIdentitySsoPortOptions = {
  prisma: PrismaClient | Prisma.TransactionClient
  /** Lazy — only awaited by register/update (the hydrated config embeds the secret). */
  resolveClientSecret: () => Promise<string>
  /** Injectable for tests (the webhooks fetchFn pattern); defaults to global fetch. */
  fetchFn?: typeof fetch
  /** Injectable DNS lookup for the SSRF guard; defaults to node:dns. */
  lookup?: LookupFn
  timeoutMs?: number
}

const DISCOVERY_TIMEOUT_MS = 10_000
const DISCOVERY_PATH = '/.well-known/openid-configuration'

type OidcDiscoveryDocument = {
  issuer?: unknown
  authorization_endpoint?: unknown
  token_endpoint?: unknown
  jwks_uri?: unknown
  userinfo_endpoint?: unknown
  token_endpoint_auth_methods_supported?: unknown
}

function badIssuer(reason: string): TRPCError {
  return new TRPCError({ code: 'BAD_REQUEST', message: `Issuer URL отклонён: ${reason}` })
}

function badDiscovery(reason: string): TRPCError {
  return new TRPCError({
    code: 'BAD_REQUEST',
    message: `Не удалось получить конфигурацию OIDC провайдера: ${reason}`,
  })
}

function stripTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url
}

async function guardUrl(url: string, lookup: LookupFn | undefined, what: string): Promise<void> {
  try {
    await assertSafeWebhookUrl(url, lookup)
  } catch (err) {
    const reason = err instanceof SsrfBlockedError ? err.message : 'недопустимый адрес'
    throw what === 'issuer' ? badIssuer(reason) : badDiscovery(`${what}: ${reason}`)
  }
}

function requireHttpsUrl(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw badDiscovery(`в discovery-документе нет ${field}`)
  }
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw badDiscovery(`${field} не является корректным URL`)
  }
  if (parsed.protocol !== 'https:') throw badDiscovery(`${field} должен быть https URL`)
  return value
}

/**
 * Fetches and validates the OIDC discovery document, returning the hydrated
 * `oidcConfig` payload (sso.md shape) WITH the client secret embedded — the
 * plugin's sign-in/callback handlers `JSON.parse` this column directly.
 */
async function buildHydratedOidcConfig(
  data: SsoRegistrationData,
  clientSecret: string,
  fetchFn: typeof fetch,
  lookup: LookupFn | undefined,
  timeoutMs: number,
): Promise<string> {
  await guardUrl(data.issuerUrl, lookup, 'issuer')

  const discoveryEndpoint = `${stripTrailingSlash(data.issuerUrl)}${DISCOVERY_PATH}`
  let res: Response
  try {
    res = await fetchFn(discoveryEndpoint, {
      headers: { Accept: 'application/json' },
      // A redirect could point at a private host and evade the SSRF guard.
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    throw badDiscovery(err instanceof Error ? err.message : 'сетевая ошибка')
  }
  if (res.status < 200 || res.status >= 300) throw badDiscovery(`http ${res.status}`)

  let doc: OidcDiscoveryDocument
  try {
    doc = (await res.json()) as OidcDiscoveryDocument
  } catch {
    throw badDiscovery('ответ не является JSON')
  }

  if (
    typeof doc.issuer === 'string' &&
    stripTrailingSlash(doc.issuer) !== stripTrailingSlash(data.issuerUrl)
  ) {
    throw badDiscovery('issuer в discovery-документе не совпадает с указанным issuer URL')
  }

  // The authorization endpoint is a browser redirect target — https suffices.
  const authorizationEndpoint = requireHttpsUrl(doc.authorization_endpoint, 'authorization_endpoint')
  // These three are fetched SERVER-side at sign-in/callback — full SSRF guard.
  const tokenEndpoint = requireHttpsUrl(doc.token_endpoint, 'token_endpoint')
  await guardUrl(tokenEndpoint, lookup, 'token_endpoint')
  const jwksEndpoint = requireHttpsUrl(doc.jwks_uri, 'jwks_uri')
  await guardUrl(jwksEndpoint, lookup, 'jwks_uri')
  let userInfoEndpoint: string | undefined
  if (doc.userinfo_endpoint != null && doc.userinfo_endpoint !== '') {
    userInfoEndpoint = requireHttpsUrl(doc.userinfo_endpoint, 'userinfo_endpoint')
    await guardUrl(userInfoEndpoint, lookup, 'userinfo_endpoint')
  }

  const authMethods = Array.isArray(doc.token_endpoint_auth_methods_supported)
    ? (doc.token_endpoint_auth_methods_supported as unknown[])
    : []
  const tokenEndpointAuthentication =
    !authMethods.includes('client_secret_basic') && authMethods.includes('client_secret_post')
      ? 'client_secret_post'
      : 'client_secret_basic'

  return JSON.stringify({
    issuer: data.issuerUrl,
    clientId: data.clientId,
    clientSecret,
    authorizationEndpoint,
    tokenEndpoint,
    tokenEndpointAuthentication,
    jwksEndpoint,
    ...(userInfoEndpoint ? { userInfoEndpoint } : {}),
    discoveryEndpoint,
    scopes: ['openid', 'email', 'profile'],
    pkce: true,
  })
}

export function createIdentitySsoPort(opts: CreateIdentitySsoPortOptions): IdentitySsoPort {
  const fetchFn = opts.fetchFn ?? fetch
  const timeoutMs = opts.timeoutMs ?? DISCOVERY_TIMEOUT_MS

  /** Upsert keyed on the plugin's unique `provider_id` — retries converge. */
  async function writeRow(providerId: string, data: SsoRegistrationData): Promise<void> {
    const oidcConfig = await buildHydratedOidcConfig(
      data,
      await opts.resolveClientSecret(),
      fetchFn,
      opts.lookup,
      timeoutMs,
    )
    const row = {
      issuer: data.issuerUrl,
      domain: data.domain,
      oidcConfig,
      userId: data.actorId,
      // Registration happens ONLY after OUR DNS verification — the plugin's
      // sign-in gate (domainVerification.enabled) keys off this flag.
      domainVerified: true,
    }
    await opts.prisma.ssoProvider.upsert({
      where: { providerId },
      create: { ...row, providerId },
      update: row,
    })
  }

  return {
    async register(data) {
      // Deterministic plugin key = our stable WorkspaceAuthProvider.id (sso.md).
      await writeRow(data.providerId, data)
      return { ssoProviderId: data.providerId }
    },
    async update(ssoProviderId, data) {
      await writeRow(ssoProviderId, data)
    },
    async unregister(ssoProviderId) {
      // Delete-if-exists: an already-missing row is a converged crash retry.
      await opts.prisma.ssoProvider.deleteMany({ where: { providerId: ssoProviderId } })
    },
  }
}
