import { z } from 'zod'
import type { PrismaClient } from '@repo/db'
import { CONTENT_SEARCH_MAX_PAGE_SIZE, CONTENT_SEARCH_MAX_QUERY_LENGTH } from '@repo/domain'
import { sendMailNow } from '@repo/mail'
import { notify } from '@repo/notifications'

import { router, protectedProcedure } from '../trpc'
import { assertRole } from '../helpers/membership'
import { assertPageEditAccess } from '../helpers/page-access'
import { mapDomain } from '../helpers/map-domain'
import { domain as domainSvc } from '../domain'

// Security policy + guest-invite requests + audited admin content search
// (Phase 8C, spec §5). Every MANAGED procedure is OWNER-only — security is not
// membership-admin work (ADMIN ⇒ FORBIDDEN, count-pinned by tests). The
// member-level surface is `requestGuestInvite` + `myGuestRequests` only.

type Ctx = { prisma: PrismaClient; user: { id: string; email: string } }

function assertSecurityOwner(ctx: Ctx, workspaceId: string) {
  return assertRole(ctx, workspaceId, ['OWNER'])
}

const RoleSchema = z.enum(['READER', 'COMMENTER', 'EDITOR'])

// The five owner-patchable flags (the ack fields move only via
// acknowledgeContentSearch) — mirrors SECURITY_POLICY_FLAGS in @repo/domain.
const policyPatchSchema = z.object({
  disableGuestInvites: z.boolean().optional(),
  allowGuestInviteRequests: z.boolean().optional(),
  disablePublicLinksSitesForms: z.boolean().optional(),
  disableExport: z.boolean().optional(),
  disableMoveDuplicateOutsideWorkspace: z.boolean().optional(),
})

// The browser tRPC client has no superjson transformer, so a Date argument
// arrives as an ISO string over HTTP (the page-share `nullableDateInput`
// precedent). Coerce it back; server-side createCaller Dates pass through.
const dateInput = z.preprocess((v) => {
  if (v instanceof Date) return v
  if (typeof v === 'string') {
    const parsed = new Date(v)
    return Number.isNaN(parsed.getTime()) ? v : parsed
  }
  return v
}, z.date())

type NamedUser = { email: string; firstName?: string | null; lastName?: string | null }

/** The mail/notification display name — `firstName lastName` or the email. */
function actorDisplayName(user: NamedUser): string {
  const full = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim()
  return full || user.email
}

export const securityRouter = router({
  // ── managed: the policy ─────────────────────────────────────────────────────

  getPolicy: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertSecurityOwner(ctx, input.workspaceId)
      return mapDomain(() => domainSvc.security.getPolicy(input.workspaceId))
    }),

  updatePolicy: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid(), patch: policyPatchSchema }))
    .mutation(async ({ ctx, input }) => {
      await assertSecurityOwner(ctx, input.workspaceId)
      return mapDomain(() =>
        domainSvc.security.updatePolicy({
          workspaceId: input.workspaceId,
          actorId: ctx.user.id,
          patch: input.patch,
        }),
      )
    }),

  // ── managed: audited admin content search ───────────────────────────────────

  acknowledgeContentSearch: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertSecurityOwner(ctx, input.workspaceId)
      return mapDomain(() =>
        domainSvc.security.acknowledgeContentSearch({
          workspaceId: input.workspaceId,
          actorId: ctx.user.id,
        }),
      )
    }),

  // A query for React-Query ergonomics — refetches re-audit, which is correct:
  // EVERY search writes a `content_search.performed` row (spec §7.2).
  contentSearch: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
        query: z.string().max(CONTENT_SEARCH_MAX_QUERY_LENGTH).optional(),
        creatorId: z.string().uuid().optional(),
        createdFrom: dateInput.optional(),
        createdTo: dateInput.optional(),
        audience: z.enum(['public', 'external', 'internal', 'private']).optional(),
        cursor: z.string().max(500).optional(),
        pageSize: z.number().int().min(1).max(CONTENT_SEARCH_MAX_PAGE_SIZE).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      await assertSecurityOwner(ctx, input.workspaceId)
      return mapDomain(() =>
        domainSvc.security.adminContentSearch({ ...input, actorId: ctx.user.id }),
      )
    }),

  // ── managed: the guest-request queue ────────────────────────────────────────

  listGuestRequests: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertSecurityOwner(ctx, input.workspaceId)
      return mapDomain(() => domainSvc.security.listGuestInviteRequests(input.workspaceId))
    }),

  approveGuestRequest: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid(), id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertSecurityOwner(ctx, input.workspaceId)
      // The ONLY sanctioned bypass of disableGuestInvites (spec §7.4): the
      // domain marks APPROVED + creates the real invite (bypassPolicy, audited)
      // and surfaces the plaintext token exactly once — for this mail.
      const { request, invite, token } = await mapDomain(() =>
        domainSvc.security.approveGuestInviteRequest({
          workspaceId: input.workspaceId,
          id: input.id,
          actorId: ctx.user.id,
        }),
      )
      const workspace = await ctx.prisma.workspace.findUniqueOrThrow({
        where: { id: input.workspaceId },
        select: { name: true },
      })
      // Metadata-only mail (the pageShare.inviteGuest mirror): inviter,
      // workspace, link. The page TITLE is deliberately absent pre-acceptance
      // (people spec §6); the invitee gets mail only on approval (spec §7.5).
      await sendMailNow({
        kind: 'guest-invitation',
        to: invite.email,
        data: {
          inviterName: actorDisplayName(ctx.user as NamedUser),
          workspaceName: workspace.name,
          link: `${ctx.returnUrlBase}/guest-invite/${token}`,
        },
      })
      // NEVER the token — the plaintext exists only inside the email link.
      return { request, invite }
    }),

  rejectGuestRequest: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid(), id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertSecurityOwner(ctx, input.workspaceId)
      return mapDomain(() =>
        domainSvc.security.rejectGuestInviteRequest({
          workspaceId: input.workspaceId,
          id: input.id,
          actorId: ctx.user.id,
        }),
      )
    }),

  // ── member-level: the share-dialog request surface ──────────────────────────

  requestGuestInvite: protectedProcedure
    .input(
      z.object({ pageId: z.string().uuid(), email: z.string().email().max(255), role: RoleSchema }),
    )
    .mutation(async ({ ctx, input }) => {
      // Edit access is the router's check (spec §3); the policy combo
      // (invites OFF + requests ON) is the domain's.
      const page = await assertPageEditAccess(ctx, input.pageId)
      const { request, ownerIds } = await mapDomain(() =>
        domainSvc.security.createGuestInviteRequest({
          pageId: input.pageId,
          requesterId: ctx.user.id,
          email: input.email,
          role: input.role,
        }),
      )
      const workspace = await ctx.prisma.workspace.findUniqueOrThrow({
        where: { id: page.workspaceId },
        select: { name: true },
      })
      // IN_APP-only owner notifications (spec §7.5): requester + page title are
      // the INTERNAL surface; the invitee email fires only after approval.
      const requesterName = actorDisplayName(ctx.user as NamedUser)
      for (const ownerId of ownerIds) {
        await notify.guestInviteRequested(ctx.prisma, {
          userId: ownerId,
          workspaceId: page.workspaceId,
          actorId: ctx.user.id,
          requesterName,
          pageTitle: page.title ?? 'Без названия',
          workspaceName: workspace.name,
          link: `${ctx.returnUrlBase}/workspaces/${page.workspaceId}/settings`,
        })
      }
      return request
    }),

  /** The requester's own requests for the share dialog — never anyone else's. */
  myGuestRequests: protectedProcedure
    .input(z.object({ pageId: z.string().uuid() }))
    .query(async ({ ctx, input }) =>
      mapDomain(() => domainSvc.security.listMyRequestsForPage(input.pageId, ctx.user.id)),
    ),
})
