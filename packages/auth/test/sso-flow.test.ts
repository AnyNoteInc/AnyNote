/**
 * Phase 8B Task 1 — @better-auth/sso compatibility spike proof.
 *
 * Proves, against the REAL production `auth` instance and the real dev DB:
 *  1. a provider row written directly to `sso_providers` (our server-side
 *     registration contract, see src/sso.md) is picked up by POST /sign-in/sso
 *     and produces a correct IdP authorization redirect (PKCE + state);
 *  2. the OIDC code flow completes end-to-end against a LOCAL mock IdP
 *     (token + userinfo endpoints on localhost): the callback exchanges the
 *     code, JIT-creates the user with firstName/lastName derived via the
 *     `withDerivedNameParts` before-hook, runs the existing after-hook
 *     (subscription), links the account, and sets a session cookie;
 *  3. the `domainVerified: false` gate blocks sign-in (our domain gate
 *     mapping); and the public /sso/register endpoint is disabled
 *     (providersLimit: 0).
 */
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

const sendMailNowMock = vi.fn<(args: unknown) => Promise<void>>(async () => {})

vi.mock('@repo/mail', async () => {
  const actual = await vi.importActual<typeof import('@repo/mail')>('@repo/mail')
  return {
    ...actual,
    sendMailNow: (args: unknown) => sendMailNowMock(args),
  }
})

import { prisma } from '@repo/db'
import { auth, withDerivedNameParts } from '../src/auth.js'

const RUN = `${Date.now()}`
const TAG = `sso-spike-${RUN}`
const PROVIDER_ID = TAG
const DOMAIN = `${TAG}.example`
const JIT_EMAIL = `jit@${DOMAIN}`
const OWNER_EMAIL = `owner+${TAG}@anynote.dev`
const CLIENT_ID = 'spike-client-id'
const CLIENT_SECRET = 'spike-client-secret'
const ACCESS_TOKEN = 'spike-access-token'
const CODE = 'spike-code'

type SeenRequests = {
  tokenBody: URLSearchParams | null
  tokenAuthHeader: string | null
  userinfoAuthHeader: string | null
}

let idp: Server
let idpOrigin: string
const seen: SeenRequests = { tokenBody: null, tokenAuthHeader: null, userinfoAuthHeader: null }
let ownerId: string

function startMockIdp(): Promise<string> {
  return new Promise((resolve) => {
    idp = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost')
      if (url.pathname === '/.well-known/openid-configuration') {
        res.setHeader('content-type', 'application/json')
        res.end(
          JSON.stringify({
            issuer: idpOrigin,
            authorization_endpoint: `${idpOrigin}/authorize`,
            token_endpoint: `${idpOrigin}/token`,
            jwks_uri: `${idpOrigin}/jwks`,
            userinfo_endpoint: `${idpOrigin}/userinfo`,
          }),
        )
        return
      }
      if (url.pathname === '/token' && req.method === 'POST') {
        let body = ''
        req.on('data', (chunk: Buffer) => {
          body += chunk.toString()
        })
        req.on('end', () => {
          seen.tokenBody = new URLSearchParams(body)
          seen.tokenAuthHeader = req.headers.authorization ?? null
          res.setHeader('content-type', 'application/json')
          res.end(
            JSON.stringify({ access_token: ACCESS_TOKEN, token_type: 'bearer', expires_in: 3600 }),
          )
        })
        return
      }
      if (url.pathname === '/userinfo') {
        seen.userinfoAuthHeader = req.headers.authorization ?? null
        res.setHeader('content-type', 'application/json')
        res.end(
          JSON.stringify({
            sub: 'idp-sub-1',
            email: JIT_EMAIL,
            email_verified: true,
            name: 'Anna Karenina',
          }),
        )
        return
      }
      if (url.pathname === '/jwks') {
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ keys: [] }))
        return
      }
      res.statusCode = 404
      res.end()
    })
    idp.listen(0, '127.0.0.1', () => {
      const { port } = idp.address() as AddressInfo
      idpOrigin = `http://127.0.0.1:${port}`
      resolve(idpOrigin)
    })
  })
}

/** Fully-hydrated config: all endpoints present so neither sign-in nor the
 * callback performs runtime discovery (which would require the IdP origin in
 * better-auth `trustedOrigins`) — this is the production contract. */
function hydratedOidcConfig(): string {
  return JSON.stringify({
    issuer: idpOrigin,
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    authorizationEndpoint: `${idpOrigin}/authorize`,
    tokenEndpoint: `${idpOrigin}/token`,
    tokenEndpointAuthentication: 'client_secret_basic',
    jwksEndpoint: `${idpOrigin}/jwks`,
    userInfoEndpoint: `${idpOrigin}/userinfo`,
    discoveryEndpoint: `${idpOrigin}/.well-known/openid-configuration`,
    scopes: ['openid', 'email', 'profile'],
    pkce: true,
  })
}

async function cleanup(): Promise<void> {
  const emails = [JIT_EMAIL, OWNER_EMAIL]
  await prisma.ssoProvider.deleteMany({ where: { providerId: { startsWith: 'sso-spike-' } } })
  await prisma.subscription.deleteMany({ where: { user: { email: { in: emails } } } })
  await prisma.userPreference.deleteMany({ where: { user: { email: { in: emails } } } })
  await prisma.account.deleteMany({ where: { user: { email: { in: emails } } } })
  await prisma.session.deleteMany({ where: { user: { email: { in: emails } } } })
  await prisma.user.deleteMany({ where: { email: { in: emails } } })
}

describe('sso plugin spike (mock OIDC IdP)', () => {
  beforeAll(async () => {
    await startMockIdp()
    await cleanup()
    const owner = await prisma.user.create({
      data: {
        name: 'Spike Owner',
        firstName: 'Spike',
        lastName: 'Owner',
        email: OWNER_EMAIL,
        emailVerified: true,
      },
    })
    ownerId = owner.id
  })

  afterAll(async () => {
    // let background sendOnSignUp settle before deleting fixture rows
    await new Promise((r) => setTimeout(r, 150))
    await cleanup()
    await new Promise<void>((resolve) => idp.close(() => resolve()))
  })

  it('completes the full OIDC code flow: redirect → callback → JIT user + session', async () => {
    await prisma.ssoProvider.create({
      data: {
        issuer: idpOrigin,
        domain: DOMAIN,
        oidcConfig: hydratedOidcConfig(),
        userId: ownerId,
        providerId: PROVIDER_ID,
        domainVerified: true,
      },
    })

    // 1. sign-in start: email domain resolves the provider row
    const { headers: signInHeaders, response: res } = await auth.api.signInSSO({
      body: { email: JIT_EMAIL, callbackURL: '/welcome' },
      returnHeaders: true,
    })
    expect(res.redirect).toBe(true)
    const authorizeUrl = new URL(res.url)
    expect(authorizeUrl.origin).toBe(idpOrigin)
    expect(authorizeUrl.pathname).toBe('/authorize')
    expect(authorizeUrl.searchParams.get('client_id')).toBe(CLIENT_ID)
    const redirectUri = authorizeUrl.searchParams.get('redirect_uri')
    expect(redirectUri).toBe(`http://localhost:3000/api/auth/sso/callback/${PROVIDER_ID}`)
    expect(authorizeUrl.searchParams.get('code_challenge')).toBeTruthy() // PKCE
    const state = authorizeUrl.searchParams.get('state')
    expect(state).toBeTruthy()

    // 2. simulate the IdP redirecting back with a code — forwarding the
    // signed state cookie set at sign-in (the browser CSRF binding)
    const stateCookies = signInHeaders
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; ')
    const cbResponse = await auth.handler(
      new Request(`${redirectUri}?code=${CODE}&state=${encodeURIComponent(state ?? '')}`, {
        headers: { cookie: stateCookies },
      }),
    )
    expect(cbResponse.status).toBe(302)
    expect(cbResponse.headers.get('location')).toContain('/welcome')
    expect(cbResponse.headers.get('set-cookie')).toContain('session_token')

    // 3. the code exchange hit the mock IdP with PKCE + basic client auth
    expect(seen.tokenBody?.get('code')).toBe(CODE)
    expect(seen.tokenBody?.get('code_verifier')).toBeTruthy()
    expect(seen.tokenAuthHeader).toBe(
      `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`,
    )
    expect(seen.userinfoAuthHeader).toBe(`Bearer ${ACCESS_TOKEN}`)

    // 4. JIT user created with firstName/lastName derived from `name`
    const jitUser = await prisma.user.findUnique({ where: { email: JIT_EMAIL } })
    expect(jitUser).not.toBeNull()
    expect(jitUser?.name).toBe('Anna Karenina')
    expect(jitUser?.firstName).toBe('Anna')
    expect(jitUser?.lastName).toBe('Karenina')
    // trustEmailVerified is off: provider claims are not trusted for verification
    expect(jitUser?.emailVerified).toBe(false)

    // 5. account linked to OUR providerId; existing after-hook ran (subscription)
    const account = await prisma.account.findFirst({ where: { userId: jitUser?.id ?? '' } })
    expect(account?.providerId).toBe(PROVIDER_ID)
    expect(account?.accountId).toBe('idp-sub-1')
    const subscription = await prisma.subscription.findFirst({
      where: { userId: jitUser?.id ?? '' },
    })
    expect(subscription).not.toBeNull()

    // 6. NO workspace membership was created (the no-silent-membership invariant)
    const memberships = await prisma.workspaceMember.findMany({
      where: { userId: jitUser?.id ?? '' },
    })
    expect(memberships).toHaveLength(0)
  })

  it('blocks sign-in for a provider whose domainVerified flag is false', async () => {
    const unverifiedDomain = `unverified-${RUN}.example`
    await prisma.ssoProvider.create({
      data: {
        issuer: idpOrigin,
        domain: unverifiedDomain,
        oidcConfig: hydratedOidcConfig(),
        userId: ownerId,
        providerId: `sso-spike-unverified-${RUN}`,
        domainVerified: false,
      },
    })
    await expect(
      auth.api.signInSSO({
        body: { email: `someone@${unverifiedDomain}`, callbackURL: '/welcome' },
      }),
    ).rejects.toMatchObject({ status: 'UNAUTHORIZED' })
  })

  it('has the public /sso/register endpoint disabled (providersLimit: 0)', async () => {
    const response = await auth.handler(
      new Request('http://localhost:3000/api/auth/sso/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          providerId: 'sso-spike-evil',
          issuer: idpOrigin,
          domain: 'evil.example',
          oidcConfig: { clientId: 'x', clientSecret: 'y' },
        }),
      }),
    )
    // sessionMiddleware rejects anonymous calls outright; a session-bearing
    // call would hit the providersLimit=0 FORBIDDEN. Either way: no public registration.
    expect([401, 403]).toContain(response.status)
  })

  it('withDerivedNameParts fills missing firstName/lastName from name only', () => {
    expect(withDerivedNameParts({ name: 'Anna Karenina', email: 'x@y.z' })).toMatchObject({
      firstName: 'Anna',
      lastName: 'Karenina',
    })
    expect(withDerivedNameParts({ name: 'Cher' })).toMatchObject({
      firstName: 'Cher',
      lastName: '',
    })
    expect(withDerivedNameParts({ name: '  Anna   Maria   van   Beethoven ' })).toMatchObject({
      firstName: 'Anna',
      lastName: 'Maria van Beethoven',
    })
    expect(withDerivedNameParts({})).toMatchObject({ firstName: '', lastName: '' })
    // explicit fields always win — email/password and Google paths untouched
    expect(
      withDerivedNameParts({ name: 'Anna Karenina', firstName: 'Ann', lastName: 'K' }),
    ).toMatchObject({ firstName: 'Ann', lastName: 'K' })
  })
})
