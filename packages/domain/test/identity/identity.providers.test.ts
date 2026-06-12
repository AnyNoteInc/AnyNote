import { randomUUID } from 'node:crypto'

import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { prisma } from '@repo/db'

import { createDomain } from '../../src/container.ts'
import { DomainError, isDomainError } from '../../src/shared/errors.ts'
import {
  IDENTITY_AUDIT_ACTIONS,
  IDENTITY_ERROR_CODES,
  VERIFICATION_TXT_PREFIX,
  type CreateProviderInput,
  type IdentitySsoPort,
  type SsoRegistrationData,
} from '../../src/identity/index.ts'
import { makeScheduler } from '../helpers.ts'

// Real-DB integration test for the auth-provider arm of the identity domain
// service (Task 4): provider lifecycle behind the injected SSO port, the
// verified-domain gate, SSO resolution, enterprise requests, identity links.
// Email/domain-suffix fixture namespace, self-cleaning, FIXTURE-SCOPED asserts.

const DOMAIN_SUFFIX = 'idprov-test.dev'
const RUN = randomUUID().slice(0, 8)
const CORP_DOMAIN = `corp-${RUN}.${DOMAIN_SUFFIX}`
const OTHER_DOMAIN = `other-${RUN}.${DOMAIN_SUFFIX}`

const domain = createDomain({ prisma, scheduler: makeScheduler() })

// The encrypted-secret payload is OPAQUE Json to the domain (the ROUTER
// encrypts — ai-provider precedent). The marker lets deep JSON asserts prove
// the material never leaks into any returned shape, audit row, or port call.
const SECRET_MARKER = `enc-secret-marker-${RUN}`
const SECRET_ENC = { v: 1, alg: 'aes-256-gcm', iv: 'iv', tag: 'tag', data: SECRET_MARKER }
const ROTATED_MARKER = `enc-secret-rotated-${RUN}`
const ROTATED_ENC = { v: 1, alg: 'aes-256-gcm', iv: 'iv2', tag: 'tag2', data: ROTATED_MARKER }

async function cleanFixtures() {
  const byCreatorWs = { workspace: { createdBy: { email: { contains: DOMAIN_SUFFIX } } } }
  const byUser = { user: { email: { contains: DOMAIN_SUFFIX } } }
  await prisma.externalIdentityLink.deleteMany({ where: byUser })
  await prisma.workspaceAuditLog.deleteMany({ where: byCreatorWs })
  await prisma.workspaceAuthProvider.deleteMany({ where: byCreatorWs })
  await prisma.verifiedEmailDomain.deleteMany({ where: byCreatorWs })
  await prisma.allowedEmailDomain.deleteMany({ where: byCreatorWs })
  await prisma.workspaceBlockedUser.deleteMany({ where: { OR: [byCreatorWs, byUser] } })
  await prisma.collection.deleteMany({ where: byCreatorWs })
  await prisma.workspaceLimit.deleteMany({ where: byCreatorWs })
  await prisma.workspaceMember.deleteMany({ where: { OR: [byCreatorWs, byUser] } })
  await prisma.workspace.deleteMany({
    where: { createdBy: { email: { contains: DOMAIN_SUFFIX } } },
  })
  await prisma.user.deleteMany({ where: { email: { contains: DOMAIN_SUFFIX } } })
}

async function makeUser(label: string, emailDomain = CORP_DOMAIN) {
  return prisma.user.create({
    data: {
      email: `${label}-${RUN}@${emailDomain}`,
      emailVerified: true,
      name: label,
      firstName: label,
      lastName: 'Test',
    },
  })
}

async function seed() {
  const owner = await makeUser('owner')
  const ws = await prisma.workspace.create({
    data: { name: `IdProvWS-${RUN}`, createdById: owner.id },
  })
  await prisma.workspaceMember.create({
    data: { workspaceId: ws.id, userId: owner.id, role: 'OWNER' },
  })
  return { owner, ws }
}

async function expectDomainError(
  p: Promise<unknown>,
  code: string,
  httpStatus?: number,
): Promise<DomainError> {
  try {
    await p
  } catch (e) {
    if (!isDomainError(e)) throw e
    expect(e.code).toBe(code)
    if (httpStatus !== undefined) expect(e.httpStatus).toBe(httpStatus)
    return e
  }
  throw new Error(`expected DomainError ${code}, but the promise resolved`)
}

function auditRows(workspaceId: string, action: string) {
  return prisma.workspaceAuditLog.findMany({
    where: { workspaceId, action },
    orderBy: { createdAt: 'asc' },
  })
}

/** Deep JSON assert: no secret material and no clientSecretEnc key anywhere. */
function expectNoSecretMaterial(value: unknown) {
  const json = JSON.stringify(value) ?? ''
  expect(json).not.toContain(SECRET_MARKER)
  expect(json).not.toContain(ROTATED_MARKER)
  expect(json).not.toContain('clientSecretEnc')
}

interface PortCalls {
  register: SsoRegistrationData[]
  update: Array<{ ssoProviderId: string; data: SsoRegistrationData }>
  unregister: string[]
}

/** A fake SSO port capturing calls; register hands out unique plugin ids. */
function makeFakePort(overrides: Partial<IdentitySsoPort> = {}): {
  port: IdentitySsoPort
  calls: PortCalls
} {
  const calls: PortCalls = { register: [], update: [], unregister: [] }
  let seq = 0
  const port: IdentitySsoPort = {
    register: async (data) => {
      calls.register.push(data)
      seq += 1
      return { ssoProviderId: `sso-${RUN}-${randomUUID().slice(0, 8)}-${seq}` }
    },
    update: async (ssoProviderId, data) => {
      calls.update.push({ ssoProviderId, data })
    },
    unregister: async (ssoProviderId) => {
      calls.unregister.push(ssoProviderId)
    },
    ...overrides,
  }
  return { port, calls }
}

function oidcInput(
  workspaceId: string,
  actorId: string,
  over: Partial<CreateProviderInput> = {},
): CreateProviderInput {
  return {
    workspaceId,
    actorId,
    type: 'OIDC',
    name: 'Okta',
    issuerUrl: 'https://idp.example.com',
    clientId: 'client-123',
    clientSecretEnc: SECRET_ENC,
    ...over,
  }
}

/** start + DNS-check a domain through the real service (fake TXT resolver). */
async function makeVerifiedDomain(workspaceId: string, actorId: string, name = CORP_DOMAIN) {
  const started = await domain.identity.startDomainVerification({
    workspaceId,
    actorId,
    domain: name,
  })
  return domain.identity.checkDomainVerification(
    { workspaceId, actorId, domainId: started.id },
    async () => [[`${VERIFICATION_TXT_PREFIX}${started.verificationToken}`]],
  )
}

describe('identity providers', () => {
  beforeEach(cleanFixtures)
  afterAll(async () => {
    await cleanFixtures()
    await prisma.$disconnect()
  })

  it('exposes the provider arm on the domain container', () => {
    expect(typeof domain.identity.createProvider).toBe('function')
    expect(typeof domain.identity.activateProvider).toBe('function')
    expect(typeof domain.identity.resolveSsoProviderForEmail).toBe('function')
    expect(typeof domain.identity.requestEnterpriseFeature).toBe('function')
    expect(typeof domain.identity.linkExternalIdentity).toBe('function')
  })

  // ── createProvider validation matrix ─────────────────────────────────────────

  describe('createProvider', () => {
    it('rejects incomplete/invalid OIDC and OAUTH configs with INVALID_PROVIDER_CONFIG', async () => {
      const { ws, owner } = await seed()
      const cases: Array<Partial<CreateProviderInput>> = [
        { name: '   ' }, // empty name
        { name: 'x'.repeat(101) }, // name over VarChar(100)
        { issuerUrl: undefined }, // missing issuer
        { issuerUrl: 'http://idp.example.com' }, // not https
        { issuerUrl: 'not-a-url' }, // unparsable
        { clientId: undefined }, // missing client id
        { clientId: '   ' }, // blank client id
        { clientSecretEnc: undefined }, // missing secret
      ]
      for (const over of cases) {
        await expectDomainError(
          domain.identity.createProvider(oidcInput(ws.id, owner.id, over)),
          IDENTITY_ERROR_CODES.INVALID_PROVIDER_CONFIG,
          400,
        )
        await expectDomainError(
          domain.identity.createProvider(oidcInput(ws.id, owner.id, { ...over, type: 'OAUTH' })),
          IDENTITY_ERROR_CODES.INVALID_PROVIDER_CONFIG,
          400,
        )
      }
      expect(
        await prisma.workspaceAuthProvider.findMany({ where: { workspaceId: ws.id } }),
      ).toEqual([])
      expect(await auditRows(ws.id, IDENTITY_AUDIT_ACTIONS.providerCreated)).toHaveLength(0)
    })

    it('creates a DISABLED OIDC provider, audits, and never returns the secret', async () => {
      const { ws, owner } = await seed()
      const dto = await domain.identity.createProvider(
        oidcInput(ws.id, owner.id, { name: '  Okta  ' }),
      )
      expect(dto).toMatchObject({
        workspaceId: ws.id,
        type: 'OIDC',
        name: 'Okta',
        status: 'DISABLED',
        domainId: null,
        issuerUrl: 'https://idp.example.com',
        clientId: 'client-123',
        hasClientSecret: true,
        ssoProviderId: null,
        createdById: owner.id,
      })
      expectNoSecretMaterial(dto)

      // the encrypted payload IS persisted (opaque Json) — only the read shapes strip it
      const row = await prisma.workspaceAuthProvider.findUniqueOrThrow({ where: { id: dto.id } })
      expect(row.status).toBe('DISABLED')
      expect(JSON.stringify(row.clientSecretEnc)).toContain(SECRET_MARKER)

      const audits = await auditRows(ws.id, IDENTITY_AUDIT_ACTIONS.providerCreated)
      expect(audits).toHaveLength(1)
      expect(audits[0]!.actorId).toBe(owner.id)
      expect(audits[0]!.metadata).toMatchObject({ providerId: dto.id, name: 'Okta', type: 'OIDC' })
      expectNoSecretMaterial(audits)
    })

    it('SAML_RESERVED stores the name only, status locked DISABLED, connection fields dropped', async () => {
      const { ws, owner } = await seed()
      const dto = await domain.identity.createProvider(
        oidcInput(ws.id, owner.id, { type: 'SAML_RESERVED', name: 'Corp SAML' }),
      )
      expect(dto).toMatchObject({
        type: 'SAML_RESERVED',
        name: 'Corp SAML',
        status: 'DISABLED',
        issuerUrl: null,
        clientId: null,
        hasClientSecret: false,
        ssoProviderId: null,
      })
      const row = await prisma.workspaceAuthProvider.findUniqueOrThrow({ where: { id: dto.id } })
      expect(row.issuerUrl).toBeNull()
      expect(row.clientId).toBeNull()
      expect(row.clientSecretEnc).toBeNull()
      expect(await auditRows(ws.id, IDENTITY_AUDIT_ACTIONS.providerCreated)).toHaveLength(1)

      // a SAML provider still needs a non-empty name
      await expectDomainError(
        domain.identity.createProvider(
          oidcInput(ws.id, owner.id, { type: 'SAML_RESERVED', name: ' ' }),
        ),
        IDENTITY_ERROR_CODES.INVALID_PROVIDER_CONFIG,
        400,
      )
    })
  })

  // ── updateProvider ───────────────────────────────────────────────────────────

  describe('updateProvider', () => {
    it('partial update keeps the stored secret (optional-keep), audits provider.updated', async () => {
      const { ws, owner } = await seed()
      const { port, calls } = makeFakePort()
      const created = await domain.identity.createProvider(oidcInput(ws.id, owner.id))

      const dto = await domain.identity.updateProvider(
        { workspaceId: ws.id, actorId: owner.id, providerId: created.id, name: 'Renamed' },
        port,
      )
      expect(dto.name).toBe('Renamed')
      expect(dto.issuerUrl).toBe('https://idp.example.com')
      expect(dto.hasClientSecret).toBe(true)
      expectNoSecretMaterial(dto)

      const row = await prisma.workspaceAuthProvider.findUniqueOrThrow({
        where: { id: created.id },
      })
      expect(JSON.stringify(row.clientSecretEnc)).toContain(SECRET_MARKER) // kept

      const audits = await auditRows(ws.id, IDENTITY_AUDIT_ACTIONS.providerUpdated)
      expect(audits).toHaveLength(1)
      expect(audits[0]!.metadata).toMatchObject({ providerId: created.id, secretRotated: false })
      expectNoSecretMaterial(audits)
      // DISABLED provider: the plugin row does not exist — no port traffic
      expect(calls.register).toHaveLength(0)
      expect(calls.update).toHaveLength(0)
      expect(calls.unregister).toHaveLength(0)
    })

    it('replaces the secret when a new payload is provided', async () => {
      const { ws, owner } = await seed()
      const { port } = makeFakePort()
      const created = await domain.identity.createProvider(oidcInput(ws.id, owner.id))
      await domain.identity.updateProvider(
        {
          workspaceId: ws.id,
          actorId: owner.id,
          providerId: created.id,
          clientSecretEnc: ROTATED_ENC,
        },
        port,
      )
      const row = await prisma.workspaceAuthProvider.findUniqueOrThrow({
        where: { id: created.id },
      })
      const json = JSON.stringify(row.clientSecretEnc)
      expect(json).toContain(ROTATED_MARKER)
      expect(json).not.toContain(SECRET_MARKER)
      const audits = await auditRows(ws.id, IDENTITY_AUDIT_ACTIONS.providerUpdated)
      expect(audits[0]!.metadata).toMatchObject({ secretRotated: true })
      expectNoSecretMaterial(audits)
    })

    it('rejects a merged config that turns invalid (non-https issuer)', async () => {
      const { ws, owner } = await seed()
      const { port } = makeFakePort()
      const created = await domain.identity.createProvider(oidcInput(ws.id, owner.id))
      await expectDomainError(
        domain.identity.updateProvider(
          {
            workspaceId: ws.id,
            actorId: owner.id,
            providerId: created.id,
            issuerUrl: 'http://downgraded.example.com',
          },
          port,
        ),
        IDENTITY_ERROR_CODES.INVALID_PROVIDER_CONFIG,
        400,
      )
      const row = await prisma.workspaceAuthProvider.findUniqueOrThrow({
        where: { id: created.id },
      })
      expect(row.issuerUrl).toBe('https://idp.example.com')
    })

    it('unknown or foreign-workspace provider id ⇒ PROVIDER_NOT_FOUND', async () => {
      const { ws, owner } = await seed()
      const { port } = makeFakePort()
      await expectDomainError(
        domain.identity.updateProvider(
          { workspaceId: ws.id, actorId: owner.id, providerId: randomUUID(), name: 'X' },
          port,
        ),
        IDENTITY_ERROR_CODES.PROVIDER_NOT_FOUND,
        404,
      )
      const other = await prisma.workspace.create({
        data: { name: `IdProvWS2-${RUN}`, createdById: owner.id },
      })
      const foreign = await domain.identity.createProvider(oidcInput(other.id, owner.id))
      await expectDomainError(
        domain.identity.updateProvider(
          { workspaceId: ws.id, actorId: owner.id, providerId: foreign.id, name: 'X' },
          port,
        ),
        IDENTITY_ERROR_CODES.PROVIDER_NOT_FOUND,
        404,
      )
    })

    it('an ACTIVE provider syncs the plugin row via port.update (no secret in the call)', async () => {
      const { ws, owner } = await seed()
      const { port, calls } = makeFakePort()
      const verified = await makeVerifiedDomain(ws.id, owner.id)
      const created = await domain.identity.createProvider(oidcInput(ws.id, owner.id))
      const activated = await domain.identity.activateProvider(
        { workspaceId: ws.id, actorId: owner.id, providerId: created.id, domainId: verified.id },
        port,
      )

      const dto = await domain.identity.updateProvider(
        { workspaceId: ws.id, actorId: owner.id, providerId: created.id, name: 'Synced' },
        port,
      )
      expect(dto.name).toBe('Synced')
      expect(calls.update).toHaveLength(1)
      expect(calls.update[0]!.ssoProviderId).toBe(activated.ssoProviderId)
      expect(calls.update[0]!.data).toMatchObject({
        providerId: created.id,
        workspaceId: ws.id,
        name: 'Synced',
        issuerUrl: 'https://idp.example.com',
        clientId: 'client-123',
        domain: CORP_DOMAIN,
        actorId: owner.id,
      })
      expectNoSecretMaterial(calls)
    })

    it('port.update failure on an ACTIVE provider aborts: state unchanged, no audit', async () => {
      const { ws, owner } = await seed()
      const { port } = makeFakePort()
      const verified = await makeVerifiedDomain(ws.id, owner.id)
      const created = await domain.identity.createProvider(oidcInput(ws.id, owner.id))
      await domain.identity.activateProvider(
        { workspaceId: ws.id, actorId: owner.id, providerId: created.id, domainId: verified.id },
        port,
      )
      const { port: failing } = makeFakePort({
        update: async () => {
          throw new Error('sso plugin row update failed')
        },
      })
      await expect(
        domain.identity.updateProvider(
          { workspaceId: ws.id, actorId: owner.id, providerId: created.id, name: 'Nope' },
          failing,
        ),
      ).rejects.toThrow('sso plugin row update failed')
      const row = await prisma.workspaceAuthProvider.findUniqueOrThrow({
        where: { id: created.id },
      })
      expect(row.name).toBe('Okta')
      expect(await auditRows(ws.id, IDENTITY_AUDIT_ACTIONS.providerUpdated)).toHaveLength(0)
    })
  })

  // ── activateProvider: the verified-domain gate ───────────────────────────────

  describe('activateProvider', () => {
    it('gate: missing, unverified, or foreign-workspace domain ⇒ DOMAIN_NOT_VERIFIED', async () => {
      const { ws, owner } = await seed()
      const { port, calls } = makeFakePort()
      const created = await domain.identity.createProvider(oidcInput(ws.id, owner.id))

      // (a) missing domain row
      await expectDomainError(
        domain.identity.activateProvider(
          { workspaceId: ws.id, actorId: owner.id, providerId: created.id, domainId: randomUUID() },
          port,
        ),
        IDENTITY_ERROR_CODES.DOMAIN_NOT_VERIFIED,
        412,
      )
      // (b) PENDING (started, never checked) domain
      const pending = await domain.identity.startDomainVerification({
        workspaceId: ws.id,
        actorId: owner.id,
        domain: CORP_DOMAIN,
      })
      await expectDomainError(
        domain.identity.activateProvider(
          { workspaceId: ws.id, actorId: owner.id, providerId: created.id, domainId: pending.id },
          port,
        ),
        IDENTITY_ERROR_CODES.DOMAIN_NOT_VERIFIED,
        412,
      )
      // (c) a VERIFIED domain of ANOTHER workspace
      const other = await prisma.workspace.create({
        data: { name: `IdProvWS3-${RUN}`, createdById: owner.id },
      })
      const foreignVerified = await makeVerifiedDomain(other.id, owner.id, OTHER_DOMAIN)
      await expectDomainError(
        domain.identity.activateProvider(
          {
            workspaceId: ws.id,
            actorId: owner.id,
            providerId: created.id,
            domainId: foreignVerified.id,
          },
          port,
        ),
        IDENTITY_ERROR_CODES.DOMAIN_NOT_VERIFIED,
        412,
      )

      // nothing moved: still DISABLED, never registered, no activation audit
      const row = await prisma.workspaceAuthProvider.findUniqueOrThrow({
        where: { id: created.id },
      })
      expect(row.status).toBe('DISABLED')
      expect(row.ssoProviderId).toBeNull()
      expect(calls.register).toHaveLength(0)
      expect(await auditRows(ws.id, IDENTITY_AUDIT_ACTIONS.providerActivated)).toHaveLength(0)
    })

    it('reserved honesty: SAML_RESERVED creates fine but can NEVER activate (FEATURE_RESERVED)', async () => {
      const { ws, owner } = await seed()
      const { port, calls } = makeFakePort()
      const verified = await makeVerifiedDomain(ws.id, owner.id)
      const saml = await domain.identity.createProvider(
        oidcInput(ws.id, owner.id, { type: 'SAML_RESERVED', name: 'Corp SAML' }),
      )
      await expectDomainError(
        domain.identity.activateProvider(
          { workspaceId: ws.id, actorId: owner.id, providerId: saml.id, domainId: verified.id },
          port,
        ),
        IDENTITY_ERROR_CODES.FEATURE_RESERVED,
        403,
      )
      expect(calls.register).toHaveLength(0)
      const row = await prisma.workspaceAuthProvider.findUniqueOrThrow({ where: { id: saml.id } })
      expect(row.status).toBe('DISABLED')
    })

    it('defensive: an incomplete config (direct insert) cannot activate ⇒ INVALID_PROVIDER_CONFIG', async () => {
      const { ws, owner } = await seed()
      const { port } = makeFakePort()
      const verified = await makeVerifiedDomain(ws.id, owner.id)
      const bare = await prisma.workspaceAuthProvider.create({
        data: { workspaceId: ws.id, type: 'OIDC', name: 'Bare', createdById: owner.id },
      })
      await expectDomainError(
        domain.identity.activateProvider(
          { workspaceId: ws.id, actorId: owner.id, providerId: bare.id, domainId: verified.id },
          port,
        ),
        IDENTITY_ERROR_CODES.INVALID_PROVIDER_CONFIG,
        400,
      )
    })

    it('happy path: validate → port.register → persist ssoProviderId → audit', async () => {
      const { ws, owner } = await seed()
      const { port, calls } = makeFakePort()
      const verified = await makeVerifiedDomain(ws.id, owner.id)
      const created = await domain.identity.createProvider(oidcInput(ws.id, owner.id))

      const dto = await domain.identity.activateProvider(
        { workspaceId: ws.id, actorId: owner.id, providerId: created.id, domainId: verified.id },
        port,
      )
      expect(dto.status).toBe('ACTIVE')
      expect(dto.domainId).toBe(verified.id)
      expect(dto.ssoProviderId).toBeTruthy()
      expectNoSecretMaterial(dto)

      expect(calls.register).toHaveLength(1)
      expect(calls.register[0]).toMatchObject({
        providerId: created.id,
        workspaceId: ws.id,
        name: 'Okta',
        issuerUrl: 'https://idp.example.com',
        clientId: 'client-123',
        domain: CORP_DOMAIN,
        actorId: owner.id,
      })
      // the port call carries NO secret — the router's closure holds it
      expectNoSecretMaterial(calls)

      const row = await prisma.workspaceAuthProvider.findUniqueOrThrow({
        where: { id: created.id },
      })
      expect(row.status).toBe('ACTIVE')
      expect(row.ssoProviderId).toBe(dto.ssoProviderId)

      const audits = await auditRows(ws.id, IDENTITY_AUDIT_ACTIONS.providerActivated)
      expect(audits).toHaveLength(1)
      expect(audits[0]!.metadata).toMatchObject({ providerId: created.id, domain: CORP_DOMAIN })
      expectNoSecretMaterial(audits)
    })

    it('re-activation with an existing registration re-binds via port.update (id stable)', async () => {
      const { ws, owner } = await seed()
      const { port, calls } = makeFakePort()
      const first = await makeVerifiedDomain(ws.id, owner.id)
      const second = await makeVerifiedDomain(ws.id, owner.id, OTHER_DOMAIN)
      const created = await domain.identity.createProvider(oidcInput(ws.id, owner.id))
      const activated = await domain.identity.activateProvider(
        { workspaceId: ws.id, actorId: owner.id, providerId: created.id, domainId: first.id },
        port,
      )
      const rebound = await domain.identity.activateProvider(
        { workspaceId: ws.id, actorId: owner.id, providerId: created.id, domainId: second.id },
        port,
      )
      expect(calls.register).toHaveLength(1) // only the first activation registers
      expect(calls.update).toHaveLength(1)
      expect(calls.update[0]!.ssoProviderId).toBe(activated.ssoProviderId)
      expect(calls.update[0]!.data.domain).toBe(OTHER_DOMAIN)
      expect(rebound.ssoProviderId).toBe(activated.ssoProviderId)
      expect(rebound.domainId).toBe(second.id)
      expect(await auditRows(ws.id, IDENTITY_AUDIT_ACTIONS.providerActivated)).toHaveLength(2)
    })

    it('port.register failure aborts: still DISABLED, no ssoProviderId, no audit', async () => {
      const { ws, owner } = await seed()
      const verified = await makeVerifiedDomain(ws.id, owner.id)
      const created = await domain.identity.createProvider(oidcInput(ws.id, owner.id))
      const { port: failing } = makeFakePort({
        register: async () => {
          throw new Error('discovery fetch failed')
        },
      })
      await expect(
        domain.identity.activateProvider(
          { workspaceId: ws.id, actorId: owner.id, providerId: created.id, domainId: verified.id },
          failing,
        ),
      ).rejects.toThrow('discovery fetch failed')
      const row = await prisma.workspaceAuthProvider.findUniqueOrThrow({
        where: { id: created.id },
      })
      expect(row.status).toBe('DISABLED')
      expect(row.ssoProviderId).toBeNull()
      expect(row.domainId).toBeNull()
      expect(await auditRows(ws.id, IDENTITY_AUDIT_ACTIONS.providerActivated)).toHaveLength(0)
    })
  })

  // ── disable / delete round-trip ──────────────────────────────────────────────

  describe('disableProvider / deleteProvider', () => {
    async function activeProvider(wsId: string, ownerId: string, port: IdentitySsoPort) {
      const verified = await makeVerifiedDomain(wsId, ownerId)
      const created = await domain.identity.createProvider(oidcInput(wsId, ownerId))
      return domain.identity.activateProvider(
        { workspaceId: wsId, actorId: ownerId, providerId: created.id, domainId: verified.id },
        port,
      )
    }

    it('disable unregisters the plugin row, clears ssoProviderId, audits; idempotent re-disable', async () => {
      const { ws, owner } = await seed()
      const { port, calls } = makeFakePort()
      const active = await activeProvider(ws.id, owner.id, port)

      const dto = await domain.identity.disableProvider(
        { workspaceId: ws.id, actorId: owner.id, providerId: active.id },
        port,
      )
      expect(dto.status).toBe('DISABLED')
      expect(dto.ssoProviderId).toBeNull()
      expect(calls.unregister).toEqual([active.ssoProviderId])

      const row = await prisma.workspaceAuthProvider.findUniqueOrThrow({ where: { id: active.id } })
      expect(row.status).toBe('DISABLED')
      expect(row.ssoProviderId).toBeNull()
      expect(await auditRows(ws.id, IDENTITY_AUDIT_ACTIONS.providerDisabled)).toHaveLength(1)

      // already DISABLED ⇒ no-op: no extra port call, no extra audit
      const again = await domain.identity.disableProvider(
        { workspaceId: ws.id, actorId: owner.id, providerId: active.id },
        port,
      )
      expect(again.status).toBe('DISABLED')
      expect(calls.unregister).toHaveLength(1)
      expect(await auditRows(ws.id, IDENTITY_AUDIT_ACTIONS.providerDisabled)).toHaveLength(1)
    })

    it('disable port failure ⇒ throw, provider stays ACTIVE with its registration', async () => {
      const { ws, owner } = await seed()
      const { port } = makeFakePort()
      const active = await activeProvider(ws.id, owner.id, port)
      const { port: failing } = makeFakePort({
        unregister: async () => {
          throw new Error('plugin row delete failed')
        },
      })
      await expect(
        domain.identity.disableProvider(
          { workspaceId: ws.id, actorId: owner.id, providerId: active.id },
          failing,
        ),
      ).rejects.toThrow('plugin row delete failed')
      const row = await prisma.workspaceAuthProvider.findUniqueOrThrow({ where: { id: active.id } })
      expect(row.status).toBe('ACTIVE')
      expect(row.ssoProviderId).toBe(active.ssoProviderId)
      expect(await auditRows(ws.id, IDENTITY_AUDIT_ACTIONS.providerDisabled)).toHaveLength(0)
    })

    it('delete on an ACTIVE provider auto-unregisters, deletes, audits; links cascade', async () => {
      const { ws, owner } = await seed()
      const { port, calls } = makeFakePort()
      const active = await activeProvider(ws.id, owner.id, port)
      const link = await domain.identity.linkExternalIdentity({
        providerId: active.id,
        userId: owner.id,
        externalSubject: `sub-${RUN}-cascade`,
      })

      const result = await domain.identity.deleteProvider(
        { workspaceId: ws.id, actorId: owner.id, providerId: active.id },
        port,
      )
      expect(result).toEqual({ id: active.id })
      expect(calls.unregister).toEqual([active.ssoProviderId])
      expect(await prisma.workspaceAuthProvider.findUnique({ where: { id: active.id } })).toBeNull()
      expect(await prisma.externalIdentityLink.findUnique({ where: { id: link.id } })).toBeNull()

      const audits = await auditRows(ws.id, IDENTITY_AUDIT_ACTIONS.providerDeleted)
      expect(audits).toHaveLength(1)
      expect(audits[0]!.metadata).toMatchObject({ providerId: active.id, name: 'Okta' })
      expectNoSecretMaterial(audits)
    })

    it('delete port failure aborts: the provider row survives untouched', async () => {
      const { ws, owner } = await seed()
      const { port } = makeFakePort()
      const active = await activeProvider(ws.id, owner.id, port)
      const { port: failing } = makeFakePort({
        unregister: async () => {
          throw new Error('plugin row delete failed')
        },
      })
      await expect(
        domain.identity.deleteProvider(
          { workspaceId: ws.id, actorId: owner.id, providerId: active.id },
          failing,
        ),
      ).rejects.toThrow('plugin row delete failed')
      const row = await prisma.workspaceAuthProvider.findUniqueOrThrow({ where: { id: active.id } })
      expect(row.status).toBe('ACTIVE')
      expect(row.ssoProviderId).toBe(active.ssoProviderId)
      expect(await auditRows(ws.id, IDENTITY_AUDIT_ACTIONS.providerDeleted)).toHaveLength(0)
    })

    it('delete on a DISABLED provider makes no port calls', async () => {
      const { ws, owner } = await seed()
      const { port, calls } = makeFakePort()
      const created = await domain.identity.createProvider(oidcInput(ws.id, owner.id))
      await domain.identity.deleteProvider(
        { workspaceId: ws.id, actorId: owner.id, providerId: created.id },
        port,
      )
      expect(calls.unregister).toHaveLength(0)
      expect(
        await prisma.workspaceAuthProvider.findUnique({ where: { id: created.id } }),
      ).toBeNull()
    })

    it('unknown provider ⇒ PROVIDER_NOT_FOUND for disable and delete', async () => {
      const { ws, owner } = await seed()
      const { port } = makeFakePort()
      for (const fn of ['disableProvider', 'deleteProvider'] as const) {
        await expectDomainError(
          domain.identity[fn](
            { workspaceId: ws.id, actorId: owner.id, providerId: randomUUID() },
            port,
          ),
          IDENTITY_ERROR_CODES.PROVIDER_NOT_FOUND,
          404,
        )
      }
    })
  })

  // ── removeVerifiedDomain unregisters in lock-step (invariant 2 + sso.md) ────

  describe('removeVerifiedDomain with registered providers', () => {
    it('unregisters the bound ACTIVE registration and clears ssoProviderId in the same flow', async () => {
      const { ws, owner } = await seed()
      const { port, calls } = makeFakePort()
      const verified = await makeVerifiedDomain(ws.id, owner.id)
      const created = await domain.identity.createProvider(oidcInput(ws.id, owner.id))
      const active = await domain.identity.activateProvider(
        { workspaceId: ws.id, actorId: owner.id, providerId: created.id, domainId: verified.id },
        port,
      )

      const result = await domain.identity.removeVerifiedDomain(
        { workspaceId: ws.id, actorId: owner.id, domainId: verified.id },
        port,
      )
      expect(result).toEqual({ id: verified.id, providersDisabled: 1 })
      expect(calls.unregister).toEqual([active.ssoProviderId])

      const row = await prisma.workspaceAuthProvider.findUniqueOrThrow({
        where: { id: created.id },
      })
      expect(row.status).toBe('DISABLED')
      expect(row.ssoProviderId).toBeNull()
      expect(row.domainId).toBeNull()
    })

    it('a mid-loop port failure aborts BEFORE any DB write — nothing changes', async () => {
      const { ws, owner } = await seed()
      const { port } = makeFakePort()
      const verified = await makeVerifiedDomain(ws.id, owner.id)
      const first = await domain.identity.createProvider(
        oidcInput(ws.id, owner.id, { name: 'First' }),
      )
      const second = await domain.identity.createProvider(
        oidcInput(ws.id, owner.id, { name: 'Second' }),
      )
      const activeFirst = await domain.identity.activateProvider(
        { workspaceId: ws.id, actorId: owner.id, providerId: first.id, domainId: verified.id },
        port,
      )
      const activeSecond = await domain.identity.activateProvider(
        { workspaceId: ws.id, actorId: owner.id, providerId: second.id, domainId: verified.id },
        port,
      )

      // Unregister #2 throws. Every call first PROVES no provider row is held
      // by an open removal tx (`FOR UPDATE NOWAIT` errors on locked rows) —
      // i.e. the port loop runs strictly BEFORE the DB transaction starts.
      const unregistered: string[] = []
      const failingPort: IdentitySsoPort = {
        register: port.register,
        update: port.update,
        unregister: async (ssoProviderId) => {
          await prisma.$queryRaw`
            SELECT id FROM workspace_auth_providers
            WHERE workspace_id = ${ws.id}::uuid FOR UPDATE NOWAIT`
          unregistered.push(ssoProviderId)
          if (unregistered.length === 2) {
            throw new Error('idp unavailable on the second unregister')
          }
        },
      }
      await expect(
        domain.identity.removeVerifiedDomain(
          { workspaceId: ws.id, actorId: owner.id, domainId: verified.id },
          failingPort,
        ),
      ).rejects.toThrow('idp unavailable on the second unregister')
      const byCode = (a: string | null, b: string | null) => (a ?? '').localeCompare(b ?? '')
      expect([...unregistered].sort(byCode)).toEqual(
        [activeFirst.ssoProviderId, activeSecond.ssoProviderId].sort(byCode),
      )

      // NOTHING changed: both providers still ACTIVE + registered + bound,
      // the domain row still present, no disable/removal audits.
      for (const created of [first, second]) {
        const dbRow = await prisma.workspaceAuthProvider.findUniqueOrThrow({
          where: { id: created.id },
        })
        expect(dbRow.status).toBe('ACTIVE')
        expect(dbRow.ssoProviderId).not.toBeNull()
        expect(dbRow.domainId).toBe(verified.id)
      }
      expect(
        await prisma.verifiedEmailDomain.findUnique({ where: { id: verified.id } }),
      ).not.toBeNull()
      expect(await auditRows(ws.id, IDENTITY_AUDIT_ACTIONS.providerDisabled)).toHaveLength(0)
      expect(await auditRows(ws.id, IDENTITY_AUDIT_ACTIONS.verifiedRemoved)).toHaveLength(0)
    })

    it('without a port a registered ACTIVE provider blocks the removal (state unchanged)', async () => {
      const { ws, owner } = await seed()
      const { port } = makeFakePort()
      const verified = await makeVerifiedDomain(ws.id, owner.id)
      const created = await domain.identity.createProvider(oidcInput(ws.id, owner.id))
      await domain.identity.activateProvider(
        { workspaceId: ws.id, actorId: owner.id, providerId: created.id, domainId: verified.id },
        port,
      )
      await expect(
        domain.identity.removeVerifiedDomain({
          workspaceId: ws.id,
          actorId: owner.id,
          domainId: verified.id,
        }),
      ).rejects.toThrow(/IdentitySsoPort/)
      expect(
        await prisma.verifiedEmailDomain.findUnique({ where: { id: verified.id } }),
      ).not.toBeNull()
      const row = await prisma.workspaceAuthProvider.findUniqueOrThrow({
        where: { id: created.id },
      })
      expect(row.status).toBe('ACTIVE')
    })
  })

  // ── secret hygiene across the read surface ───────────────────────────────────

  it('listProviders/getProvider strip the secret at the DOMAIN level; audits stay clean', async () => {
    const { ws, owner } = await seed()
    const { port } = makeFakePort()
    const verified = await makeVerifiedDomain(ws.id, owner.id)
    const created = await domain.identity.createProvider(oidcInput(ws.id, owner.id))
    await domain.identity.activateProvider(
      { workspaceId: ws.id, actorId: owner.id, providerId: created.id, domainId: verified.id },
      port,
    )
    await domain.identity.updateProvider(
      {
        workspaceId: ws.id,
        actorId: owner.id,
        providerId: created.id,
        clientSecretEnc: ROTATED_ENC,
      },
      port,
    )
    await domain.identity.createProvider(
      oidcInput(ws.id, owner.id, { type: 'SAML_RESERVED', name: 'Corp SAML' }),
    )

    const list = await domain.identity.listProviders(ws.id)
    expect(list).toHaveLength(2)
    expectNoSecretMaterial(list)
    expect(list.map((p) => p.name).sort()).toEqual(['Corp SAML', 'Okta'])

    const got = await domain.identity.getProvider(ws.id, created.id)
    expect(got.hasClientSecret).toBe(true)
    expectNoSecretMaterial(got)
    await expectDomainError(
      domain.identity.getProvider(ws.id, randomUUID()),
      IDENTITY_ERROR_CODES.PROVIDER_NOT_FOUND,
      404,
    )

    // EVERY audit row written by the whole flow is free of secret material
    const allAudits = await prisma.workspaceAuditLog.findMany({ where: { workspaceId: ws.id } })
    expect(allAudits.length).toBeGreaterThan(0)
    expectNoSecretMaterial(allAudits.map((a) => a.metadata))
  })

  // ── resolveSsoProviderForEmail ───────────────────────────────────────────────

  describe('resolveSsoProviderForEmail', () => {
    it('returns {ssoProviderId} for a VERIFIED domain with an ACTIVE registered provider', async () => {
      const { ws, owner } = await seed()
      const { port } = makeFakePort()
      const verified = await makeVerifiedDomain(ws.id, owner.id)
      const created = await domain.identity.createProvider(oidcInput(ws.id, owner.id))
      const active = await domain.identity.activateProvider(
        { workspaceId: ws.id, actorId: owner.id, providerId: created.id, domainId: verified.id },
        port,
      )
      const resolved = await domain.identity.resolveSsoProviderForEmail(
        `Someone@${CORP_DOMAIN.toUpperCase()}`,
      )
      expect(resolved).toEqual({ ssoProviderId: active.ssoProviderId })
    })

    it('returns uniform null for every other case (no oracle)', async () => {
      const { ws, owner } = await seed()
      const { port } = makeFakePort()

      // (1) no domain anywhere / malformed email
      expect(await domain.identity.resolveSsoProviderForEmail(`x@${CORP_DOMAIN}`)).toBeNull()
      expect(await domain.identity.resolveSsoProviderForEmail('not-an-email')).toBeNull()

      // (2) domain exists but is NOT verified — even with a (fixture-forced)
      // ACTIVE registered provider bound to it
      const pending = await domain.identity.startDomainVerification({
        workspaceId: ws.id,
        actorId: owner.id,
        domain: CORP_DOMAIN,
      })
      await prisma.workspaceAuthProvider.create({
        data: {
          workspaceId: ws.id,
          type: 'OIDC',
          name: 'Forced',
          status: 'ACTIVE',
          domainId: pending.id,
          issuerUrl: 'https://idp.example.com',
          clientId: 'client-123',
          ssoProviderId: `sso-${RUN}-forced-pending`,
          createdById: owner.id,
        },
      })
      expect(await domain.identity.resolveSsoProviderForEmail(`x@${CORP_DOMAIN}`)).toBeNull()

      // (3) VERIFIED domain with a DISABLED provider
      const verified = await makeVerifiedDomain(ws.id, owner.id, OTHER_DOMAIN)
      const created = await domain.identity.createProvider(
        oidcInput(ws.id, owner.id, { name: 'Disablee' }),
      )
      const active = await domain.identity.activateProvider(
        { workspaceId: ws.id, actorId: owner.id, providerId: created.id, domainId: verified.id },
        port,
      )
      await domain.identity.disableProvider(
        { workspaceId: ws.id, actorId: owner.id, providerId: active.id },
        port,
      )
      expect(await domain.identity.resolveSsoProviderForEmail(`x@${OTHER_DOMAIN}`)).toBeNull()

      // (4) VERIFIED domain, ACTIVE provider but NO registration (fixture-forced)
      await prisma.workspaceAuthProvider.update({
        where: { id: created.id },
        data: { status: 'ACTIVE', domainId: verified.id, ssoProviderId: null },
      })
      expect(await domain.identity.resolveSsoProviderForEmail(`x@${OTHER_DOMAIN}`)).toBeNull()
    })
  })

  // ── enterprise requests ──────────────────────────────────────────────────────

  it('requestEnterpriseFeature audits in-tx and returns the notification payload', async () => {
    const { ws, owner } = await seed()
    const before = Date.now()
    const result = await domain.identity.requestEnterpriseFeature({
      workspaceId: ws.id,
      actorId: owner.id,
      feature: 'SCIM',
    })
    expect(result.workspaceId).toBe(ws.id)
    expect(result.actorId).toBe(owner.id)
    expect(result.feature).toBe('SCIM')
    expect(result.requestedAt).toBeInstanceOf(Date)
    expect(result.requestedAt.getTime()).toBeGreaterThanOrEqual(before - 1000)

    await domain.identity.requestEnterpriseFeature({
      workspaceId: ws.id,
      actorId: owner.id,
      feature: 'SAML',
    })

    const audits = await auditRows(ws.id, IDENTITY_AUDIT_ACTIONS.enterpriseRequested)
    expect(audits).toHaveLength(2)
    expect(audits[0]!.actorId).toBe(owner.id)
    expect(audits.map((a) => (a.metadata as { feature: string }).feature).sort()).toEqual([
      'SAML',
      'SCIM',
    ])
  })

  // ── linkExternalIdentity (Task 6's callback consumer) ────────────────────────

  describe('linkExternalIdentity', () => {
    it('first link creates the row and audits sso.identity_linked exactly once', async () => {
      const { ws, owner } = await seed()
      const user = await makeUser('linked')
      const created = await domain.identity.createProvider(oidcInput(ws.id, owner.id))

      const link = await domain.identity.linkExternalIdentity({
        providerId: created.id,
        userId: user.id,
        externalSubject: `sub-${RUN}-1`,
        email: user.email,
      })
      expect(link).toMatchObject({
        providerId: created.id,
        userId: user.id,
        externalSubject: `sub-${RUN}-1`,
        email: user.email,
      })
      expect(link.linkedAt).toBeInstanceOf(Date)

      const audits = await auditRows(ws.id, IDENTITY_AUDIT_ACTIONS.identityLinked)
      expect(audits).toHaveLength(1)
      expect(audits[0]!.actorId).toBe(user.id)
      expect(audits[0]!.targetUserId).toBe(user.id)

      // idempotent re-link: same row, NO duplicate audit
      const again = await domain.identity.linkExternalIdentity({
        providerId: created.id,
        userId: user.id,
        externalSubject: `sub-${RUN}-1`,
        email: user.email,
      })
      expect(again.id).toBe(link.id)
      expect(
        await prisma.externalIdentityLink.findMany({ where: { providerId: created.id } }),
      ).toHaveLength(1)
      expect(await auditRows(ws.id, IDENTITY_AUDIT_ACTIONS.identityLinked)).toHaveLength(1)
    })

    it('re-linking the same subject to a DIFFERENT user re-points the row and audits again', async () => {
      const { ws, owner } = await seed()
      const userA = await makeUser('link-a')
      const userB = await makeUser('link-b')
      const created = await domain.identity.createProvider(oidcInput(ws.id, owner.id))

      const first = await domain.identity.linkExternalIdentity({
        providerId: created.id,
        userId: userA.id,
        externalSubject: `sub-${RUN}-2`,
      })
      const second = await domain.identity.linkExternalIdentity({
        providerId: created.id,
        userId: userB.id,
        externalSubject: `sub-${RUN}-2`,
      })
      expect(second.id).toBe(first.id)
      expect(second.userId).toBe(userB.id)
      expect(
        await prisma.externalIdentityLink.findMany({ where: { providerId: created.id } }),
      ).toHaveLength(1)
      expect(await auditRows(ws.id, IDENTITY_AUDIT_ACTIONS.identityLinked)).toHaveLength(2)
    })

    it('unknown provider ⇒ PROVIDER_NOT_FOUND', async () => {
      const { owner } = await seed()
      await expectDomainError(
        domain.identity.linkExternalIdentity({
          providerId: randomUUID(),
          userId: owner.id,
          externalSubject: 'sub-x',
        }),
        IDENTITY_ERROR_CODES.PROVIDER_NOT_FOUND,
        404,
      )
    })
  })
})
