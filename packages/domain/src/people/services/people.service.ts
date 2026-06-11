import { addDays } from 'date-fns'

import type { BillingService } from '../../billing/index.ts'
import type { CollectionService } from '../../collections/index.ts'
import type { UnitOfWork } from '../../shared/unit-of-work.ts'
import {
  INVITABLE_MEMBER_ROLES,
  INVITE_TTL_DAYS,
  PEOPLE_AUDIT_ACTIONS,
  normalizeEmail,
  peopleError,
} from '../dto/people.dto.ts'
import type {
  AcceptInvitationInput,
  AcceptInvitationResult,
  CreateInvitationInput,
  CreateInvitationResult,
  InvitationState,
  InvitePreview,
  PeopleAuditEntry,
  RevokeInvitationInput,
  WorkspaceInvitationDto,
} from '../dto/people.dto.ts'
import { generateInviteToken, hashInviteToken } from '../invite-token.ts'
import type { InvitationRow, PeopleRepository } from '../repositories/people.repository.ts'

function computeState(row: InvitationRow, now: Date): InvitationState {
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

    // Authoritative seat re-check — the workspace may have filled up since invite-time.
    await this.assertSeatAvailable(invite.workspaceId)

    await this.uow.transaction(async () => {
      await this.repo.createMember(invite.workspaceId, input.userId, invite.role)
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
    return { workspaceId: invite.workspaceId, role: invite.role, alreadyMember: false }
  }

  /** Billing-impact data for the invite form, resolved through the billing chain. */
  async getInvitePreview(workspaceId: string): Promise<InvitePreview> {
    const [features, currentMembers, limit, periodEnd] = await Promise.all([
      this.billing.getWorkspaceFeatures(workspaceId),
      this.repo.countMembers(workspaceId),
      this.repo.findWorkspaceLimit(workspaceId),
      this.repo.findOwnerPeriodEnd(workspaceId),
    ])
    return {
      currentMembers,
      maxMembers: limit?.maxMembers ?? features.maxMembersPerWorkspace,
      planSlug: features.slug,
      isPaid: features.isPaid,
      periodEnd,
    }
  }

  // ── internals ────────────────────────────────────────────────────────────────

  /** Same semantics as the legacy `workspace.inviteMember` check: no limit row ⇒ unlimited. */
  private async assertSeatAvailable(workspaceId: string): Promise<void> {
    const [memberCount, limit] = await Promise.all([
      this.repo.countMembers(workspaceId),
      this.repo.findWorkspaceLimit(workspaceId),
    ])
    if (limit && memberCount >= limit.maxMembers) throw peopleError('SEAT_LIMIT_REACHED')
  }
}
