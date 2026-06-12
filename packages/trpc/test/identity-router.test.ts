import { randomUUID } from 'node:crypto'

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

process.env.SECRETS_ENCRYPTION_KEY ||= Buffer.alloc(32, 7).toString('base64')
process.env.BETTER_AUTH_URL ||= 'http://localhost:3000'

// The discovery fetch + the SSRF DNS lookup are the only injected edges — the
// REAL port code (SSRF guard, discovery hydration, sso_providers upsert) runs
// against postgres. `createIdentitySsoPort` is wrapped so every port the
// router builds gets the test fetch/lookup (the webhooks fetchFn pattern).
const { ssoEdge } = vi.hoisted(() => ({
  ssoEdge: {
    fetchFn: undefined as undefined | ((url: string | URL | Request) => Promise<Response>),
    fetchCalls: [] as string[],
    // TEST-NET-3 — public per the SSRF guard's range table, no real DNS.
    lookup: async () => [{ address: '203.0.113.10', family: 4 }],
  },
}))

vi.mock('../src/helpers/sso-port', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/helpers/sso-port')>()
  return {
    ...actual,
    createIdentitySsoPort: (opts: Parameters<typeof actual.createIdentitySsoPort>[0]) =>
      actual.createIdentitySsoPort({
        ...opts,
        fetchFn: (async (url: string | URL | Request) => {
          ssoEdge.fetchCalls.push(String(url))
          if (!ssoEdge.fetchFn) throw new Error('test discovery fetch not configured')
          return ssoEdge.fetchFn(url)
        }) as typeof fetch,
        lookup: ssoEdge.lookup,
      }),
  }
})

import { prisma } from '@repo/db'
import { decryptSecret, type EncryptedPayload } from '@repo/auth'

import { identityRouter } from '../src/routers/identity'
import { createCallerFactory } from '../src/trpc'

// Real-DB integration test for the identity router. Email-suffix fixture
// namespace, self-cleaning. Requires `docker compose up -d` (postgres).
// The fixture email/workspace DOMAIN is run-unique so the domain-indexed
// lookups (listAvailable/join match by email domain across ALL workspaces on
// the shared dev DB) stay fixture-scoped.

const RUN = randomUUID().slice(0, 8)
const FIXTURE_DOMAIN = `idr-${RUN}.example`
const EMAIL_MARKER = '+identity-router-test@'
const EMAIL_SUFFIX = `${EMAIL_MARKER}${FIXTURE_DOMAIN}`
// Dedicated plan (the people-router pattern): never flip flags on the shared
// dev DB's `personal` plan; the owner gets an ACTIVE subscription to this one.
const PRO_PLAN_SLUG = 'identity-router-test-pro'
const ISSUER_URL = 'https://idp.example.com'
const SECRET_PLAINTEXT = 'идентичность-super-secret-0451'
const FORBIDDEN_MESSAGE = 'Недостаточно прав'

type FixtureUser = { id: string; email: string; firstName: string | null; lastName: string | null }

async function cleanFixtures() {
  const byCreatorWs = { workspace: { createdBy: { email: { contains: EMAIL_MARKER } } } }
  const byUser = { user: { email: { contains: EMAIL_MARKER } } }
  await prisma.externalIdentityLink.deleteMany({
    where: { provider: byCreatorWs },
  })
  await prisma.ssoProvider.deleteMany({ where: byUser })
  await prisma.workspaceAuthProvider.deleteMany({ where: byCreatorWs })
  await prisma.verifiedEmailDomain.deleteMany({ where: byCreatorWs })
  await prisma.allowedEmailDomain.deleteMany({ where: byCreatorWs })
  await prisma.notificationEvent.deleteMany({ where: byUser })
  await prisma.userPreference.deleteMany({ where: byUser })
  await prisma.workspaceAuditLog.deleteMany({ where: byCreatorWs })
  await prisma.collection.deleteMany({ where: byCreatorWs })
  await prisma.workspaceLimit.deleteMany({ where: byCreatorWs })
  await prisma.workspaceBlockedUser.deleteMany({ where: { OR: [byCreatorWs, byUser] } })
  await prisma.workspaceMember.deleteMany({ where: { OR: [byCreatorWs, byUser] } })
  await prisma.workspace.deleteMany({
    where: { createdBy: { email: { contains: EMAIL_MARKER } } },
  })
  await prisma.subscription.deleteMany({ where: byUser })
  await prisma.user.deleteMany({ where: { email: { contains: EMAIL_MARKER } } })
  await prisma.plan.deleteMany({ where: { slug: PRO_PLAN_SLUG } })
}

async function makeUser(label: string): Promise<FixtureUser> {
  return prisma.user.create({
    data: {
      email: `${label}-${RUN}${EMAIL_SUFFIX}`,
      emailVerified: true,
      name: label,
      firstName: label,
      lastName: 'Test',
    },
    select: { id: true, email: true, firstName: true, lastName: true },
  })
}

function ctxFor(user: FixtureUser) {
  return {
    prisma,
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      emailVerified: true,
    },
    headers: new Headers(),
    resHeaders: new Headers(),
    yookassa: {},
    returnUrlBase: 'http://app.test',
    jobs: { kick: vi.fn() },
  } as never
}

const identity = (u: FixtureUser) => createCallerFactory(identityRouter)(ctxFor(u))

async function seed() {
  await prisma.plan.upsert({
    where: { slug: 'personal' },
    update: {},
    create: { slug: 'personal', name: 'Персональный', maxWorkspaces: 1, sortOrder: 1 },
  })
  const plan = await prisma.plan.upsert({
    where: { slug: PRO_PLAN_SLUG },
    update: {},
    create: {
      slug: PRO_PLAN_SLUG,
      name: 'Identity Router Test Pro',
      maxMembersPerWorkspace: 10,
      sortOrder: 99,
    },
  })
  const owner = await makeUser('owner')
  const admin = await makeUser('admin')
  const member = await makeUser('member')
  const outsider = await makeUser('outsider')
  const blocked = await makeUser('blocked')
  await prisma.subscription.create({
    data: {
      userId: owner.id,
      planId: plan.id,
      status: 'ACTIVE',
      currentPeriodEnd: new Date('2027-02-01T00:00:00.000Z'),
    },
  })
  const ws = await prisma.workspace.create({
    data: { name: 'IdentityRouterWS', createdById: owner.id },
    select: { id: true, name: true },
  })
  await prisma.workspaceMember.createMany({
    data: [
      { workspaceId: ws.id, userId: owner.id, role: 'OWNER' },
      { workspaceId: ws.id, userId: admin.id, role: 'ADMIN' },
      { workspaceId: ws.id, userId: member.id, role: 'EDITOR' },
    ],
  })
  await prisma.workspaceBlockedUser.create({
    data: { workspaceId: ws.id, userId: blocked.id, blockedById: owner.id },
  })
  await prisma.workspaceLimit.create({
    data: { workspaceId: ws.id, maxMembers: 10, maxFileBytes: 0, syncedAt: new Date() },
  })
  return { owner, admin, member, outsider, blocked, ws }
}

// ── shared provider/domain fixture helpers ────────────────────────────────────

async function createVerifiedDomain(workspaceId: string, addedById: string, domain = FIXTURE_DOMAIN) {
  return prisma.verifiedEmailDomain.create({
    data: {
      workspaceId,
      domain,
      status: 'VERIFIED',
      verificationToken: `tok${RUN}`,
      tokenExpiresAt: new Date(Date.now() + 86_400_000),
      verifiedAt: new Date(),
      addedById,
    },
    select: { id: true, domain: true },
  })
}

function discoveryDocument(issuer = ISSUER_URL) {
  return {
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    jwks_uri: `${issuer}/jwks`,
    userinfo_endpoint: `${issuer}/userinfo`,
    token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
  }
}

function serveDiscovery(
  doc: Record<string, unknown> = discoveryDocument(),
  init: { contentType?: string } = {},
) {
  ssoEdge.fetchFn = async () =>
    new Response(JSON.stringify(doc), {
      status: 200,
      headers: { 'Content-Type': init.contentType ?? 'application/json' },
    })
}

/** Any key smelling of secret material is banned in responses except the presence flag. */
function assertNoSecretMaterial(value: unknown) {
  const seen: string[] = []
  const walk = (v: unknown) => {
    if (Array.isArray(v)) return v.forEach(walk)
    if (v && typeof v === 'object') {
      for (const [k, inner] of Object.entries(v as Record<string, unknown>)) {
        if (/secret/i.test(k) && k !== 'hasClientSecret') seen.push(k)
        walk(inner)
      }
    }
  }
  walk(value)
  expect(seen).toEqual([])
  const json = JSON.stringify(value)
  expect(json).not.toContain(SECRET_PLAINTEXT)
  expect(json).not.toContain('ciphertext')
}

describe('identity router', () => {
  beforeEach(async () => {
    await cleanFixtures()
    ssoEdge.fetchFn = undefined
    ssoEdge.fetchCalls.length = 0
  })

  afterAll(async () => {
    await cleanFixtures()
  })

  // ── OWNER/ADMIN matrix: every managed proc is OWNER-only ──────────────────

  it('pins ADMIN ⇒ FORBIDDEN on every managed procedure', async () => {
    const { admin, ws } = await seed()
    const caller = identity(admin)
    const id = randomUUID()
    const managedCalls: Array<[string, () => Promise<unknown>]> = [
      ['allowedDomains.list', () => caller.allowedDomains.list({ workspaceId: ws.id })],
      [
        'allowedDomains.add',
        () => caller.allowedDomains.add({ workspaceId: ws.id, domain: FIXTURE_DOMAIN }),
      ],
      [
        'allowedDomains.remove',
        () => caller.allowedDomains.remove({ workspaceId: ws.id, domainId: id }),
      ],
      ['verifiedDomains.list', () => caller.verifiedDomains.list({ workspaceId: ws.id })],
      [
        'verifiedDomains.start',
        () => caller.verifiedDomains.start({ workspaceId: ws.id, domain: FIXTURE_DOMAIN }),
      ],
      [
        'verifiedDomains.rotate',
        () => caller.verifiedDomains.rotate({ workspaceId: ws.id, domainId: id }),
      ],
      [
        'verifiedDomains.check',
        () => caller.verifiedDomains.check({ workspaceId: ws.id, domainId: id }),
      ],
      [
        'verifiedDomains.remove',
        () => caller.verifiedDomains.remove({ workspaceId: ws.id, domainId: id }),
      ],
      ['providers.list', () => caller.providers.list({ workspaceId: ws.id })],
      [
        'providers.create',
        () =>
          caller.providers.create({
            workspaceId: ws.id,
            type: 'OIDC',
            name: 'Okta',
            issuerUrl: ISSUER_URL,
            clientId: 'client-id',
            clientSecret: SECRET_PLAINTEXT,
          }),
      ],
      [
        'providers.update',
        () => caller.providers.update({ workspaceId: ws.id, providerId: id, name: 'Renamed' }),
      ],
      [
        'providers.activate',
        () => caller.providers.activate({ workspaceId: ws.id, providerId: id, domainId: id }),
      ],
      [
        'providers.disable',
        () => caller.providers.disable({ workspaceId: ws.id, providerId: id }),
      ],
      ['providers.delete', () => caller.providers.delete({ workspaceId: ws.id, providerId: id })],
      [
        'providers.requestEnterprise',
        () => caller.providers.requestEnterprise({ workspaceId: ws.id, feature: 'SAML' }),
      ],
    ]
    expect(managedCalls).toHaveLength(15)
    for (const [name, call] of managedCalls) {
      await expect(call(), `${name} must be OWNER-only`).rejects.toMatchObject({
        code: 'FORBIDDEN',
        message: FORBIDDEN_MESSAGE,
      })
    }
  })

  // ── allowed domains ────────────────────────────────────────────────────────

  it('allowedDomains: OWNER can add/list/remove; public domains rejected', async () => {
    const { owner, ws } = await seed()
    const caller = identity(owner)

    const added = await caller.allowedDomains.add({ workspaceId: ws.id, domain: FIXTURE_DOMAIN })
    expect(added.domain).toBe(FIXTURE_DOMAIN)

    const listed = await caller.allowedDomains.list({ workspaceId: ws.id })
    expect(listed.map((d) => d.domain)).toContain(FIXTURE_DOMAIN)

    await expect(
      caller.allowedDomains.add({ workspaceId: ws.id, domain: 'gmail.com' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })

    await caller.allowedDomains.remove({ workspaceId: ws.id, domainId: added.id })
    expect(await caller.allowedDomains.list({ workspaceId: ws.id })).toEqual([])
  })

  // ── verified domains lifecycle ────────────────────────────────────────────

  it('verifiedDomains: start → rotate (token changes) → check via the DEFAULT DNS resolver records the failure', async () => {
    const { owner, ws } = await seed()
    const caller = identity(owner)

    const started = await caller.verifiedDomains.start({
      workspaceId: ws.id,
      domain: FIXTURE_DOMAIN,
    })
    expect(started.status).toBe('PENDING')
    expect(started.verificationToken).toBeTruthy()

    const rotated = await caller.verifiedDomains.rotate({
      workspaceId: ws.id,
      domainId: started.id,
    })
    expect(rotated.verificationToken).not.toBe(started.verificationToken)

    // The router passes NO resolver — the domain's default (node:dns) resolver
    // runs for real; the run-unique fixture domain cannot resolve, so the row
    // stays PENDING with the failure recorded.
    const checked = await caller.verifiedDomains.check({
      workspaceId: ws.id,
      domainId: started.id,
    })
    expect(checked.status).toBe('PENDING')
    expect(checked.lastCheckError).toBeTruthy()
    expect(checked.lastCheckedAt).not.toBeNull()

    const listed = await caller.verifiedDomains.list({ workspaceId: ws.id })
    expect(listed.map((d) => d.id)).toContain(started.id)
  })

  it('verifiedDomains.remove passes the port: bound ACTIVE provider is disabled and its plugin row deleted', async () => {
    const { owner, ws } = await seed()
    const caller = identity(owner)
    const domainRow = await createVerifiedDomain(ws.id, owner.id)
    serveDiscovery()

    const created = await caller.providers.create({
      workspaceId: ws.id,
      type: 'OIDC',
      name: 'Okta',
      issuerUrl: ISSUER_URL,
      clientId: 'client-id',
      clientSecret: SECRET_PLAINTEXT,
    })
    await caller.providers.activate({
      workspaceId: ws.id,
      providerId: created.id,
      domainId: domainRow.id,
    })
    expect(await prisma.ssoProvider.count({ where: { providerId: created.id } })).toBe(1)

    const removed = await caller.verifiedDomains.remove({
      workspaceId: ws.id,
      domainId: domainRow.id,
    })
    expect(removed.providersDisabled).toBe(1)
    expect(await prisma.ssoProvider.count({ where: { providerId: created.id } })).toBe(0)
    const provider = await prisma.workspaceAuthProvider.findUniqueOrThrow({
      where: { id: created.id },
      select: { status: true, ssoProviderId: true },
    })
    expect(provider.status).toBe('DISABLED')
    expect(provider.ssoProviderId).toBeNull()
  })

  // ── providers: stripCreds deep-shape ──────────────────────────────────────

  it('providers.create encrypts the secret at the router and never returns secret material', async () => {
    const { owner, ws } = await seed()
    const caller = identity(owner)

    const created = await caller.providers.create({
      workspaceId: ws.id,
      type: 'OIDC',
      name: 'Okta',
      issuerUrl: ISSUER_URL,
      clientId: 'client-id',
      clientSecret: SECRET_PLAINTEXT,
    })
    expect(created.hasClientSecret).toBe(true)
    assertNoSecretMaterial(created)

    const listed = await caller.providers.list({ workspaceId: ws.id })
    expect(listed).toHaveLength(1)
    assertNoSecretMaterial(listed)

    // The DB row holds the AES payload and decrypts back to the input — proof
    // the router used @repo/auth encryptSecret (not plaintext, not a hash).
    const row = await prisma.workspaceAuthProvider.findUniqueOrThrow({
      where: { id: created.id },
      select: { clientSecretEnc: true },
    })
    expect(decryptSecret(row.clientSecretEnc as unknown as EncryptedPayload)).toBe(
      SECRET_PLAINTEXT,
    )
  })

  it('providers.create zod gate: OIDC/OAUTH require https issuer + clientId + clientSecret', async () => {
    const { owner, ws } = await seed()
    const caller = identity(owner)

    await expect(
      caller.providers.create({
        workspaceId: ws.id,
        type: 'OIDC',
        name: 'No secret',
        issuerUrl: ISSUER_URL,
        clientId: 'client-id',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })

    await expect(
      caller.providers.create({
        workspaceId: ws.id,
        type: 'OAUTH',
        name: 'Plain http',
        issuerUrl: 'http://idp.example.com',
        clientId: 'client-id',
        clientSecret: SECRET_PLAINTEXT,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })

    // SAML_RESERVED needs the name only.
    const saml = await caller.providers.create({
      workspaceId: ws.id,
      type: 'SAML_RESERVED',
      name: 'SAML заявка',
    })
    expect(saml.type).toBe('SAML_RESERVED')
    expect(saml.hasClientSecret).toBe(false)
  })

  it('providers.update keeps the stored secret when omitted and rotates it when provided', async () => {
    const { owner, ws } = await seed()
    const caller = identity(owner)
    const created = await caller.providers.create({
      workspaceId: ws.id,
      type: 'OIDC',
      name: 'Okta',
      issuerUrl: ISSUER_URL,
      clientId: 'client-id',
      clientSecret: SECRET_PLAINTEXT,
    })

    const renamed = await caller.providers.update({
      workspaceId: ws.id,
      providerId: created.id,
      name: 'Okta prod',
    })
    expect(renamed.name).toBe('Okta prod')
    expect(renamed.hasClientSecret).toBe(true)
    assertNoSecretMaterial(renamed)
    const kept = await prisma.workspaceAuthProvider.findUniqueOrThrow({
      where: { id: created.id },
      select: { clientSecretEnc: true },
    })
    expect(decryptSecret(kept.clientSecretEnc as unknown as EncryptedPayload)).toBe(
      SECRET_PLAINTEXT,
    )

    const rotatedSecret = 'rotated-secret-9000'
    const rotated = await caller.providers.update({
      workspaceId: ws.id,
      providerId: created.id,
      clientSecret: rotatedSecret,
    })
    expect(rotated.hasClientSecret).toBe(true)
    assertNoSecretMaterial(rotated)
    const after = await prisma.workspaceAuthProvider.findUniqueOrThrow({
      where: { id: created.id },
      select: { clientSecretEnc: true },
    })
    expect(decryptSecret(after.clientSecretEnc as unknown as EncryptedPayload)).toBe(rotatedSecret)
  })

  // ── activation ────────────────────────────────────────────────────────────

  it('providers.activate refuses an unverified domain (the domain gate)', async () => {
    const { owner, ws } = await seed()
    const caller = identity(owner)
    const pending = await prisma.verifiedEmailDomain.create({
      data: {
        workspaceId: ws.id,
        domain: FIXTURE_DOMAIN,
        status: 'PENDING',
        verificationToken: `tok${RUN}`,
        tokenExpiresAt: new Date(Date.now() + 86_400_000),
        addedById: owner.id,
      },
      select: { id: true },
    })
    const created = await caller.providers.create({
      workspaceId: ws.id,
      type: 'OIDC',
      name: 'Okta',
      issuerUrl: ISSUER_URL,
      clientId: 'client-id',
      clientSecret: SECRET_PLAINTEXT,
    })
    await expect(
      caller.providers.activate({
        workspaceId: ws.id,
        providerId: created.id,
        domainId: pending.id,
      }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED', message: 'Сначала подтвердите домен' })
    expect(ssoEdge.fetchCalls).toEqual([])
  })

  it('providers.activate hydrates the sso_providers row from discovery and double-activate converges', async () => {
    const { owner, ws } = await seed()
    const caller = identity(owner)
    const domainRow = await createVerifiedDomain(ws.id, owner.id)
    serveDiscovery()

    const created = await caller.providers.create({
      workspaceId: ws.id,
      type: 'OIDC',
      name: 'Okta',
      issuerUrl: ISSUER_URL,
      clientId: 'client-id',
      clientSecret: SECRET_PLAINTEXT,
    })
    const activated = await caller.providers.activate({
      workspaceId: ws.id,
      providerId: created.id,
      domainId: domainRow.id,
    })
    expect(activated.status).toBe('ACTIVE')
    expect(activated.ssoProviderId).toBe(created.id)
    assertNoSecretMaterial(activated)
    expect(ssoEdge.fetchCalls).toEqual([`${ISSUER_URL}/.well-known/openid-configuration`])

    const rows = await prisma.ssoProvider.findMany({ where: { providerId: created.id } })
    expect(rows).toHaveLength(1)
    const row = rows[0]!
    expect(row.issuer).toBe(ISSUER_URL)
    expect(row.domain).toBe(FIXTURE_DOMAIN)
    expect(row.domainVerified).toBe(true)
    expect(row.userId).toBe(owner.id)
    expect(row.organizationId).toBeNull()
    const oidc = JSON.parse(row.oidcConfig ?? '{}') as Record<string, unknown>
    expect(oidc).toMatchObject({
      issuer: ISSUER_URL,
      clientId: 'client-id',
      clientSecret: SECRET_PLAINTEXT,
      authorizationEndpoint: `${ISSUER_URL}/authorize`,
      tokenEndpoint: `${ISSUER_URL}/token`,
      tokenEndpointAuthentication: 'client_secret_basic',
      jwksEndpoint: `${ISSUER_URL}/jwks`,
      userInfoEndpoint: `${ISSUER_URL}/userinfo`,
      discoveryEndpoint: `${ISSUER_URL}/.well-known/openid-configuration`,
      pkce: true,
    })
    expect(oidc.scopes).toEqual(['openid', 'email', 'profile'])

    // Idempotent re-activate (the crash-window retry): upsert converges on the
    // SAME plugin row — no duplicate, same registration id.
    const again = await caller.providers.activate({
      workspaceId: ws.id,
      providerId: created.id,
      domainId: domainRow.id,
    })
    expect(again.ssoProviderId).toBe(created.id)
    expect(await prisma.ssoProvider.count({ where: { providerId: created.id } })).toBe(1)
  })

  it('providers.activate SSRF-guards the admin-supplied issuer (private host rejected, no plugin row)', async () => {
    const { owner, ws } = await seed()
    const caller = identity(owner)
    const domainRow = await createVerifiedDomain(ws.id, owner.id)
    serveDiscovery()

    const created = await caller.providers.create({
      workspaceId: ws.id,
      type: 'OIDC',
      name: 'Internal IdP',
      issuerUrl: 'https://10.0.0.5/oidc',
      clientId: 'client-id',
      clientSecret: SECRET_PLAINTEXT,
    })
    await expect(
      caller.providers.activate({
        workspaceId: ws.id,
        providerId: created.id,
        domainId: domainRow.id,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    // Blocked before any fetch; provider untouched, no orphan plugin row.
    expect(ssoEdge.fetchCalls).toEqual([])
    expect(await prisma.ssoProvider.count({ where: { providerId: created.id } })).toBe(0)
    const row = await prisma.workspaceAuthProvider.findUniqueOrThrow({
      where: { id: created.id },
      select: { status: true, ssoProviderId: true },
    })
    expect(row.status).toBe('DISABLED')
    expect(row.ssoProviderId).toBeNull()
  })

  it('providers.activate rejects an oversized discovery document (no plugin row)', async () => {
    const { owner, ws } = await seed()
    const caller = identity(owner)
    const domainRow = await createVerifiedDomain(ws.id, owner.id)
    // A valid doc inflated past the 256 KB bound — rejected BEFORE parsing.
    serveDiscovery({ ...discoveryDocument(), padding: 'x'.repeat(256 * 1024) })

    const created = await caller.providers.create({
      workspaceId: ws.id,
      type: 'OIDC',
      name: 'Okta',
      issuerUrl: ISSUER_URL,
      clientId: 'client-id',
      clientSecret: SECRET_PLAINTEXT,
    })
    await expect(
      caller.providers.activate({
        workspaceId: ws.id,
        providerId: created.id,
        domainId: domainRow.id,
      }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: expect.stringContaining('256 КБ'),
    })
    expect(await prisma.ssoProvider.count({ where: { providerId: created.id } })).toBe(0)
  })

  it('providers.activate rejects a discovery response whose Content-Type is not JSON', async () => {
    const { owner, ws } = await seed()
    const caller = identity(owner)
    const domainRow = await createVerifiedDomain(ws.id, owner.id)
    serveDiscovery(discoveryDocument(), { contentType: 'text/html; charset=utf-8' })

    const created = await caller.providers.create({
      workspaceId: ws.id,
      type: 'OIDC',
      name: 'Okta',
      issuerUrl: ISSUER_URL,
      clientId: 'client-id',
      clientSecret: SECRET_PLAINTEXT,
    })
    await expect(
      caller.providers.activate({
        workspaceId: ws.id,
        providerId: created.id,
        domainId: domainRow.id,
      }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: expect.stringContaining('discovery-документ не является JSON'),
    })
    expect(await prisma.ssoProvider.count({ where: { providerId: created.id } })).toBe(0)
  })

  it('providers.activate rejects a discovery document without issuer (RFC 8414 requires it)', async () => {
    const { owner, ws } = await seed()
    const caller = identity(owner)
    const domainRow = await createVerifiedDomain(ws.id, owner.id)
    const docWithoutIssuer: Record<string, unknown> = { ...discoveryDocument() }
    delete docWithoutIssuer.issuer
    serveDiscovery(docWithoutIssuer)

    const created = await caller.providers.create({
      workspaceId: ws.id,
      type: 'OIDC',
      name: 'Okta',
      issuerUrl: ISSUER_URL,
      clientId: 'client-id',
      clientSecret: SECRET_PLAINTEXT,
    })
    await expect(
      caller.providers.activate({
        workspaceId: ws.id,
        providerId: created.id,
        domainId: domainRow.id,
      }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: expect.stringContaining('issuer в discovery-документе не совпадает'),
    })
    expect(await prisma.ssoProvider.count({ where: { providerId: created.id } })).toBe(0)
  })

  it('providers.disable and providers.delete deregister the plugin row', async () => {
    const { owner, ws } = await seed()
    const caller = identity(owner)
    const domainRow = await createVerifiedDomain(ws.id, owner.id)
    serveDiscovery()

    const created = await caller.providers.create({
      workspaceId: ws.id,
      type: 'OIDC',
      name: 'Okta',
      issuerUrl: ISSUER_URL,
      clientId: 'client-id',
      clientSecret: SECRET_PLAINTEXT,
    })
    await caller.providers.activate({
      workspaceId: ws.id,
      providerId: created.id,
      domainId: domainRow.id,
    })

    const disabled = await caller.providers.disable({
      workspaceId: ws.id,
      providerId: created.id,
    })
    expect(disabled.status).toBe('DISABLED')
    expect(disabled.ssoProviderId).toBeNull()
    expect(await prisma.ssoProvider.count({ where: { providerId: created.id } })).toBe(0)

    // Re-activate, then delete — the row and the registration must both go.
    await caller.providers.activate({
      workspaceId: ws.id,
      providerId: created.id,
      domainId: domainRow.id,
    })
    await caller.providers.delete({ workspaceId: ws.id, providerId: created.id })
    expect(await prisma.workspaceAuthProvider.count({ where: { id: created.id } })).toBe(0)
    expect(await prisma.ssoProvider.count({ where: { providerId: created.id } })).toBe(0)
  })

  // ── enterprise requests ───────────────────────────────────────────────────

  it('providers.requestEnterprise returns ok and the audit row is the record', async () => {
    const { owner, ws } = await seed()
    const result = await identity(owner).providers.requestEnterprise({
      workspaceId: ws.id,
      feature: 'SCIM',
    })
    expect(result.ok).toBe(true)
    const audit = await prisma.workspaceAuditLog.findMany({
      where: { workspaceId: ws.id, action: 'provider.enterprise_requested' },
    })
    expect(audit).toHaveLength(1)
    expect(audit[0]!.metadata).toMatchObject({ feature: 'SCIM' })
  })

  // ── domain join (member-level) ────────────────────────────────────────────

  it('domainJoin.listAvailable lists matching workspaces for outsiders; members and blocked users are excluded', async () => {
    const { owner, member, outsider, blocked, ws } = await seed()
    await identity(owner).allowedDomains.add({ workspaceId: ws.id, domain: FIXTURE_DOMAIN })

    const forOutsider = await identity(outsider).domainJoin.listAvailable()
    expect(forOutsider.map((w) => w.workspaceId)).toContain(ws.id)
    const entry = forOutsider.find((w) => w.workspaceId === ws.id)!
    expect(entry.name).toBe(ws.name)
    expect(entry.seatAvailable).toBe(true)

    const forMember = await identity(member).domainJoin.listAvailable()
    expect(forMember.map((w) => w.workspaceId)).not.toContain(ws.id)

    const forBlocked = await identity(blocked).domainJoin.listAvailable()
    expect(forBlocked.map((w) => w.workspaceId)).not.toContain(ws.id)
  })

  it('domainJoin.join lands a billable EDITOR member seat and returns the workspaceId for redirect', async () => {
    const { owner, outsider, ws } = await seed()
    await identity(owner).allowedDomains.add({ workspaceId: ws.id, domain: FIXTURE_DOMAIN })

    const joined = await identity(outsider).domainJoin.join({ workspaceId: ws.id })
    expect(joined).toMatchObject({ workspaceId: ws.id, role: 'EDITOR', alreadyMember: false })

    const memberRow = await prisma.workspaceMember.findUniqueOrThrow({
      where: { workspaceId_userId: { workspaceId: ws.id, userId: outsider.id } },
      select: { role: true },
    })
    // A real member seat — NOT the frozen legacy GUEST role, no share-grant path.
    expect(memberRow.role).toBe('EDITOR')
  })

  it('domainJoin.join denies a blocked user', async () => {
    const { owner, blocked, ws } = await seed()
    await identity(owner).allowedDomains.add({ workspaceId: ws.id, domain: FIXTURE_DOMAIN })

    await expect(
      identity(blocked).domainJoin.join({ workspaceId: ws.id }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', message: 'Доступ заблокирован администратором' })
    expect(
      await prisma.workspaceMember.count({
        where: { workspaceId: ws.id, userId: blocked.id },
      }),
    ).toBe(0)
  })
})
