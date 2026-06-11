import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import type { PrismaClient } from '@repo/db'
import { hashInviteToken } from '@repo/domain'
import { sendMailNow } from '@repo/mail'
import { notify } from '@repo/notifications'

import { router, protectedProcedure, publicProcedure } from '../trpc'
import { assertNotBlocked, assertRole, type WorkspaceRole } from '../helpers/membership'
import { getWorkspaceFeatures, requireWritableWorkspace } from '../helpers/plan'
import { mapDomain } from '../helpers/map-domain'
import { domain as domainSvc } from '../domain'

const LOG_PAGE_SIZE = 30

const memberRoleSchema = z.enum(['ADMIN', 'EDITOR', 'COMMENTER', 'VIEWER'])
// OWNER is a valid TARGET role for an OWNER actor (the domain matrix decides);
// the frozen legacy GUEST role is rejected by the domain.
const roleChangeSchema = z.enum(['OWNER', 'ADMIN', 'EDITOR', 'COMMENTER', 'VIEWER'])
const linkRoleSchema = z.enum(['EDITOR', 'COMMENTER', 'VIEWER'])
const tokenSchema = z.string().min(8).max(64)

const cursorSchema = z
  .object({
    createdAt: z.union([z.date(), z.string()]).transform((v) => new Date(v)),
    id: z.string().uuid(),
  })
  .optional()

const MANAGERS: WorkspaceRole[] = ['OWNER', 'ADMIN']

type Ctx = { prisma: PrismaClient; user: { id: string } }

/** Every managed people procedure: OWNER/ADMIN member, block-aware (assertRole). */
function assertPeopleManager(ctx: Ctx, workspaceId: string) {
  return assertRole(ctx, workspaceId, MANAGERS)
}

/**
 * Workspace-plan gate for member invites — the legacy `workspace.inviteMember`
 * «платные тарифы» rule, applied to the WORKSPACE owner's plan (the modern
 * feature-gate shape) so an ADMIN of a paid workspace can invite too.
 */
async function assertPaidWorkspace(workspaceId: string) {
  const features = await getWorkspaceFeatures(workspaceId)
  if (!features.isPaid) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Это действие доступно на платных тарифах',
    })
  }
}

/** `a***@domain` — recognizable to the invitee, useless to an enumerator. */
function maskEmail(email: string): string {
  const at = email.indexOf('@')
  if (at <= 0) return '***'
  return `${email[0]}***${email.slice(at)}`
}

type NamedUser = { firstName?: string | null; lastName?: string | null; name?: string | null }

/** Public-safe display name — NEVER falls back to the email (PII on public endpoints). */
function displayName(user: NamedUser | null): string | null {
  if (!user) return null
  const full = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim()
  return full || user.name || null
}

function actorName(user: { email: string } & NamedUser): string {
  return displayName(user) ?? user.email
}

type ResolveState = 'PENDING' | 'EXPIRED' | 'REVOKED' | 'ACCEPTED' | 'NOT_FOUND'

// Uniform unknown-token answer: one constant shape, no metadata at all.
const RESOLVE_NOT_FOUND = {
  state: 'NOT_FOUND' as const,
  workspaceName: null,
  inviterName: null,
  role: null,
  maskedEmail: null,
}

function inviteState(row: {
  revokedAt: Date | null
  acceptedAt: Date | null
  expiresAt: Date
}): Exclude<ResolveState, 'NOT_FOUND'> {
  if (row.revokedAt) return 'REVOKED'
  if (row.acceptedAt) return 'ACCEPTED'
  if (row.expiresAt <= new Date()) return 'EXPIRED'
  return 'PENDING'
}

// Public resolve endpoints select the inviter's NAME fields only — the email
// must never reach an unauthenticated caller.
const inviterNameSelect = { firstName: true, lastName: true, name: true } as const

function keysetWhere(cursor: { createdAt: Date; id: string } | undefined) {
  return cursor
    ? {
        OR: [
          { createdAt: { lt: cursor.createdAt } },
          { createdAt: cursor.createdAt, id: { lt: cursor.id } },
        ],
      }
    : {}
}

function nextCursorFor<T extends { createdAt: Date; id: string }>(items: T[]) {
  const last = items[items.length - 1]
  return items.length === LOG_PAGE_SIZE && last ? { createdAt: last.createdAt, id: last.id } : null
}

export const peopleRouter = router({
  // ── managed: member invitations ───────────────────────────────────────────

  invite: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
        email: z.string().email().max(255),
        role: memberRoleSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertPeopleManager(ctx, input.workspaceId)
      await requireWritableWorkspace(input.workspaceId)
      await assertPaidWorkspace(input.workspaceId)

      const { invitation, token } = await mapDomain(() =>
        domainSvc.people.createInvitation({
          workspaceId: input.workspaceId,
          actorId: ctx.user.id,
          email: input.email,
          role: input.role,
        }),
      )

      const workspace = await ctx.prisma.workspace.findUniqueOrThrow({
        where: { id: input.workspaceId },
        select: { name: true },
      })
      const link = `${ctx.returnUrlBase}/invite/${token}`
      const inviterName = actorName(ctx.user)

      // The EMAIL goes to the address regardless; the in-app WORKSPACE_INVITE
      // fires only for a registered user. Both arms answer identically, so the
      // response is no registered-email oracle.
      const registered = await ctx.prisma.user.findFirst({
        where: { email: { equals: invitation.email, mode: 'insensitive' } },
        select: { id: true, firstName: true },
      })
      if (registered) {
        // COLLABORATION event: in-app row + an email delivery via the worker.
        await notify.workspaceInvite(ctx.prisma, {
          userId: registered.id,
          workspaceId: input.workspaceId,
          actorId: ctx.user.id,
          firstName: registered.firstName ?? undefined,
          inviterName,
          workspaceName: workspace.name,
          link,
        })
      } else {
        await sendMailNow({
          kind: 'invitation',
          to: invitation.email,
          data: { inviterName, workspaceName: workspace.name, link },
        })
      }

      const preview = await mapDomain(() => domainSvc.people.getInvitePreview(input.workspaceId))
      // NEVER the token — the plaintext exists only inside the email link.
      return { invitation, preview }
    }),

  listInvitations: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertPeopleManager(ctx, input.workspaceId)
      return mapDomain(() => domainSvc.people.listInvitations(input.workspaceId))
    }),

  revokeInvitation: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid(), invitationId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertPeopleManager(ctx, input.workspaceId)
      return mapDomain(() =>
        domainSvc.people.revokeInvitation({
          workspaceId: input.workspaceId,
          actorId: ctx.user.id,
          invitationId: input.invitationId,
        }),
      )
    }),

  invitePreview: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertPeopleManager(ctx, input.workspaceId)
      return mapDomain(() => domainSvc.people.getInvitePreview(input.workspaceId))
    }),

  // ── managed: workspace join link ──────────────────────────────────────────

  inviteLink: router({
    get: protectedProcedure
      .input(z.object({ workspaceId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        await assertPeopleManager(ctx, input.workspaceId)
        return mapDomain(() => domainSvc.people.getInviteLink(input.workspaceId))
      }),

    enable: protectedProcedure
      .input(z.object({ workspaceId: z.string().uuid(), role: linkRoleSchema }))
      .mutation(async ({ ctx, input }) => {
        await assertPeopleManager(ctx, input.workspaceId)
        await requireWritableWorkspace(input.workspaceId)
        const { link, token } = await mapDomain(() =>
          domainSvc.people.enableInviteLink({
            workspaceId: input.workspaceId,
            actorId: ctx.user.id,
            role: input.role,
          }),
        )
        // The ONLY places the plaintext crosses the wire: enable and rotate.
        return { link, token, url: `${ctx.returnUrlBase}/join/${token}` }
      }),

    disable: protectedProcedure
      .input(z.object({ workspaceId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        await assertPeopleManager(ctx, input.workspaceId)
        return mapDomain(() =>
          domainSvc.people.disableInviteLink({
            workspaceId: input.workspaceId,
            actorId: ctx.user.id,
          }),
        )
      }),

    rotate: protectedProcedure
      .input(z.object({ workspaceId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        await assertPeopleManager(ctx, input.workspaceId)
        const { link, token } = await mapDomain(() =>
          domainSvc.people.rotateInviteLink({
            workspaceId: input.workspaceId,
            actorId: ctx.user.id,
          }),
        )
        return { link, token, url: `${ctx.returnUrlBase}/join/${token}` }
      }),
  }),

  // ── managed: guests ───────────────────────────────────────────────────────

  listGuests: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertPeopleManager(ctx, input.workspaceId)
      return mapDomain(() => domainSvc.people.listGuests(input.workspaceId))
    }),

  convertGuestToMember: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
        userId: z.string().uuid(),
        role: memberRoleSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertPeopleManager(ctx, input.workspaceId)
      await requireWritableWorkspace(input.workspaceId)
      return mapDomain(() =>
        domainSvc.people.convertGuestToMember({
          workspaceId: input.workspaceId,
          actorId: ctx.user.id,
          userId: input.userId,
          role: input.role,
        }),
      )
    }),

  revokeGuestAccess: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid(), userId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertPeopleManager(ctx, input.workspaceId)
      return mapDomain(() =>
        domainSvc.people.revokeGuestAccess({
          workspaceId: input.workspaceId,
          actorId: ctx.user.id,
          userId: input.userId,
        }),
      )
    }),

  // ── guest self-service ────────────────────────────────────────────────────

  // The sidebar «Доступные мне» list: the caller's DIRECT grants in the
  // workspace (children are reachable by navigating into a granted page).
  // Any signed-in user may ask — non-guests simply get their direct grants
  // (members' sidebars never render the section). Blocked ⇒ FORBIDDEN: a
  // blocked user's grants are dead (people spec §7.1).
  myGrantedPages: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertNotBlocked(ctx, input.workspaceId)
      const grants = await ctx.prisma.pageShareUser.findMany({
        where: {
          userId: ctx.user.id,
          pageShare: {
            page: {
              workspaceId: input.workspaceId,
              deletedAt: null,
              archivedAt: null,
              isTemplate: null,
            },
          },
        },
        select: {
          role: true,
          createdAt: true,
          pageShare: { select: { page: { select: { id: true, title: true, icon: true } } } },
        },
        orderBy: { createdAt: 'asc' },
      })
      return grants.map((g) => ({
        id: g.pageShare.page.id,
        title: g.pageShare.page.title,
        icon: g.pageShare.page.icon,
        role: g.role,
      }))
    }),

  // ── managed: roles, removal, blocking ─────────────────────────────────────

  changeMemberRole: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
        userId: z.string().uuid(),
        role: roleChangeSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const actor = await assertPeopleManager(ctx, input.workspaceId)
      await requireWritableWorkspace(input.workspaceId)
      const result = await mapDomain(() =>
        domainSvc.people.changeMemberRole({
          workspaceId: input.workspaceId,
          actorId: ctx.user.id,
          actorRole: actor.role,
          userId: input.userId,
          role: input.role,
        }),
      )
      // Parity with the legacy workspace.updateMemberRole notification.
      const workspace = await ctx.prisma.workspace.findUniqueOrThrow({
        where: { id: input.workspaceId },
        select: { name: true },
      })
      await notify.roleChanged(ctx.prisma, {
        userId: input.userId,
        workspaceId: input.workspaceId,
        actorId: ctx.user.id,
        newRole: result.role,
        workspaceName: workspace.name,
        actorName: actorName(ctx.user),
      })
      return result
    }),

  removeMember: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid(), userId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const actor = await assertPeopleManager(ctx, input.workspaceId)
      await requireWritableWorkspace(input.workspaceId)
      return mapDomain(() =>
        domainSvc.people.removeMember({
          workspaceId: input.workspaceId,
          actorId: ctx.user.id,
          actorRole: actor.role,
          userId: input.userId,
        }),
      )
    }),

  block: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
        userId: z.string().uuid(),
        reason: z.string().max(255).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const actor = await assertPeopleManager(ctx, input.workspaceId)
      return mapDomain(() =>
        domainSvc.people.blockUser({
          workspaceId: input.workspaceId,
          actorId: ctx.user.id,
          actorRole: actor.role,
          userId: input.userId,
          reason: input.reason,
        }),
      )
    }),

  unblock: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid(), userId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertPeopleManager(ctx, input.workspaceId)
      return mapDomain(() =>
        domainSvc.people.unblockUser({
          workspaceId: input.workspaceId,
          actorId: ctx.user.id,
          userId: input.userId,
        }),
      )
    }),

  // ── managed: audit log (OWNER only) ───────────────────────────────────────

  auditLog: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid(), cursor: cursorSchema }))
    .query(async ({ ctx, input }) => {
      await assertRole(ctx, input.workspaceId, ['OWNER'])
      const rows = await ctx.prisma.workspaceAuditLog.findMany({
        where: { workspaceId: input.workspaceId, ...keysetWhere(input.cursor) },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: LOG_PAGE_SIZE,
      })
      // actorId/targetUserId are scalar-only on the model — join names manually.
      const userIds = [
        ...new Set(
          rows.flatMap((r) => [r.actorId, r.targetUserId]).filter((id): id is string => !!id),
        ),
      ]
      const users = userIds.length
        ? await ctx.prisma.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, firstName: true, lastName: true, name: true, email: true },
          })
        : []
      const nameOf = new Map(users.map((u) => [u.id, displayName(u) ?? u.email]))
      const items = rows.map((r) => ({
        id: r.id,
        action: r.action,
        actorId: r.actorId,
        actorName: r.actorId ? (nameOf.get(r.actorId) ?? null) : null,
        targetUserId: r.targetUserId,
        targetName: r.targetUserId ? (nameOf.get(r.targetUserId) ?? null) : null,
        targetEmail: r.targetEmail,
        metadata: r.metadata,
        createdAt: r.createdAt,
      }))
      return { items, nextCursor: nextCursorFor(items) }
    }),

  // ── public token resolution (safe metadata only, uniform NOT_FOUND) ───────

  resolveInvite: publicProcedure
    .input(z.object({ token: tokenSchema }))
    .query(async ({ ctx, input }) => {
      const invite = await ctx.prisma.workspaceInvitation.findUnique({
        where: { tokenHash: hashInviteToken(input.token) },
        select: {
          email: true,
          role: true,
          expiresAt: true,
          acceptedAt: true,
          revokedAt: true,
          inviterId: true,
          workspace: { select: { name: true } },
        },
      })
      if (!invite) return RESOLVE_NOT_FOUND
      const inviter = await ctx.prisma.user.findUnique({
        where: { id: invite.inviterId },
        select: inviterNameSelect,
      })
      return {
        state: inviteState(invite),
        workspaceName: invite.workspace.name,
        inviterName: displayName(inviter),
        role: invite.role,
        maskedEmail: maskEmail(invite.email),
      }
    }),

  resolveJoinLink: publicProcedure
    .input(z.object({ token: tokenSchema }))
    .query(async ({ ctx, input }) => {
      const link = await ctx.prisma.workspaceInviteLink.findUnique({
        where: { tokenHash: hashInviteToken(input.token) },
        select: { enabled: true, role: true, workspace: { select: { name: true } } },
      })
      // Disabled == unknown — no enable-state oracle (spec §7.2).
      if (!link || !link.enabled) {
        return { state: 'NOT_FOUND' as const, workspaceName: null, role: null }
      }
      return { state: 'PENDING' as const, workspaceName: link.workspace.name, role: link.role }
    }),

  resolveGuestInvite: publicProcedure
    .input(z.object({ token: tokenSchema }))
    .query(async ({ ctx, input }) => {
      const invite = await ctx.prisma.pageGuestInvite.findUnique({
        where: { tokenHash: hashInviteToken(input.token) },
        // No page title — metadata-only discipline pre-acceptance (spec §6).
        select: {
          email: true,
          role: true,
          expiresAt: true,
          acceptedAt: true,
          revokedAt: true,
          inviterId: true,
          workspace: { select: { name: true } },
        },
      })
      if (!invite) return RESOLVE_NOT_FOUND
      const inviter = await ctx.prisma.user.findUnique({
        where: { id: invite.inviterId },
        select: inviterNameSelect,
      })
      return {
        state: inviteState(invite),
        workspaceName: invite.workspace.name,
        inviterName: displayName(inviter),
        role: invite.role,
        maskedEmail: maskEmail(invite.email),
      }
    }),

  // ── acceptance (any authenticated user; the domain runs the full ladder) ──

  acceptInvite: protectedProcedure
    .input(z.object({ token: tokenSchema }))
    .mutation(async ({ ctx, input }) => {
      return mapDomain(() =>
        domainSvc.people.acceptInvitation({
          token: input.token,
          userId: ctx.user.id,
          userEmail: ctx.user.email,
        }),
      )
    }),

  joinViaLink: protectedProcedure
    .input(z.object({ token: tokenSchema }))
    .mutation(async ({ ctx, input }) => {
      return mapDomain(() =>
        domainSvc.people.joinViaLink({ token: input.token, userId: ctx.user.id }),
      )
    }),

  acceptGuestInvite: protectedProcedure
    .input(z.object({ token: tokenSchema }))
    .mutation(async ({ ctx, input }) => {
      return mapDomain(() =>
        domainSvc.people.acceptGuestInvite({
          token: input.token,
          userId: ctx.user.id,
          userEmail: ctx.user.email,
        }),
      )
    }),
})
