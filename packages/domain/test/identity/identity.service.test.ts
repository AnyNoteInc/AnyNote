import { randomUUID } from 'node:crypto'

import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { prisma, RoleType } from '@repo/db'

import { createDomain } from '../../src/container.ts'
import { DomainError, isDomainError } from '../../src/shared/errors.ts'
import {
  IDENTITY_AUDIT_ACTIONS,
  IDENTITY_ERROR_CODES,
  PUBLIC_EMAIL_DOMAINS,
  VERIFICATION_TXT_PREFIX,
  generateVerificationToken,
  type ResolveTxtFn,
} from '../../src/identity/index.ts'
import { makeScheduler } from '../helpers.ts'

// Real-DB integration test for the identity domain service. Email/domain-suffix
// fixture namespace, self-cleaning. Requires `docker compose up -d` (postgres).
// All asserts are FIXTURE-SCOPED (per-workspace / per-user) — never global.

const DOMAIN_SUFFIX = 'idsvc-test.dev'
const RUN = randomUUID().slice(0, 8)
const CORP_DOMAIN = `corp-${RUN}.${DOMAIN_SUFFIX}`
const OTHER_DOMAIN = `other-${RUN}.${DOMAIN_SUFFIX}`

const domain = createDomain({ prisma, scheduler: makeScheduler() })

async function cleanFixtures() {
  const byCreatorWs = { workspace: { createdBy: { email: { contains: DOMAIN_SUFFIX } } } }
  const byUser = { user: { email: { contains: DOMAIN_SUFFIX } } }
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
  const joiner = await makeUser('joiner')
  const outsider = await makeUser('outsider', OTHER_DOMAIN)
  const ws = await prisma.workspace.create({
    data: { name: `IdentityWS-${RUN}`, createdById: owner.id },
  })
  await prisma.workspaceMember.create({
    data: { workspaceId: ws.id, userId: owner.id, role: 'OWNER' },
  })
  await prisma.workspaceLimit.create({
    data: { workspaceId: ws.id, maxMembers: 5, maxFileBytes: 0, syncedAt: new Date() },
  })
  return { owner, joiner, outsider, ws }
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

/** A fake DNS TXT resolver serving fixed records (each record = chunk array). */
function txt(...records: string[][]): ResolveTxtFn {
  return async () => records
}

describe('identity service', () => {
  beforeEach(cleanFixtures)
  afterAll(async () => {
    await cleanFixtures()
    await prisma.$disconnect()
  })

  it('resolves from the domain container', () => {
    expect(domain.identity).toBeDefined()
    expect(typeof domain.identity.addAllowedDomain).toBe('function')
    expect(typeof domain.identity.checkDomainVerification).toBe('function')
    expect(typeof domain.identity.joinViaDomain).toBe('function')
  })

  it('generateVerificationToken returns 32 base62 chars, unique per call', () => {
    const a = generateVerificationToken()
    const b = generateVerificationToken()
    expect(a).toMatch(/^[A-Za-z0-9]{32}$/)
    expect(b).toMatch(/^[A-Za-z0-9]{32}$/)
    expect(a).not.toBe(b)
  })

  // ── allowed domains ──────────────────────────────────────────────────────────

  describe('addAllowedDomain', () => {
    it('rejects public email providers with PUBLIC_EMAIL_DOMAIN (incl. mixed case)', async () => {
      const { ws, owner } = await seed()
      expect(PUBLIC_EMAIL_DOMAINS).toHaveLength(10)
      for (const pub of ['gmail.com', 'yandex.ru', 'rambler.ru', '@Gmail.COM']) {
        await expectDomainError(
          domain.identity.addAllowedDomain({ workspaceId: ws.id, actorId: owner.id, domain: pub }),
          IDENTITY_ERROR_CODES.PUBLIC_EMAIL_DOMAIN,
          400,
        )
      }
      expect(await prisma.allowedEmailDomain.findMany({ where: { workspaceId: ws.id } })).toEqual(
        [],
      )
      expect(await auditRows(ws.id, IDENTITY_AUDIT_ACTIONS.allowedAdded)).toHaveLength(0)
    })

    it('normalizes the domain: strips a leading @, lowercases, trims; audits', async () => {
      const { ws, owner } = await seed()
      const dto = await domain.identity.addAllowedDomain({
        workspaceId: ws.id,
        actorId: owner.id,
        domain: '  @Corp.COM ',
      })
      expect(dto.domain).toBe('corp.com')
      expect(dto.workspaceId).toBe(ws.id)
      expect(dto.addedById).toBe(owner.id)

      const rows = await prisma.allowedEmailDomain.findMany({ where: { workspaceId: ws.id } })
      expect(rows).toHaveLength(1)
      expect(rows[0]!.domain).toBe('corp.com')

      const audits = await auditRows(ws.id, IDENTITY_AUDIT_ACTIONS.allowedAdded)
      expect(audits).toHaveLength(1)
      expect(audits[0]!.actorId).toBe(owner.id)
      expect(audits[0]!.metadata).toMatchObject({ domain: 'corp.com' })
    })

    it('rejects malformed domains with INVALID_DOMAIN', async () => {
      const { ws, owner } = await seed()
      for (const bad of ['not a domain', 'corp', '-bad.com', 'corp..com', 'corp.com-', '']) {
        await expectDomainError(
          domain.identity.addAllowedDomain({ workspaceId: ws.id, actorId: owner.id, domain: bad }),
          IDENTITY_ERROR_CODES.INVALID_DOMAIN,
          400,
        )
      }
      expect(await prisma.allowedEmailDomain.findMany({ where: { workspaceId: ws.id } })).toEqual(
        [],
      )
    })

    it('is idempotent on duplicates: returns the existing row, no second audit', async () => {
      const { ws, owner } = await seed()
      const first = await domain.identity.addAllowedDomain({
        workspaceId: ws.id,
        actorId: owner.id,
        domain: CORP_DOMAIN,
      })
      const second = await domain.identity.addAllowedDomain({
        workspaceId: ws.id,
        actorId: owner.id,
        domain: `@${CORP_DOMAIN.toUpperCase()}`,
      })
      expect(second.id).toBe(first.id)
      expect(
        await prisma.allowedEmailDomain.findMany({ where: { workspaceId: ws.id } }),
      ).toHaveLength(1)
      expect(await auditRows(ws.id, IDENTITY_AUDIT_ACTIONS.allowedAdded)).toHaveLength(1)
    })
  })

  describe('listAllowedDomains / removeAllowedDomain', () => {
    it('lists the workspace domains sorted by name', async () => {
      const { ws, owner } = await seed()
      await domain.identity.addAllowedDomain({
        workspaceId: ws.id,
        actorId: owner.id,
        domain: OTHER_DOMAIN,
      })
      await domain.identity.addAllowedDomain({
        workspaceId: ws.id,
        actorId: owner.id,
        domain: CORP_DOMAIN,
      })
      const list = await domain.identity.listAllowedDomains(ws.id)
      expect(list.map((d) => d.domain)).toEqual([CORP_DOMAIN, OTHER_DOMAIN].sort())
    })

    it('removes by id and audits; unknown or foreign-workspace id ⇒ DOMAIN_NOT_FOUND', async () => {
      const { ws, owner } = await seed()
      const dto = await domain.identity.addAllowedDomain({
        workspaceId: ws.id,
        actorId: owner.id,
        domain: CORP_DOMAIN,
      })
      await domain.identity.removeAllowedDomain({
        workspaceId: ws.id,
        actorId: owner.id,
        domainId: dto.id,
      })
      expect(await prisma.allowedEmailDomain.findMany({ where: { workspaceId: ws.id } })).toEqual(
        [],
      )
      const audits = await auditRows(ws.id, IDENTITY_AUDIT_ACTIONS.allowedRemoved)
      expect(audits).toHaveLength(1)
      expect(audits[0]!.metadata).toMatchObject({ domain: CORP_DOMAIN })

      await expectDomainError(
        domain.identity.removeAllowedDomain({
          workspaceId: ws.id,
          actorId: owner.id,
          domainId: randomUUID(),
        }),
        IDENTITY_ERROR_CODES.DOMAIN_NOT_FOUND,
        404,
      )
      // a row of another workspace is invisible here
      const other = await prisma.workspace.create({
        data: { name: `IdentityWS2-${RUN}`, createdById: owner.id },
      })
      const foreign = await domain.identity.addAllowedDomain({
        workspaceId: other.id,
        actorId: owner.id,
        domain: CORP_DOMAIN,
      })
      await expectDomainError(
        domain.identity.removeAllowedDomain({
          workspaceId: ws.id,
          actorId: owner.id,
          domainId: foreign.id,
        }),
        IDENTITY_ERROR_CODES.DOMAIN_NOT_FOUND,
        404,
      )
    })
  })

  // ── verification lifecycle ───────────────────────────────────────────────────

  describe('startDomainVerification', () => {
    it('creates a PENDING row with a 32-char base62 token, ~7d TTL, audits', async () => {
      const { ws, owner } = await seed()
      const dto = await domain.identity.startDomainVerification({
        workspaceId: ws.id,
        actorId: owner.id,
        domain: `@${CORP_DOMAIN.toUpperCase()}`,
      })
      expect(dto.domain).toBe(CORP_DOMAIN)
      expect(dto.status).toBe('PENDING')
      expect(dto.verificationToken).toMatch(/^[A-Za-z0-9]{32}$/)
      expect(dto.verifiedAt).toBeNull()

      const ttlMs = dto.tokenExpiresAt.getTime() - Date.now()
      expect(ttlMs).toBeGreaterThan(6.9 * 24 * 3600 * 1000)
      expect(ttlMs).toBeLessThan(7.1 * 24 * 3600 * 1000)

      const audits = await auditRows(ws.id, IDENTITY_AUDIT_ACTIONS.verificationStarted)
      expect(audits).toHaveLength(1)
      expect(audits[0]!.metadata).toMatchObject({ domain: CORP_DOMAIN })
    })

    it('restarting an existing PENDING/EXPIRED row rotates the token in place', async () => {
      const { ws, owner } = await seed()
      const input = { workspaceId: ws.id, actorId: owner.id, domain: CORP_DOMAIN }
      const first = await domain.identity.startDomainVerification(input)
      await prisma.verifiedEmailDomain.update({
        where: { id: first.id },
        data: { status: 'EXPIRED', tokenExpiresAt: new Date(Date.now() - 1000) },
      })
      const second = await domain.identity.startDomainVerification(input)
      expect(second.id).toBe(first.id)
      expect(second.status).toBe('PENDING')
      expect(second.verificationToken).not.toBe(first.verificationToken)
      expect(
        await prisma.verifiedEmailDomain.findMany({ where: { workspaceId: ws.id } }),
      ).toHaveLength(1)
    })

    it('rejects public and malformed domains', async () => {
      const { ws, owner } = await seed()
      await expectDomainError(
        domain.identity.startDomainVerification({
          workspaceId: ws.id,
          actorId: owner.id,
          domain: 'mail.ru',
        }),
        IDENTITY_ERROR_CODES.PUBLIC_EMAIL_DOMAIN,
        400,
      )
      await expectDomainError(
        domain.identity.startDomainVerification({
          workspaceId: ws.id,
          actorId: owner.id,
          domain: 'nope',
        }),
        IDENTITY_ERROR_CODES.INVALID_DOMAIN,
        400,
      )
    })
  })

  describe('checkDomainVerification', () => {
    it('verifies on an exact token match among multiple TXT records (chunked), audits', async () => {
      const { ws, owner } = await seed()
      const started = await domain.identity.startDomainVerification({
        workspaceId: ws.id,
        actorId: owner.id,
        domain: CORP_DOMAIN,
      })
      const resolver = txt(
        ['v=spf1 include:_spf.example.com ~all'],
        // the matching record arrives split into chunks — node's resolveTxt shape
        [VERIFICATION_TXT_PREFIX, started.verificationToken],
        ['unrelated=value'],
      )
      const dto = await domain.identity.checkDomainVerification(
        { workspaceId: ws.id, actorId: owner.id, domainId: started.id },
        resolver,
      )
      expect(dto.status).toBe('VERIFIED')
      expect(dto.verifiedAt).not.toBeNull()
      expect(dto.lastCheckedAt).not.toBeNull()
      expect(dto.lastCheckError).toBeNull()

      const row = await prisma.verifiedEmailDomain.findUniqueOrThrow({ where: { id: started.id } })
      expect(row.status).toBe('VERIFIED')
      const audits = await auditRows(ws.id, IDENTITY_AUDIT_ACTIONS.verified)
      expect(audits).toHaveLength(1)
      expect(audits[0]!.metadata).toMatchObject({ domain: CORP_DOMAIN })
    })

    it('stays PENDING with lastCheckError when no record matches, audits the failure', async () => {
      const { ws, owner } = await seed()
      const started = await domain.identity.startDomainVerification({
        workspaceId: ws.id,
        actorId: owner.id,
        domain: CORP_DOMAIN,
      })
      const dto = await domain.identity.checkDomainVerification(
        { workspaceId: ws.id, actorId: owner.id, domainId: started.id },
        txt(['v=spf1 ~all'], [`${VERIFICATION_TXT_PREFIX}wrong-token`]),
      )
      expect(dto.status).toBe('PENDING')
      expect(dto.lastCheckedAt).not.toBeNull()
      expect(dto.lastCheckError).toBeTruthy()
      expect(await auditRows(ws.id, IDENTITY_AUDIT_ACTIONS.verificationFailed)).toHaveLength(1)
    })

    it('treats a resolver error (e.g. ENOTFOUND) as a failed check with the error recorded', async () => {
      const { ws, owner } = await seed()
      const started = await domain.identity.startDomainVerification({
        workspaceId: ws.id,
        actorId: owner.id,
        domain: CORP_DOMAIN,
      })
      const resolver: ResolveTxtFn = async () => {
        throw new Error(`queryTxt ENOTFOUND ${CORP_DOMAIN}`)
      }
      const dto = await domain.identity.checkDomainVerification(
        { workspaceId: ws.id, actorId: owner.id, domainId: started.id },
        resolver,
      )
      expect(dto.status).toBe('PENDING')
      expect(dto.lastCheckError).toContain('ENOTFOUND')
    })

    it('a token past its TTL marks the row EXPIRED, audits, and throws TOKEN_EXPIRED', async () => {
      const { ws, owner } = await seed()
      const started = await domain.identity.startDomainVerification({
        workspaceId: ws.id,
        actorId: owner.id,
        domain: CORP_DOMAIN,
      })
      await prisma.verifiedEmailDomain.update({
        where: { id: started.id },
        data: { tokenExpiresAt: new Date(Date.now() - 1000) },
      })
      await expectDomainError(
        domain.identity.checkDomainVerification(
          { workspaceId: ws.id, actorId: owner.id, domainId: started.id },
          txt([VERIFICATION_TXT_PREFIX + started.verificationToken]),
        ),
        IDENTITY_ERROR_CODES.TOKEN_EXPIRED,
        412,
      )
      const row = await prisma.verifiedEmailDomain.findUniqueOrThrow({ where: { id: started.id } })
      expect(row.status).toBe('EXPIRED')
      expect(await auditRows(ws.id, IDENTITY_AUDIT_ACTIONS.verificationFailed)).toHaveLength(1)
    })

    it('rotation invalidates the old token: old TXT no longer verifies, the new one does', async () => {
      const { ws, owner } = await seed()
      const started = await domain.identity.startDomainVerification({
        workspaceId: ws.id,
        actorId: owner.id,
        domain: CORP_DOMAIN,
      })
      const rotated = await domain.identity.rotateVerificationToken({
        workspaceId: ws.id,
        actorId: owner.id,
        domainId: started.id,
      })
      expect(rotated.id).toBe(started.id)
      expect(rotated.verificationToken).not.toBe(started.verificationToken)
      expect(await auditRows(ws.id, IDENTITY_AUDIT_ACTIONS.tokenRotated)).toHaveLength(1)

      // DNS still serves the OLD token ⇒ no match
      const stale = await domain.identity.checkDomainVerification(
        { workspaceId: ws.id, actorId: owner.id, domainId: started.id },
        txt([VERIFICATION_TXT_PREFIX + started.verificationToken]),
      )
      expect(stale.status).toBe('PENDING')
      expect(stale.lastCheckError).toBeTruthy()

      // DNS serves the NEW token ⇒ verified
      const fresh = await domain.identity.checkDomainVerification(
        { workspaceId: ws.id, actorId: owner.id, domainId: started.id },
        txt([VERIFICATION_TXT_PREFIX + rotated.verificationToken]),
      )
      expect(fresh.status).toBe('VERIFIED')
    })

    it('a VERIFIED domain is durable: re-check is a no-op that never hits DNS', async () => {
      const { ws, owner } = await seed()
      const started = await domain.identity.startDomainVerification({
        workspaceId: ws.id,
        actorId: owner.id,
        domain: CORP_DOMAIN,
      })
      await domain.identity.checkDomainVerification(
        { workspaceId: ws.id, actorId: owner.id, domainId: started.id },
        txt([VERIFICATION_TXT_PREFIX + started.verificationToken]),
      )
      const neverResolve: ResolveTxtFn = async () => {
        throw new Error('resolver must not be called for a VERIFIED domain')
      }
      const dto = await domain.identity.checkDomainVerification(
        { workspaceId: ws.id, actorId: owner.id, domainId: started.id },
        neverResolve,
      )
      expect(dto.status).toBe('VERIFIED')
      // still exactly one `domain.verified` audit row — the no-op writes nothing
      expect(await auditRows(ws.id, IDENTITY_AUDIT_ACTIONS.verified)).toHaveLength(1)
    })

    it('throws DOMAIN_NOT_FOUND for an unknown id', async () => {
      const { ws, owner } = await seed()
      await expectDomainError(
        domain.identity.checkDomainVerification(
          { workspaceId: ws.id, actorId: owner.id, domainId: randomUUID() },
          txt(['x']),
        ),
        IDENTITY_ERROR_CODES.DOMAIN_NOT_FOUND,
        404,
      )
    })
  })

  describe('removeVerifiedDomain', () => {
    it('disables bound ACTIVE providers in the same tx, audits each + the removal', async () => {
      const { ws, owner } = await seed()
      const started = await domain.identity.startDomainVerification({
        workspaceId: ws.id,
        actorId: owner.id,
        domain: CORP_DOMAIN,
      })
      await domain.identity.checkDomainVerification(
        { workspaceId: ws.id, actorId: owner.id, domainId: started.id },
        txt([VERIFICATION_TXT_PREFIX + started.verificationToken]),
      )
      // provider fixtures inserted directly (Task 4 owns the provider lifecycle)
      const boundActive = await prisma.workspaceAuthProvider.create({
        data: {
          workspaceId: ws.id,
          type: 'OIDC',
          name: 'Okta',
          status: 'ACTIVE',
          domainId: started.id,
          createdById: owner.id,
        },
      })
      const boundDisabled = await prisma.workspaceAuthProvider.create({
        data: {
          workspaceId: ws.id,
          type: 'OIDC',
          name: 'Old IdP',
          status: 'DISABLED',
          domainId: started.id,
          createdById: owner.id,
        },
      })
      const unboundActive = await prisma.workspaceAuthProvider.create({
        data: {
          workspaceId: ws.id,
          type: 'OAUTH',
          name: 'Unbound',
          status: 'ACTIVE',
          createdById: owner.id,
        },
      })

      const result = await domain.identity.removeVerifiedDomain({
        workspaceId: ws.id,
        actorId: owner.id,
        domainId: started.id,
      })
      expect(result).toEqual({ id: started.id, providersDisabled: 1 })

      expect(await prisma.verifiedEmailDomain.findUnique({ where: { id: started.id } })).toBeNull()
      const bound = await prisma.workspaceAuthProvider.findUniqueOrThrow({
        where: { id: boundActive.id },
      })
      expect(bound.status).toBe('DISABLED')
      expect(bound.domainId).toBeNull() // FK SetNull on domain deletion
      expect(
        (await prisma.workspaceAuthProvider.findUniqueOrThrow({ where: { id: unboundActive.id } }))
          .status,
      ).toBe('ACTIVE')
      expect(
        (await prisma.workspaceAuthProvider.findUniqueOrThrow({ where: { id: boundDisabled.id } }))
          .status,
      ).toBe('DISABLED')

      const disabledAudits = await auditRows(ws.id, IDENTITY_AUDIT_ACTIONS.providerDisabled)
      expect(disabledAudits).toHaveLength(1)
      expect(disabledAudits[0]!.metadata).toMatchObject({
        providerId: boundActive.id,
        reason: 'domain_removed',
      })
      const removalAudits = await auditRows(ws.id, IDENTITY_AUDIT_ACTIONS.verifiedRemoved)
      expect(removalAudits).toHaveLength(1)
      expect(removalAudits[0]!.metadata).toMatchObject({
        domain: CORP_DOMAIN,
        providersDisabled: 1,
      })
    })

    it('throws DOMAIN_NOT_FOUND for an unknown id', async () => {
      const { ws, owner } = await seed()
      await expectDomainError(
        domain.identity.removeVerifiedDomain({
          workspaceId: ws.id,
          actorId: owner.id,
          domainId: randomUUID(),
        }),
        IDENTITY_ERROR_CODES.DOMAIN_NOT_FOUND,
        404,
      )
    })
  })

  // ── auto-join ────────────────────────────────────────────────────────────────

  describe('listDomainJoinableWorkspaces', () => {
    it('lists matching workspaces with name + seatAvailable, excluding members and blocked users', async () => {
      const { ws, owner, joiner, outsider } = await seed()
      await domain.identity.addAllowedDomain({
        workspaceId: ws.id,
        actorId: owner.id,
        domain: CORP_DOMAIN,
      })

      // the matching non-member sees the workspace
      const visible = await domain.identity.listDomainJoinableWorkspaces(joiner.id, joiner.email)
      expect(visible).toEqual([
        { workspaceId: ws.id, name: `IdentityWS-${RUN}`, seatAvailable: true },
      ])

      // a user with a different email domain sees nothing
      expect(
        await domain.identity.listDomainJoinableWorkspaces(outsider.id, outsider.email),
      ).toEqual([])

      // an existing member is excluded
      expect(await domain.identity.listDomainJoinableWorkspaces(owner.id, owner.email)).toEqual([])

      // a blocked user is excluded
      await prisma.workspaceBlockedUser.create({
        data: { workspaceId: ws.id, userId: joiner.id, blockedById: owner.id },
      })
      expect(await domain.identity.listDomainJoinableWorkspaces(joiner.id, joiner.email)).toEqual(
        [],
      )
    })

    it('reports seatAvailable=false for a full workspace (still listed)', async () => {
      const { ws, owner, joiner } = await seed()
      await domain.identity.addAllowedDomain({
        workspaceId: ws.id,
        actorId: owner.id,
        domain: CORP_DOMAIN,
      })
      await prisma.workspaceLimit.update({
        where: { workspaceId: ws.id },
        data: { maxMembers: 1 }, // the owner holds the only seat
      })
      const list = await domain.identity.listDomainJoinableWorkspaces(joiner.id, joiner.email)
      expect(list).toEqual([
        { workspaceId: ws.id, name: `IdentityWS-${RUN}`, seatAvailable: false },
      ])
    })
  })

  describe('joinViaDomain', () => {
    it('creates an EDITOR member, ensures the personal collection, audits domain.joined', async () => {
      const { ws, owner, joiner } = await seed()
      await domain.identity.addAllowedDomain({
        workspaceId: ws.id,
        actorId: owner.id,
        domain: CORP_DOMAIN,
      })
      const result = await domain.identity.joinViaDomain({
        workspaceId: ws.id,
        userId: joiner.id,
        userEmail: joiner.email.toUpperCase(), // the email-domain match is case-insensitive
      })
      expect(result).toEqual({ workspaceId: ws.id, role: RoleType.EDITOR, alreadyMember: false })

      const member = await prisma.workspaceMember.findUniqueOrThrow({
        where: { workspaceId_userId: { workspaceId: ws.id, userId: joiner.id } },
      })
      expect(member.role).toBe(RoleType.EDITOR)

      const personal = await prisma.collection.findFirst({
        where: { workspaceId: ws.id, kind: 'PERSONAL', ownerId: joiner.id },
      })
      expect(personal).not.toBeNull()

      const audits = await auditRows(ws.id, IDENTITY_AUDIT_ACTIONS.joined)
      expect(audits).toHaveLength(1)
      expect(audits[0]!.actorId).toBe(joiner.id)
      expect(audits[0]!.targetUserId).toBe(joiner.id)
      expect(audits[0]!.metadata).toMatchObject({ domain: CORP_DOMAIN, role: 'EDITOR' })
    })

    it('throws DOMAIN_NOT_FOUND when no allowed domain matches the email, creates nothing', async () => {
      const { ws, owner, joiner, outsider } = await seed()
      // workspace without ANY allowed domain
      await expectDomainError(
        domain.identity.joinViaDomain({
          workspaceId: ws.id,
          userId: joiner.id,
          userEmail: joiner.email,
        }),
        IDENTITY_ERROR_CODES.DOMAIN_NOT_FOUND,
        404,
      )
      // allowed domain exists but the user's email domain differs
      await domain.identity.addAllowedDomain({
        workspaceId: ws.id,
        actorId: owner.id,
        domain: CORP_DOMAIN,
      })
      await expectDomainError(
        domain.identity.joinViaDomain({
          workspaceId: ws.id,
          userId: outsider.id,
          userEmail: outsider.email,
        }),
        IDENTITY_ERROR_CODES.DOMAIN_NOT_FOUND,
        404,
      )
      for (const userId of [joiner.id, outsider.id]) {
        expect(
          await prisma.workspaceMember.findUnique({
            where: { workspaceId_userId: { workspaceId: ws.id, userId } },
          }),
        ).toBeNull()
      }
      expect(await auditRows(ws.id, IDENTITY_AUDIT_ACTIONS.joined)).toHaveLength(0)
    })

    it('refuses a blocked user with USER_BLOCKED and creates nothing', async () => {
      const { ws, owner, joiner } = await seed()
      await domain.identity.addAllowedDomain({
        workspaceId: ws.id,
        actorId: owner.id,
        domain: CORP_DOMAIN,
      })
      await prisma.workspaceBlockedUser.create({
        data: { workspaceId: ws.id, userId: joiner.id, blockedById: owner.id },
      })
      await expectDomainError(
        domain.identity.joinViaDomain({
          workspaceId: ws.id,
          userId: joiner.id,
          userEmail: joiner.email,
        }),
        IDENTITY_ERROR_CODES.USER_BLOCKED,
        403,
      )
      expect(
        await prisma.workspaceMember.findUnique({
          where: { workspaceId_userId: { workspaceId: ws.id, userId: joiner.id } },
        }),
      ).toBeNull()
    })

    it('the in-tx seat re-check fires atomically: SEAT_LIMIT_REACHED and nothing is written', async () => {
      const { ws, owner, joiner } = await seed()
      await domain.identity.addAllowedDomain({
        workspaceId: ws.id,
        actorId: owner.id,
        domain: CORP_DOMAIN,
      })
      await prisma.workspaceLimit.update({
        where: { workspaceId: ws.id },
        data: { maxMembers: 1 }, // the owner holds the only seat
      })
      await expectDomainError(
        domain.identity.joinViaDomain({
          workspaceId: ws.id,
          userId: joiner.id,
          userEmail: joiner.email,
        }),
        IDENTITY_ERROR_CODES.SEAT_LIMIT_REACHED,
        403,
      )
      // the rolled-back transaction left no trace: no member, no audit
      expect(
        await prisma.workspaceMember.findUnique({
          where: { workspaceId_userId: { workspaceId: ws.id, userId: joiner.id } },
        }),
      ).toBeNull()
      expect(await auditRows(ws.id, IDENTITY_AUDIT_ACTIONS.joined)).toHaveLength(0)
    })

    it('alreadyMember is a no-op WITH audit parity: existing role returned, audit row written', async () => {
      const { ws, owner, joiner } = await seed()
      await domain.identity.addAllowedDomain({
        workspaceId: ws.id,
        actorId: owner.id,
        domain: CORP_DOMAIN,
      })
      await prisma.workspaceMember.create({
        data: { workspaceId: ws.id, userId: joiner.id, role: 'VIEWER' },
      })
      const result = await domain.identity.joinViaDomain({
        workspaceId: ws.id,
        userId: joiner.id,
        userEmail: joiner.email,
      })
      expect(result).toEqual({ workspaceId: ws.id, role: RoleType.VIEWER, alreadyMember: true })

      const members = await prisma.workspaceMember.findMany({
        where: { workspaceId: ws.id, userId: joiner.id },
      })
      expect(members).toHaveLength(1)
      expect(members[0]!.role).toBe(RoleType.VIEWER)

      const audits = await auditRows(ws.id, IDENTITY_AUDIT_ACTIONS.joined)
      expect(audits).toHaveLength(1)
      expect(audits[0]!.metadata).toMatchObject({ alreadyMember: true })
    })

    it('two concurrent joins converge: one member row, one normal + one alreadyMember result', async () => {
      const { ws, owner } = await seed()
      await domain.identity.addAllowedDomain({
        workspaceId: ws.id,
        actorId: owner.id,
        domain: CORP_DOMAIN,
      })
      // A few rounds to shake out interleaving luck (the joinViaLink template):
      // the loser of the workspace_members unique race must converge on the
      // alreadyMember path instead of surfacing P2002.
      for (let i = 0; i < 3; i++) {
        const user = await makeUser(`race${i}`)
        const input = { workspaceId: ws.id, userId: user.id, userEmail: user.email }
        // Promise.all rejects on any rejection — resolution itself asserts no 500
        const results = await Promise.all([
          domain.identity.joinViaDomain(input),
          domain.identity.joinViaDomain(input),
        ])

        expect(results.filter((r) => !r.alreadyMember)).toHaveLength(1)
        expect(results.filter((r) => r.alreadyMember)).toHaveLength(1)
        for (const r of results) {
          expect(r.workspaceId).toBe(ws.id)
          expect(r.role).toBe(RoleType.EDITOR)
        }

        const members = await prisma.workspaceMember.findMany({
          where: { workspaceId: ws.id, userId: user.id },
        })
        expect(members).toHaveLength(1)
        expect(members[0]!.role).toBe(RoleType.EDITOR)
      }
    })
  })
})
