import { addDays } from 'date-fns'

import type { RoleType } from '@repo/db'

import type { BillingService } from '../../billing/index.ts'
import type { CollectionService } from '../../collections/index.ts'
import { notFound } from '../../shared/errors.ts'
import type { UnitOfWork } from '../../shared/unit-of-work.ts'
import {
  INVITABLE_MEMBER_ROLES,
  INVITE_LINK_ROLES,
  INVITE_TTL_DAYS,
  PEOPLE_AUDIT_ACTIONS,
  normalizeEmail,
  peopleError,
} from '../dto/people.dto.ts'
import type {
  AcceptGuestInviteInput,
  AcceptGuestInviteResult,
  AcceptInvitationInput,
  AcceptInvitationResult,
  BlockUserInput,
  ChangeMemberRoleInput,
  ConvertGuestToMemberInput,
  CreateGuestInviteInput,
  CreateGuestInviteResult,
  CreateInvitationInput,
  CreateInvitationResult,
  EnableInviteLinkInput,
  GuestInviteDto,
  InvitationState,
  InviteLinkActorInput,
  InviteLinkDto,
  InviteLinkWithToken,
  InvitePreview,
  JoinViaLinkInput,
  JoinViaLinkResult,
  ListGuestsResult,
  PeopleAuditEntry,
  RemoveMemberInput,
  RevokeGuestAccessInput,
  RevokeGuestAccessResult,
  RevokeGuestInviteInput,
  RevokeInvitationInput,
  UnblockUserInput,
  WorkspaceInvitationDto,
} from '../dto/people.dto.ts'
import { generateInviteToken, hashInviteToken } from '../invite-token.ts'
import type {
  GuestInviteRow,
  InvitationRow,
  InviteLinkRow,
  PeopleRepository,
} from '../repositories/people.repository.ts'
// Barrel import (domain-module-isolation-compliant); the reverse edge is
// cycle-free because security.module deep-imports only people.tokens.ts.
import { securityError } from '../../security/index.ts'
// Barrel import; cycle-free — the seats module never imports people.
import { seatPriceForPeriod } from '../../seats/index.ts'

function computeState(row: { expiresAt: Date }, now: Date): InvitationState {
  return row.expiresAt > now ? 'PENDING' : 'EXPIRED'
}

function toInvitationDto(row: InvitationRow, now = new Date()): WorkspaceInvitationDto {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    email: row.email,
    role: row.role,
    inviterId: row.inviterId,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    state: computeState(row, now),
  }
}

function toGuestInviteDto(row: GuestInviteRow, now = new Date()): GuestInviteDto {
  return {
    id: row.id,
    pageId: row.pageId,
    workspaceId: row.workspaceId,
    email: row.email,
    role: row.role,
    inviterId: row.inviterId,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    state: computeState(row, now),
  }
}

// The repository select already strips token material; this pins the DTO shape.
function toInviteLinkDto(row: InviteLinkRow): InviteLinkDto {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    role: row.role,
    enabled: row.enabled,
    rotatedAt: row.rotatedAt,
    createdAt: row.createdAt,
  }
}

export class PeopleService {
  private readonly repo: PeopleRepository
  private readonly uow: UnitOfWork
  private readonly collections: CollectionService
  private readonly billing: BillingService

  constructor(
    repo: PeopleRepository,
    uow: UnitOfWork,
    collections: CollectionService,
    billing: BillingService,
  ) {
    this.repo = repo
    this.uow = uow
    this.collections = collections
    this.billing = billing
  }

  // ── block helpers (the single chokepoint other surfaces delegate to) ────────

  async isWorkspaceBlocked(workspaceId: string, userId: string): Promise<boolean> {
    return (await this.repo.findBlock(workspaceId, userId)) !== null
  }

  async assertNotBlocked(workspaceId: string, userId: string): Promise<void> {
    if (await this.isWorkspaceBlocked(workspaceId, userId)) throw peopleError('USER_BLOCKED')
  }

  // ── audit ────────────────────────────────────────────────────────────────────

  /**
   * Writes one `WorkspaceAuditLog` row on the active client — when called inside
   * `uow.transaction()` (as every mutation below does) it lands in the same tx.
   */
  async writeAudit(entry: PeopleAuditEntry): Promise<void> {
    await this.repo.writeAudit(entry)
  }

  // ── member invitations ───────────────────────────────────────────────────────

  async createInvitation(input: CreateInvitationInput): Promise<CreateInvitationResult> {
    const email = normalizeEmail(input.email)
    if (!INVITABLE_MEMBER_ROLES.includes(input.role)) throw peopleError('FORBIDDEN_ROLE')

    const member = await this.repo.findMemberByEmail(input.workspaceId, email)
    if (member) throw peopleError('ALREADY_MEMBER')

    // Friendly pre-check; the authoritative re-check runs at acceptance.
    await this.assertSeatAvailable(input.workspaceId)

    const token = generateInviteToken()
    const tokenHash = hashInviteToken(token)
    const expiresAt = addDays(new Date(), INVITE_TTL_DAYS)

    const row = await this.uow.transaction(async () => {
      // Re-inviting an active email refreshes the row (token, TTL, role) — the
      // partial unique index forbids a duplicate active invite anyway.
      const active = await this.repo.findActiveInvitation(input.workspaceId, email)
      const saved = active
        ? await this.repo.refreshInvitation(active.id, {
            tokenHash,
            expiresAt,
            role: input.role,
            inviterId: input.actorId,
          })
        : await this.repo.createInvitation({
            workspaceId: input.workspaceId,
            email,
            role: input.role,
            tokenHash,
            inviterId: input.actorId,
            expiresAt,
          })
      await this.repo.writeAudit({
        workspaceId: input.workspaceId,
        actorId: input.actorId,
        action: PEOPLE_AUDIT_ACTIONS.memberInvited,
        targetEmail: email,
        metadata: { invitationId: saved.id, role: input.role, refreshed: active !== null },
      })
      return saved
    })

    return { invitation: toInvitationDto(row), token }
  }

  async revokeInvitation(input: RevokeInvitationInput): Promise<{ id: string }> {
    const invite = await this.repo.findInvitationById(input.workspaceId, input.invitationId)
    if (!invite || invite.acceptedAt) throw peopleError('INVITE_NOT_FOUND')
    if (invite.revokedAt) return { id: invite.id } // idempotent — no second audit row

    await this.uow.transaction(async () => {
      await this.repo.markInvitationRevoked(invite.id, input.actorId)
      await this.repo.writeAudit({
        workspaceId: input.workspaceId,
        actorId: input.actorId,
        action: PEOPLE_AUDIT_ACTIONS.inviteRevoked,
        targetEmail: invite.email,
        metadata: { invitationId: invite.id },
      })
    })
    return { id: invite.id }
  }

  /** Open (neither accepted nor revoked) invitations — PENDING first, newest first within a state. */
  async listInvitations(workspaceId: string): Promise<WorkspaceInvitationDto[]> {
    const now = new Date()
    const rows = await this.repo.listOpenInvitations(workspaceId)
    return rows
      .map((row) => toInvitationDto(row, now))
      .sort((a, b) => {
        if (a.state === b.state) return 0
        return a.state === 'PENDING' ? -1 : 1
      })
  }

  async acceptInvitation(input: AcceptInvitationInput): Promise<AcceptInvitationResult> {
    const invite = await this.repo.findInvitationByTokenHash(hashInviteToken(input.token))
    if (!invite) throw peopleError('INVITE_NOT_FOUND')
    if (invite.revokedAt) throw peopleError('INVITE_REVOKED')
    if (invite.acceptedAt) {
      // Double-accept by the same user is an idempotent success; for anyone
      // else the token is burned — indistinguishable from unknown.
      if (invite.acceptedById === input.userId) {
        return { workspaceId: invite.workspaceId, role: invite.role, alreadyMember: true }
      }
      throw peopleError('INVITE_NOT_FOUND')
    }
    if (invite.expiresAt <= new Date()) throw peopleError('INVITE_EXPIRED')
    if (normalizeEmail(input.userEmail) !== invite.email) {
      throw peopleError('INVITE_EMAIL_MISMATCH')
    }
    await this.assertNotBlocked(invite.workspaceId, input.userId)

    const existing = await this.repo.findMembership(invite.workspaceId, input.userId)
    if (existing) {
      // Already holds a seat via another path — close the invite, keep the seat.
      await this.uow.transaction(async () => {
        await this.repo.markInvitationAccepted(invite.id, input.userId)
        await this.repo.writeAudit({
          workspaceId: invite.workspaceId,
          actorId: input.userId,
          action: PEOPLE_AUDIT_ACTIONS.inviteAccepted,
          targetUserId: input.userId,
          targetEmail: invite.email,
          metadata: { invitationId: invite.id, alreadyMember: true },
        })
      })
      return { workspaceId: invite.workspaceId, role: existing.role, alreadyMember: true }
    }

    try {
      await this.uow.transaction(async () => {
        // Authoritative seat re-check — the workspace may have filled up since
        // invite-time. Running it inside the tx narrows (does not eliminate)
        // the count-then-insert TOCTOU under READ COMMITTED.
        await this.assertSeatAvailable(invite.workspaceId)
        await this.repo.createMember(invite.workspaceId, input.userId, invite.role)
        await this.repo.recordMemberEvent({
          workspaceId: invite.workspaceId,
          type: 'MEMBER_JOINED',
          targetUserId: input.userId,
          actorId: input.userId,
        })
        await this.collections.ensurePersonalCollection(invite.workspaceId, input.userId)
        await this.repo.markInvitationAccepted(invite.id, input.userId)
        await this.repo.writeAudit({
          workspaceId: invite.workspaceId,
          actorId: input.userId,
          action: PEOPLE_AUDIT_ACTIONS.inviteAccepted,
          targetUserId: input.userId,
          targetEmail: invite.email,
          metadata: { invitationId: invite.id, role: invite.role },
        })
      })
    } catch (e: unknown) {
      if ((e as { code?: string })?.code !== 'P2002') throw e
      // A concurrent accept won the workspace_members unique race after our
      // membership pre-check. Postgres aborts the losing tx (no savepoints), so
      // converge on the alreadyMember path in a fresh transaction.
      const member = await this.repo.findMembership(invite.workspaceId, input.userId)
      if (!member) throw e
      await this.uow.transaction(async () => {
        await this.repo.markInvitationAccepted(invite.id, input.userId)
        await this.repo.writeAudit({
          workspaceId: invite.workspaceId,
          actorId: input.userId,
          action: PEOPLE_AUDIT_ACTIONS.inviteAccepted,
          targetUserId: input.userId,
          targetEmail: invite.email,
          metadata: { invitationId: invite.id, alreadyMember: true },
        })
      })
      return { workspaceId: invite.workspaceId, role: member.role, alreadyMember: true }
    }
    return { workspaceId: invite.workspaceId, role: invite.role, alreadyMember: false }
  }

  /**
   * Billing-impact data for the invite form, resolved through the billing
   * chain. `maxMembers` is the CAPACITY (included limit + purchased seats) —
   * the same number the join paths enforce, so the form never under-reports.
   * `seatPriceKopecks` mirrors the seats module's `canPurchase` gate (8D spec
   * §5): the owner's current-period price when the plan sells seats AND the
   * subscription is strictly ACTIVE — null means «nothing to buy».
   */
  async getInvitePreview(workspaceId: string): Promise<InvitePreview> {
    const [features, currentMembers, limit, ownerSub] = await Promise.all([
      this.billing.getWorkspaceFeatures(workspaceId),
      this.repo.countMembers(workspaceId),
      this.repo.findSeatCapacity(workspaceId),
      this.repo.findOwnerBillingSummary(workspaceId),
    ])
    const maxMembers = limit?.capacity ?? features.maxMembersPerWorkspace
    const seatPrice =
      ownerSub?.status === 'ACTIVE' ? seatPriceForPeriod(ownerSub.plan, ownerSub.billingPeriod) : 0
    return {
      currentMembers,
      maxMembers,
      planSlug: features.slug,
      isPaid: features.isPaid,
      periodEnd: ownerSub?.currentPeriodEnd ?? null,
      atCapacity: currentMembers >= maxMembers,
      seatPriceKopecks: seatPrice > 0 ? seatPrice : null,
    }
  }

  // ── workspace join link ──────────────────────────────────────────────────────

  async getInviteLink(workspaceId: string): Promise<InviteLinkDto | null> {
    const row = await this.repo.findInviteLink(workspaceId)
    return row ? toInviteLinkDto(row) : null
  }

  /** Create-or-enable. Every enable issues a FRESH token; the plaintext is surfaced exactly once. */
  async enableInviteLink(input: EnableInviteLinkInput): Promise<InviteLinkWithToken> {
    if (!INVITE_LINK_ROLES.includes(input.role)) throw peopleError('FORBIDDEN_ROLE')
    const token = generateInviteToken()
    const row = await this.uow.transaction(async () => {
      const saved = await this.repo.enableInviteLink(input.workspaceId, {
        role: input.role,
        tokenHash: hashInviteToken(token),
        createdById: input.actorId,
      })
      await this.repo.writeAudit({
        workspaceId: input.workspaceId,
        actorId: input.actorId,
        action: PEOPLE_AUDIT_ACTIONS.inviteLinkEnabled,
        metadata: { role: input.role },
      })
      return saved
    })
    return { link: toInviteLinkDto(row), token }
  }

  /** Idempotent: a missing link returns null, an already-disabled one returns without a new audit row. */
  async disableInviteLink(input: InviteLinkActorInput): Promise<InviteLinkDto | null> {
    const existing = await this.repo.findInviteLink(input.workspaceId)
    if (!existing) return null
    if (!existing.enabled) return toInviteLinkDto(existing)
    const row = await this.uow.transaction(async () => {
      const saved = await this.repo.disableInviteLink(input.workspaceId)
      await this.repo.writeAudit({
        workspaceId: input.workspaceId,
        actorId: input.actorId,
        action: PEOPLE_AUDIT_ACTIONS.inviteLinkDisabled,
      })
      return saved
    })
    return toInviteLinkDto(row)
  }

  async rotateInviteLink(input: InviteLinkActorInput): Promise<InviteLinkWithToken> {
    const existing = await this.repo.findInviteLink(input.workspaceId)
    if (!existing) throw peopleError('INVITE_NOT_FOUND')
    const token = generateInviteToken()
    const row = await this.uow.transaction(async () => {
      const saved = await this.repo.rotateInviteLinkToken(input.workspaceId, hashInviteToken(token))
      await this.repo.writeAudit({
        workspaceId: input.workspaceId,
        actorId: input.actorId,
        action: PEOPLE_AUDIT_ACTIONS.inviteLinkRotated,
      })
      return saved
    })
    return { link: toInviteLinkDto(row), token }
  }

  async joinViaLink(input: JoinViaLinkInput): Promise<JoinViaLinkResult> {
    const link = await this.repo.findInviteLinkByTokenHash(hashInviteToken(input.token))
    // Disabled and unknown are uniformly INVITE_NOT_FOUND — no enable-state oracle.
    if (!link || !link.enabled) throw peopleError('INVITE_NOT_FOUND')
    await this.assertNotBlocked(link.workspaceId, input.userId)

    const existing = await this.repo.findMembership(link.workspaceId, input.userId)
    if (existing) {
      return this.joinViaLinkAlreadyMember(link.workspaceId, input.userId, existing.role)
    }

    try {
      await this.uow.transaction(async () => {
        // Authoritative seat re-check inside the tx — narrows (does not
        // eliminate) the count-then-insert TOCTOU under READ COMMITTED.
        await this.assertSeatAvailable(link.workspaceId)
        await this.repo.createMember(link.workspaceId, input.userId, link.role)
        await this.repo.recordMemberEvent({
          workspaceId: link.workspaceId,
          type: 'MEMBER_JOINED',
          targetUserId: input.userId,
          actorId: input.userId,
        })
        await this.collections.ensurePersonalCollection(link.workspaceId, input.userId)
        await this.repo.writeAudit({
          workspaceId: link.workspaceId,
          actorId: input.userId,
          action: PEOPLE_AUDIT_ACTIONS.inviteLinkJoined,
          targetUserId: input.userId,
          metadata: { role: link.role },
        })
      })
    } catch (e: unknown) {
      if ((e as { code?: string })?.code !== 'P2002') throw e
      // A concurrent join won the workspace_members unique race after our
      // membership pre-check — converge on the alreadyMember path.
      const member = await this.repo.findMembership(link.workspaceId, input.userId)
      if (!member) throw e
      return this.joinViaLinkAlreadyMember(link.workspaceId, input.userId, member.role)
    }
    return { workspaceId: link.workspaceId, role: link.role, alreadyMember: false }
  }

  /** Audit parity with `acceptInvitation`: the alreadyMember no-op still leaves a trace. */
  private async joinViaLinkAlreadyMember(
    workspaceId: string,
    userId: string,
    role: RoleType,
  ): Promise<JoinViaLinkResult> {
    await this.uow.transaction(async () => {
      await this.repo.writeAudit({
        workspaceId,
        actorId: userId,
        action: PEOPLE_AUDIT_ACTIONS.inviteLinkJoined,
        targetUserId: userId,
        metadata: { alreadyMember: true },
      })
    })
    return { workspaceId, role, alreadyMember: true }
  }

  // ── guest invites ────────────────────────────────────────────────────────────

  /**
   * 8C security policy: `disableGuestInvites` closes this chokepoint for every
   * caller (pageShare.inviteGuest and future surfaces). `bypassPolicy: true`
   * is reserved for the OWNER-approved guest-request path
   * (`SecurityService.approveGuestInviteRequest`) — the only sanctioned bypass,
   * audited on the approval side (spec §7.4). The default (no policy row /
   * flag off) changes nothing.
   */
  async createGuestInvite(
    input: CreateGuestInviteInput,
    options?: { bypassPolicy?: boolean },
  ): Promise<CreateGuestInviteResult> {
    const email = normalizeEmail(input.email)
    const page = await this.repo.findPage(input.pageId)
    if (!page || page.deletedAt) throw notFound('Страница не найдена')

    if (!options?.bypassPolicy) {
      const policy = await this.repo.findSecurityPolicy(page.workspaceId)
      if (policy?.disableGuestInvites) throw securityError('POLICY_GUEST_INVITES_DISABLED')
    }

    const token = generateInviteToken()
    const tokenHash = hashInviteToken(token)
    const expiresAt = addDays(new Date(), INVITE_TTL_DAYS)

    const row = await this.uow.transaction(async () => {
      // Re-inviting an active (page, email) pair refreshes the row — the partial
      // unique index forbids a duplicate active invite anyway.
      const active = await this.repo.findActiveGuestInvite(input.pageId, email)
      const saved = active
        ? await this.repo.refreshGuestInvite(active.id, {
            tokenHash,
            expiresAt,
            role: input.role,
            inviterId: input.actorId,
          })
        : await this.repo.createGuestInvite({
            pageId: input.pageId,
            workspaceId: page.workspaceId,
            email,
            role: input.role,
            tokenHash,
            inviterId: input.actorId,
            expiresAt,
          })
      await this.repo.writeAudit({
        workspaceId: page.workspaceId,
        actorId: input.actorId,
        action: PEOPLE_AUDIT_ACTIONS.guestInvited,
        targetEmail: email,
        metadata: {
          inviteId: saved.id,
          pageId: input.pageId,
          role: input.role,
          refreshed: active !== null,
        },
      })
      return saved
    })

    return { invite: toGuestInviteDto(row), token }
  }

  async revokeGuestInvite(input: RevokeGuestInviteInput): Promise<{ id: string }> {
    const invite = await this.repo.findGuestInviteById(input.workspaceId, input.inviteId)
    if (!invite || invite.acceptedAt) throw peopleError('INVITE_NOT_FOUND')
    if (invite.revokedAt) return { id: invite.id } // idempotent — no second audit row

    await this.uow.transaction(async () => {
      await this.repo.markGuestInviteRevoked(invite.id, input.actorId)
      await this.repo.writeAudit({
        workspaceId: input.workspaceId,
        actorId: input.actorId,
        action: PEOPLE_AUDIT_ACTIONS.guestInviteRevoked,
        targetEmail: invite.email,
        metadata: { inviteId: invite.id, pageId: invite.pageId },
      })
    })
    return { id: invite.id }
  }

  async acceptGuestInvite(input: AcceptGuestInviteInput): Promise<AcceptGuestInviteResult> {
    const invite = await this.repo.findGuestInviteByTokenHash(hashInviteToken(input.token))
    if (!invite) throw peopleError('INVITE_NOT_FOUND')
    if (invite.revokedAt) throw peopleError('INVITE_REVOKED')
    if (invite.acceptedAt) {
      // Double-accept by the same user is an idempotent success (the grant was
      // already written); for anyone else the token is burned.
      if (invite.acceptedById === input.userId) {
        const member = await this.repo.findMembership(invite.workspaceId, input.userId)
        return {
          pageId: invite.pageId,
          workspaceId: invite.workspaceId,
          role: invite.role,
          alreadyMember: member !== null,
        }
      }
      throw peopleError('INVITE_NOT_FOUND')
    }
    if (invite.expiresAt <= new Date()) throw peopleError('INVITE_EXPIRED')
    if (normalizeEmail(input.userEmail) !== invite.email) {
      throw peopleError('INVITE_EMAIL_MISMATCH')
    }
    await this.assertNotBlocked(invite.workspaceId, input.userId)

    const page = await this.repo.findPage(invite.pageId)
    if (!page || page.deletedAt) throw peopleError('INVITE_NOT_FOUND')

    const member = await this.repo.findMembership(invite.workspaceId, input.userId)
    if (member) {
      // Members see the page through their membership — close the invite, write no grant.
      await this.uow.transaction(async () => {
        await this.repo.markGuestInviteAccepted(invite.id, input.userId)
        await this.repo.writeAudit({
          workspaceId: invite.workspaceId,
          actorId: input.userId,
          action: PEOPLE_AUDIT_ACTIONS.guestJoined,
          targetUserId: input.userId,
          targetEmail: invite.email,
          metadata: { inviteId: invite.id, pageId: invite.pageId, alreadyMember: true },
        })
      })
      return {
        pageId: invite.pageId,
        workspaceId: invite.workspaceId,
        role: invite.role,
        alreadyMember: true,
      }
    }

    const grantTx = () =>
      this.uow.transaction(async () => {
        const share = await this.repo.ensureShareForPage(invite.pageId, invite.inviterId)
        await this.repo.upsertShareGrant(share.id, input.userId, invite.role)
        await this.repo.markGuestInviteAccepted(invite.id, input.userId)
        await this.repo.writeAudit({
          workspaceId: invite.workspaceId,
          actorId: input.userId,
          action: PEOPLE_AUDIT_ACTIONS.guestJoined,
          targetUserId: input.userId,
          targetEmail: invite.email,
          metadata: { inviteId: invite.id, pageId: invite.pageId, role: invite.role },
        })
      })
    try {
      await grantTx()
    } catch (e: unknown) {
      if ((e as { code?: string })?.code !== 'P2002') throw e
      // A concurrent accept won the pageShare unique race (Prisma emulates the
      // upsert here, and Postgres aborts the losing tx without savepoints). One
      // clean re-run converges: every statement now finds the winner's rows.
      await grantTx()
    }
    return {
      pageId: invite.pageId,
      workspaceId: invite.workspaceId,
      role: invite.role,
      alreadyMember: false,
    }
  }

  // ── guests listing / management ──────────────────────────────────────────────

  /** Spec §4: grant-holders without a member row (with counts) + open guest invites. */
  async listGuests(workspaceId: string): Promise<ListGuestsResult> {
    const now = new Date()
    const [grants, invites] = await Promise.all([
      this.repo.listGuestGrants(workspaceId),
      this.repo.listOpenGuestInvites(workspaceId),
    ])
    const byUser = new Map<string, { name: string | null; email: string; grantCount: number }>()
    for (const grant of grants) {
      const entry = byUser.get(grant.userId)
      if (entry) entry.grantCount += 1
      else byUser.set(grant.userId, { name: grant.name, email: grant.email, grantCount: 1 })
    }
    const guests = [...byUser.entries()]
      .map(([userId, g]) => ({ userId, ...g }))
      .sort((a, b) => a.email.localeCompare(b.email))
    return { guests, invites: invites.map((row) => toGuestInviteDto(row, now)) }
  }

  async revokeGuestAccess(input: RevokeGuestAccessInput): Promise<RevokeGuestAccessResult> {
    const user = await this.repo.findUserById(input.userId)
    if (!user) throw notFound('Пользователь не найден')

    return this.uow.transaction(async () => {
      const grantsRemoved = await this.repo.deleteGuestGrants(input.workspaceId, input.userId)
      const invitesRevoked = await this.repo.revokeOpenGuestInvitesByEmail(
        input.workspaceId,
        normalizeEmail(user.email),
        input.actorId,
      )
      await this.repo.writeAudit({
        workspaceId: input.workspaceId,
        actorId: input.actorId,
        action: PEOPLE_AUDIT_ACTIONS.guestAccessRevoked,
        targetUserId: input.userId,
        targetEmail: user.email,
        metadata: { grantsRemoved, invitesRevoked },
      })
      return { grantsRemoved, invitesRevoked }
    })
  }

  /** Grants are kept — they're harmless noise for a member and survive a later removal. */
  async convertGuestToMember(
    input: ConvertGuestToMemberInput,
  ): Promise<{ workspaceId: string; role: RoleType }> {
    if (!INVITABLE_MEMBER_ROLES.includes(input.role)) throw peopleError('FORBIDDEN_ROLE')
    await this.assertNotBlocked(input.workspaceId, input.userId)
    const existing = await this.repo.findMembership(input.workspaceId, input.userId)
    if (existing) throw peopleError('ALREADY_MEMBER')
    const user = await this.repo.findUserById(input.userId)
    if (!user) throw notFound('Пользователь не найден')

    try {
      await this.uow.transaction(async () => {
        // Authoritative seat re-check inside the tx — narrows (does not
        // eliminate) the count-then-insert TOCTOU under READ COMMITTED.
        await this.assertSeatAvailable(input.workspaceId)
        await this.repo.createMember(input.workspaceId, input.userId, input.role)
        // MEMBER_JOINED only after the member row exists, same tx (spec §7.1)
        await this.repo.recordMemberEvent({
          workspaceId: input.workspaceId,
          type: 'MEMBER_JOINED',
          targetUserId: input.userId,
          actorId: input.actorId,
        })
        await this.collections.ensurePersonalCollection(input.workspaceId, input.userId)
        await this.repo.writeAudit({
          workspaceId: input.workspaceId,
          actorId: input.actorId,
          action: PEOPLE_AUDIT_ACTIONS.guestConvertedToMember,
          targetUserId: input.userId,
          targetEmail: user.email,
          metadata: { role: input.role },
        })
      })
    } catch (e: unknown) {
      if ((e as { code?: string })?.code !== 'P2002') throw e
      // A concurrent convert won the workspace_members unique race after our
      // membership pre-check. Already-a-member is the desired end state, so
      // converge on it (acceptInvitation parity: audit with alreadyMember,
      // return the existing membership's role) in a fresh transaction.
      const member = await this.repo.findMembership(input.workspaceId, input.userId)
      if (!member) throw e
      await this.uow.transaction(async () => {
        await this.repo.writeAudit({
          workspaceId: input.workspaceId,
          actorId: input.actorId,
          action: PEOPLE_AUDIT_ACTIONS.guestConvertedToMember,
          targetUserId: input.userId,
          targetEmail: user.email,
          metadata: { alreadyMember: true },
        })
      })
      return { workspaceId: input.workspaceId, role: member.role }
    }
    return { workspaceId: input.workspaceId, role: input.role }
  }

  // ── role matrix / removal ────────────────────────────────────────────────────

  async changeMemberRole(
    input: ChangeMemberRoleInput,
  ): Promise<{ userId: string; role: RoleType }> {
    const target = await this.repo.findMembership(input.workspaceId, input.userId)
    if (!target) throw notFound('Участник не найден')
    // The frozen legacy GUEST role is never a role-change target (spec §1).
    if (input.role === 'GUEST') throw peopleError('FORBIDDEN_ROLE')
    // ADMIN (membership admin) can never touch OWNER rows nor grant OWNER.
    if (input.actorRole !== 'OWNER' && (target.role === 'OWNER' || input.role === 'OWNER')) {
      throw peopleError('FORBIDDEN_ROLE')
    }
    if (target.role === 'OWNER' && input.role !== 'OWNER') {
      if ((await this.repo.countOwners(input.workspaceId)) <= 1) throw peopleError('LAST_OWNER')
    }

    await this.uow.transaction(async () => {
      await this.repo.updateMemberRole(input.workspaceId, input.userId, input.role)
      await this.repo.writeAudit({
        workspaceId: input.workspaceId,
        actorId: input.actorId,
        action: PEOPLE_AUDIT_ACTIONS.memberRoleChanged,
        targetUserId: input.userId,
        metadata: { from: target.role, to: input.role },
      })
    })
    return { userId: input.userId, role: input.role }
  }

  /** Removal keeps PageShareUser grants — an ex-member with grants becomes a guest. */
  async removeMember(input: RemoveMemberInput): Promise<{ userId: string }> {
    const target = await this.repo.findMembership(input.workspaceId, input.userId)
    if (!target) throw notFound('Участник не найден')
    if (input.actorRole !== 'OWNER' && target.role === 'OWNER') throw peopleError('FORBIDDEN_ROLE')
    if (target.role === 'OWNER' && (await this.repo.countOwners(input.workspaceId)) <= 1) {
      throw peopleError('LAST_OWNER')
    }
    const user = await this.repo.findUserById(input.userId)

    await this.uow.transaction(async () => {
      await this.repo.deleteMember(input.workspaceId, input.userId)
      // removal frees the seat — the only event that does (spec §7.2)
      await this.repo.recordMemberEvent({
        workspaceId: input.workspaceId,
        type: 'MEMBER_REMOVED',
        targetUserId: input.userId,
        actorId: input.actorId,
      })
      await this.repo.writeAudit({
        workspaceId: input.workspaceId,
        actorId: input.actorId,
        action: PEOPLE_AUDIT_ACTIONS.memberRemoved,
        targetUserId: input.userId,
        targetEmail: user?.email,
        metadata: { role: target.role },
      })
    })
    return { userId: input.userId }
  }

  // ── blocking ─────────────────────────────────────────────────────────────────

  async blockUser(input: BlockUserInput): Promise<{ blocked: boolean }> {
    if (input.userId === input.actorId) throw peopleError('FORBIDDEN_ROLE') // never block yourself
    const target = await this.repo.findMembership(input.workspaceId, input.userId)
    if (target?.role === 'OWNER') throw peopleError('FORBIDDEN_ROLE') // owners are unblockable
    if (await this.isWorkspaceBlocked(input.workspaceId, input.userId)) {
      return { blocked: true } // idempotent re-block — no second audit row
    }
    const user = await this.repo.findUserById(input.userId)
    if (!user) throw notFound('Пользователь не найден')

    await this.uow.transaction(async () => {
      await this.repo.createBlock(input.workspaceId, input.userId, input.actorId, input.reason)
      await this.repo.writeAudit({
        workspaceId: input.workspaceId,
        actorId: input.actorId,
        action: PEOPLE_AUDIT_ACTIONS.userBlocked,
        targetUserId: input.userId,
        targetEmail: user.email,
        metadata: input.reason ? { reason: input.reason } : undefined,
      })
    })
    return { blocked: true }
  }

  async unblockUser(input: UnblockUserInput): Promise<{ blocked: boolean }> {
    if (!(await this.isWorkspaceBlocked(input.workspaceId, input.userId))) {
      return { blocked: false } // idempotent — nothing to lift, no audit row
    }
    const user = await this.repo.findUserById(input.userId)
    await this.uow.transaction(async () => {
      await this.repo.deleteBlock(input.workspaceId, input.userId)
      await this.repo.writeAudit({
        workspaceId: input.workspaceId,
        actorId: input.actorId,
        action: PEOPLE_AUDIT_ACTIONS.userUnblocked,
        targetUserId: input.userId,
        targetEmail: user?.email,
      })
    })
    return { blocked: false }
  }

  // ── internals ────────────────────────────────────────────────────────────────

  /**
   * Same semantics as the legacy `workspace.inviteMember` check: no limit row ⇒
   * unlimited. The limit source is the CAPACITY (included + purchased seats,
   * 8D spec §3). Reads run sequentially (not Promise.all) so the check is safe
   * on the single connection of an interactive transaction — the join paths
   * call this inside `uow.transaction()` as their authoritative re-check.
   */
  private async assertSeatAvailable(workspaceId: string): Promise<void> {
    const limit = await this.repo.findSeatCapacity(workspaceId)
    if (!limit) return
    const memberCount = await this.repo.countMembers(workspaceId)
    if (memberCount >= limit.capacity) throw peopleError('SEAT_LIMIT_REACHED')
  }
}
