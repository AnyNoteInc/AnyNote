import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { TRPCError } from '@trpc/server'

import {
  hashSharePassword,
  verifySharePassword,
  ShareAccessService,
  ShareAccessRepository,
} from '@repo/domain'
import { sendMailNow } from '@repo/mail'

import { router, protectedProcedure, publicProcedure } from '../trpc'
import { assertCanManageShare, assertWorkspaceMember } from '../helpers/page-access'
import { getWorkspaceFeatures } from '../helpers/plan'
import { mapDomain } from '../helpers/map-domain'
import { domain as domainSvc } from '../domain'

const RoleSchema = z.enum(['READER', 'COMMENTER', 'EDITOR'])
const AccessSchema = z.enum(['RESTRICTED', 'PUBLIC'])

// The browser tRPC client has no superjson transformer, so a Date argument
// arrives as an ISO string over HTTP. Coerce it back to a Date (Dates from the
// server-side createCaller path pass through unchanged) so the date-picker UI
// can send `expiresAt`/`exposesAt` directly.
const nullableDateInput = z.preprocess((v) => {
  if (v === null || v === undefined) return v
  if (v instanceof Date) return v
  if (typeof v === 'string') {
    const parsed = new Date(v)
    return Number.isNaN(parsed.getTime()) ? v : parsed
  }
  return v
}, z.date().nullable())

function newShareId(): string {
  return randomBytes(32).toString('hex') // 64 hex chars, 256-bit entropy
}

const userSelect = { id: true, firstName: true, lastName: true, email: true, image: true } as const

// Selects passwordHash so we can derive `hasPassword` — `toShareView` strips
// the raw hash before it ever leaves the router (never exposed to the client).
const shareSelect = {
  id: true,
  shareId: true,
  access: true,
  linkRole: true,
  mode: true,
  expiresAt: true,
  publishedAt: true,
  unpublishedAt: true,
  allowIndexing: true,
  allowCopy: true,
  publishSubpages: true,
  analyticsGoogleId: true,
  analyticsYandexMetricaId: true,
  exposesAt: true,
  passwordHash: true,
  users: {
    select: { role: true, user: { select: userSelect } },
    orderBy: { createdAt: 'asc' as const },
  },
} as const

type ShareRow = {
  passwordHash: string | null
  [key: string]: unknown
}

// Replace the raw passwordHash with a boolean so the client can render a
// "password protected" state without ever receiving the secret.
function toShareView<T extends ShareRow>(share: T | null) {
  if (!share) return null
  const { passwordHash, ...rest } = share
  return { ...rest, hasPassword: passwordHash != null }
}

// Lazily create-or-return the share row (manage rights already asserted by the
// caller). Used by every settings/publish/password mutation so callers can
// configure a page before the dialog has explicitly created a row.
async function ensureShare(
  ctx: { prisma: import('@repo/db').PrismaClient; user: { id: string } },
  pageId: string,
) {
  const existing = await ctx.prisma.pageShare.findUnique({
    where: { pageId },
    select: { id: true },
  })
  if (existing) return existing
  return ctx.prisma.pageShare.create({
    data: { pageId, shareId: newShareId(), createdById: ctx.user.id },
    select: { id: true },
  })
}

export const pageShareRouter = router({
  // Read-only: never creates a row (so the toolbar manage-probe stays side-effect-free).
  get: protectedProcedure
    .input(z.object({ pageId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const page = await assertCanManageShare(ctx, input.pageId)
      const share = await ctx.prisma.pageShare.findUnique({
        where: { pageId: input.pageId },
        select: shareSelect,
      })
      const owner = page.createdById
        ? await ctx.prisma.user.findUnique({ where: { id: page.createdById }, select: userSelect })
        : null
      return { share: toShareView(share), owner, canManage: true }
    }),

  // Lazy create-or-return; called when the dialog opens (spec: lazy on dialog open).
  ensure: protectedProcedure
    .input(z.object({ pageId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertCanManageShare(ctx, input.pageId)
      const existing = await ctx.prisma.pageShare.findUnique({
        where: { pageId: input.pageId },
        select: shareSelect,
      })
      if (existing) return toShareView(existing)
      const created = await ctx.prisma.pageShare.create({
        data: { pageId: input.pageId, shareId: newShareId(), createdById: ctx.user.id },
        select: shareSelect,
      })
      return toShareView(created)
    }),

  setAccess: protectedProcedure
    .input(z.object({ pageId: z.string().uuid(), access: AccessSchema, linkRole: RoleSchema }))
    .mutation(async ({ ctx, input }) => {
      const page = await assertCanManageShare(ctx, input.pageId)
      // Security policy (8C §4): only the MORE-public transition is gated —
      // setting RESTRICTED must always work so owners can close things down.
      if (input.access === 'PUBLIC') {
        await mapDomain(() => domainSvc.security.assertPublicSharingAllowed(page.workspaceId))
      }
      return ctx.prisma.pageShare.update({
        where: { pageId: input.pageId },
        data: { access: input.access, linkRole: input.linkRole },
        select: { id: true, access: true, linkRole: true },
      })
    }),

  // Workspace-scoped list of the public links/sites the caller can manage —
  // backs the "Manage public pages" settings section. A caller manages a share
  // when they created the page OR are an OWNER/ADMIN of the workspace; a plain
  // member only sees shares on pages they created. Never returns the password
  // hash (raw PageShare columns are mapped to a flat view-model here).
  listManagedPublicPages: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const member = await assertWorkspaceMember(ctx, input.workspaceId)
      const canManageAll = member.role === 'OWNER' || member.role === 'ADMIN'

      const shares = await ctx.prisma.pageShare.findMany({
        where: {
          page: {
            workspaceId: input.workspaceId,
            deletedAt: null,
            ...(canManageAll ? {} : { createdById: ctx.user.id }),
          },
        },
        select: {
          shareId: true,
          access: true,
          linkRole: true,
          mode: true,
          expiresAt: true,
          publishedAt: true,
          unpublishedAt: true,
          allowIndexing: true,
          allowCopy: true,
          createdAt: true,
          page: { select: { id: true, title: true, icon: true } },
        },
        orderBy: { createdAt: 'desc' },
      })

      return shares.map((s) => {
        const published =
          s.publishedAt != null &&
          (s.unpublishedAt == null || s.unpublishedAt.getTime() < s.publishedAt.getTime())
        return {
          shareId: s.shareId,
          pageId: s.page.id,
          title: s.page.title,
          icon: s.page.icon,
          access: s.access,
          linkRole: s.linkRole,
          mode: s.mode,
          published,
          publishedAt: s.publishedAt,
          expiresAt: s.expiresAt,
          allowIndexing: s.allowIndexing,
          allowCopy: s.allowCopy,
        }
      })
    }),

  // --- Public link / site settings (Notion-parity "Anyone with the link" +
  // Publish tab). All require manage rights; each lazily ensures the row. ---

  updatePublicLinkSettings: protectedProcedure
    .input(
      z.object({
        pageId: z.string().uuid(),
        access: AccessSchema,
        linkRole: RoleSchema,
        expiresAt: nullableDateInput.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const page = await assertCanManageShare(ctx, input.pageId)
      // Security policy (8C §4): gate only the PUBLIC direction (see setAccess).
      if (input.access === 'PUBLIC') {
        await mapDomain(() => domainSvc.security.assertPublicSharingAllowed(page.workspaceId))
      }
      await ensureShare(ctx, input.pageId)
      const data: {
        access: typeof input.access
        linkRole: typeof input.linkRole
        expiresAt?: Date | null
      } = {
        access: input.access,
        linkRole: input.linkRole,
      }
      if (input.expiresAt !== undefined) data.expiresAt = input.expiresAt
      return ctx.prisma.pageShare.update({
        where: { pageId: input.pageId },
        data,
        select: { id: true, access: true, linkRole: true, expiresAt: true },
      })
    }),

  updatePublicSiteSettings: protectedProcedure
    .input(
      z.object({
        pageId: z.string().uuid(),
        allowIndexing: z.boolean(),
        allowCopy: z.boolean(),
        publishSubpages: z.boolean(),
        analyticsGoogleId: z.string().nullable().optional(),
        analyticsYandexMetricaId: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertCanManageShare(ctx, input.pageId)
      await ensureShare(ctx, input.pageId)
      const data: {
        allowIndexing: boolean
        allowCopy: boolean
        publishSubpages: boolean
        analyticsGoogleId?: string | null
        analyticsYandexMetricaId?: string | null
      } = {
        allowIndexing: input.allowIndexing,
        allowCopy: input.allowCopy,
        publishSubpages: input.publishSubpages,
      }
      if (input.analyticsGoogleId !== undefined) data.analyticsGoogleId = input.analyticsGoogleId
      if (input.analyticsYandexMetricaId !== undefined)
        data.analyticsYandexMetricaId = input.analyticsYandexMetricaId
      return ctx.prisma.pageShare.update({
        where: { pageId: input.pageId },
        data,
        select: {
          id: true,
          allowIndexing: true,
          allowCopy: true,
          publishSubpages: true,
          analyticsGoogleId: true,
          analyticsYandexMetricaId: true,
        },
      })
    }),

  publishSite: protectedProcedure
    .input(z.object({ pageId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const page = await assertCanManageShare(ctx, input.pageId)
      // Security policy first (8C §4): publishing IS the more-public transition,
      // and the policy denial is the more specific message than the plan gate.
      await mapDomain(() => domainSvc.security.assertPublicSharingAllowed(page.workspaceId))
      const features = await getWorkspaceFeatures(page.workspaceId)
      if (!features.publicSitesEnabled) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Публичные сайты доступны на тарифе Pro и выше',
        })
      }
      await ensureShare(ctx, input.pageId)
      return ctx.prisma.pageShare.update({
        where: { pageId: input.pageId },
        data: { mode: 'SITE', publishedAt: new Date(), unpublishedAt: null },
        select: { id: true, mode: true, publishedAt: true, unpublishedAt: true },
      })
    }),

  unpublishSite: protectedProcedure
    .input(z.object({ pageId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertCanManageShare(ctx, input.pageId)
      await ensureShare(ctx, input.pageId)
      return ctx.prisma.pageShare.update({
        where: { pageId: input.pageId },
        data: { unpublishedAt: new Date() },
        select: { id: true, unpublishedAt: true },
      })
    }),

  setExposesAt: protectedProcedure
    .input(z.object({ pageId: z.string().uuid(), exposesAt: nullableDateInput }))
    .mutation(async ({ ctx, input }) => {
      const page = await assertCanManageShare(ctx, input.pageId)
      // Security policy (8C §4): scheduling an expose date is a publish intent
      // (more public) — gated; clearing the schedule (null) closes down — free.
      if (input.exposesAt !== null) {
        await mapDomain(() => domainSvc.security.assertPublicSharingAllowed(page.workspaceId))
      }
      await ensureShare(ctx, input.pageId)
      return ctx.prisma.pageShare.update({
        where: { pageId: input.pageId },
        data: { exposesAt: input.exposesAt },
        select: { id: true, exposesAt: true },
      })
    }),

  setSharePassword: protectedProcedure
    .input(z.object({ pageId: z.string().uuid(), password: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await assertCanManageShare(ctx, input.pageId)
      await ensureShare(ctx, input.pageId)
      await ctx.prisma.pageShare.update({
        where: { pageId: input.pageId },
        data: { passwordHash: await hashSharePassword(input.password) },
        select: { id: true },
      })
      return { ok: true, hasPassword: true }
    }),

  clearSharePassword: protectedProcedure
    .input(z.object({ pageId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertCanManageShare(ctx, input.pageId)
      await ensureShare(ctx, input.pageId)
      await ctx.prisma.pageShare.update({
        where: { pageId: input.pageId },
        data: { passwordHash: null },
        select: { id: true },
      })
      return { ok: true, hasPassword: false }
    }),

  // Public (unauthenticated): a visitor on the password gate submits a candidate
  // password for a shareId. Returns only a boolean — never the hash, never the
  // page. `{ valid: false }` when the share is missing or has no password set.
  validateSharePassword: publicProcedure
    .input(z.object({ shareId: z.string(), password: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const share = await ctx.prisma.pageShare.findUnique({
        where: { shareId: input.shareId },
        select: { passwordHash: true },
      })
      if (!share?.passwordHash) return { valid: false }
      return { valid: verifySharePassword(input.password, share.passwordHash) }
    }),

  // Public (unauthenticated): the published subtree of a SITE share, for the
  // public navigation sidebar. Re-validates the share through the resolver
  // authority (publish/expiry/password/archived) and walks `parentId` down from
  // the share root, excluding archived/deleted pages and EVERY PERSONAL
  // collection (the public viewer never owns one). Returns an EMPTY tree for
  // LINK mode or any unavailable share — a public visitor never enumerates a
  // private subtree.
  publicTree: publicProcedure
    .input(z.object({ shareId: z.string(), password: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const resolver = new ShareAccessService(new ShareAccessRepository(ctx.prisma))
      const resolved = await resolver.resolve({
        shareId: input.shareId,
        password: input.password,
        now: new Date(),
      })
      // Only published SITE shares (with subpages enabled) expose a tree. The
      // resolver's `page` is the share ROOT (no requestedPageId was passed), so
      // its title/icon label the nav root link.
      if (
        resolved.status !== 'ok' ||
        resolved.share.mode !== 'SITE' ||
        !resolved.share.publishSubpages
      ) {
        const root = resolved.status === 'ok' ? resolved.page : null
        return {
          rootId: root?.id ?? null,
          rootTitle: root?.title ?? null,
          rootIcon: root?.icon ?? null,
          nodes: [],
        }
      }

      const rootId = resolved.page.id
      type TreeNode = { id: string; title: string | null; icon: string | null; parentId: string | null }
      const nodes: TreeNode[] = []
      let frontier = [rootId]
      // Guard against pathological depth / cycles.
      for (let depth = 0; depth < 64 && frontier.length > 0; depth += 1) {
        const children = await ctx.prisma.page.findMany({
          where: {
            parentId: { in: frontier },
            archivedAt: null,
            deletedAt: null,
            // Public traversal never enters a PERSONAL collection.
            NOT: { collection: { kind: 'PERSONAL' } },
          },
          select: { id: true, title: true, icon: true, parentId: true },
          orderBy: { createdAt: 'asc' },
        })
        if (children.length === 0) break
        for (const child of children) nodes.push(child)
        frontier = children.map((c) => c.id)
      }

      return { rootId, rootTitle: resolved.page.title, rootIcon: resolved.page.icon, nodes }
    }),

  // Duplicate-as-template: deep-copy a public page (and its visible subtree)
  // into a workspace the caller belongs to. Re-validates the share through the
  // single resolver authority and refuses unless the share permits copying.
  copyToWorkspace: protectedProcedure
    .input(
      z.object({
        shareId: z.string(),
        rootPageId: z.string().uuid().optional(),
        targetWorkspaceId: z.string().uuid(),
        targetCollectionId: z.string().uuid().optional(),
        includeSubtree: z.boolean().default(true),
        // Threaded from the public route's password gate (?pw=) so a visitor who
        // already unlocked a password-protected site can copy it. Without it the
        // resolver returns password_required and the copy is always denied.
        password: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // 1. Re-validate the share via the resolver (publish/expiry/password/etc.)
      //    AND honour allowCopy — both must pass before any data is copied.
      const resolver = new ShareAccessService(new ShareAccessRepository(ctx.prisma))
      const resolved = await resolver.resolve({
        shareId: input.shareId,
        requestedPageId: input.rootPageId,
        password: input.password,
        now: new Date(),
      })
      if (resolved.status !== 'ok' || !resolved.share.allowCopy) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Копирование этой страницы недоступно',
        })
      }

      // 1b. SOURCE-workspace security policy (8C §4): the owner of the shared
      //     content controls whether it may leave the workspace. The resolver
      //     already validated the share, so its workspaceId is trusted.
      await mapDomain(() =>
        domainSvc.security.assertCrossWorkspaceCopyAllowed(resolved.page.workspaceId),
      )

      // 2. The caller must belong to the destination workspace.
      await assertWorkspaceMember(ctx, input.targetWorkspaceId)

      // 3. Default the destination to the caller's PERSONAL collection.
      let targetCollectionId = input.targetCollectionId ?? null
      if (!targetCollectionId) {
        const personal = await ctx.prisma.collection.findFirst({
          where: {
            workspaceId: input.targetWorkspaceId,
            kind: 'PERSONAL',
            ownerId: ctx.user.id,
          },
          select: { id: true },
        })
        targetCollectionId = personal?.id ?? null
      }

      // 4. Copy via the domain authority — `resolved.page.id` is the validated
      //    page (root or a published subpage), never the raw client input.
      const result = await mapDomain(() =>
        domainSvc.shareCopy.copyTree({
          rootPageId: resolved.page.id,
          targetWorkspaceId: input.targetWorkspaceId,
          targetCollectionId,
          actorUserId: ctx.user.id,
          includeSubtree: input.includeSubtree,
          fromShareId: input.shareId,
        }),
      )
      return { pageId: result.rootPageId }
    }),

  // --- Page-guest invites (people phase 8A): the EMAIL path for inviting
  // someone who may not be registered yet. The existing addUser (userId-based
  // search) stays the path for registered users. ---

  inviteGuest: protectedProcedure
    .input(
      z.object({ pageId: z.string().uuid(), email: z.string().email().max(255), role: RoleSchema }),
    )
    .mutation(async ({ ctx, input }) => {
      const page = await assertCanManageShare(ctx, input.pageId)
      const { invite, token } = await mapDomain(() =>
        domainSvc.people.createGuestInvite({
          pageId: input.pageId,
          actorId: ctx.user.id,
          email: input.email,
          role: input.role,
        }),
      )
      const workspace = await ctx.prisma.workspace.findUniqueOrThrow({
        where: { id: page.workspaceId },
        select: { name: true },
      })
      const first = (ctx.user as { firstName?: string }).firstName ?? ''
      const last = (ctx.user as { lastName?: string }).lastName ?? ''
      // Metadata-only mail: inviter, workspace, link. The page TITLE is
      // deliberately absent pre-acceptance (people spec §6).
      await sendMailNow({
        kind: 'guest-invitation',
        to: invite.email,
        data: {
          inviterName: `${first} ${last}`.trim() || ctx.user.email,
          workspaceName: workspace.name,
          link: `${ctx.returnUrlBase}/guest-invite/${token}`,
        },
      })
      // NEVER the token — the plaintext exists only inside the email link.
      return invite
    }),

  listGuestInvites: protectedProcedure
    .input(z.object({ pageId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertCanManageShare(ctx, input.pageId)
      const now = new Date()
      const invites = await ctx.prisma.pageGuestInvite.findMany({
        where: { pageId: input.pageId, acceptedAt: null, revokedAt: null },
        orderBy: { createdAt: 'desc' },
        // Safe fields only — never tokenHash.
        select: { id: true, email: true, role: true, expiresAt: true, createdAt: true },
      })
      return invites.map((invite) => ({
        ...invite,
        state: invite.expiresAt > now ? ('PENDING' as const) : ('EXPIRED' as const),
      }))
    }),

  revokeGuestInvite: protectedProcedure
    .input(z.object({ pageId: z.string().uuid(), id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const page = await assertCanManageShare(ctx, input.pageId)
      // Manage rights are PAGE-scoped — pin the invite to this page before the
      // (workspace-scoped) domain revoke.
      const invite = await ctx.prisma.pageGuestInvite.findFirst({
        where: { id: input.id, pageId: input.pageId },
        select: { id: true },
      })
      if (!invite) throw new TRPCError({ code: 'NOT_FOUND' })
      return mapDomain(() =>
        domainSvc.people.revokeGuestInvite({
          workspaceId: page.workspaceId,
          actorId: ctx.user.id,
          inviteId: input.id,
        }),
      )
    }),

  addUser: protectedProcedure
    .input(z.object({ pageId: z.string().uuid(), userId: z.string().uuid(), role: RoleSchema }))
    .mutation(async ({ ctx, input }) => {
      const page = await assertCanManageShare(ctx, input.pageId)
      if (input.userId === page.createdById) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Автор уже является владельцем' })
      }
      const member = await ctx.prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: page.workspaceId, userId: input.userId } },
      })
      if (member) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Пользователь уже имеет доступ к пространству',
        })
      }
      // Past this point the target is NOT a workspace member, so the grant is a
      // guest grant by definition — the same security policy as guest invites
      // applies (8C §4 disableGuestInvites).
      await mapDomain(() => domainSvc.security.assertGuestInvitesAllowed(page.workspaceId))
      const share = await ctx.prisma.pageShare.findUnique({
        where: { pageId: input.pageId },
        select: { id: true },
      })
      if (!share) throw new TRPCError({ code: 'NOT_FOUND', message: 'Доступ ещё не создан' })
      return ctx.prisma.pageShareUser.upsert({
        where: { pageShareId_userId: { pageShareId: share.id, userId: input.userId } },
        create: { pageShareId: share.id, userId: input.userId, role: input.role },
        update: { role: input.role },
        select: { role: true, user: { select: userSelect } },
      })
    }),

  updateUser: protectedProcedure
    .input(z.object({ pageId: z.string().uuid(), userId: z.string().uuid(), role: RoleSchema }))
    .mutation(async ({ ctx, input }) => {
      await assertCanManageShare(ctx, input.pageId)
      const share = await ctx.prisma.pageShare.findUnique({
        where: { pageId: input.pageId },
        select: { id: true },
      })
      if (!share) throw new TRPCError({ code: 'NOT_FOUND', message: 'Доступ ещё не создан' })
      return ctx.prisma.pageShareUser.update({
        where: { pageShareId_userId: { pageShareId: share.id, userId: input.userId } },
        data: { role: input.role },
        select: { role: true, user: { select: userSelect } },
      })
    }),

  removeUser: protectedProcedure
    .input(z.object({ pageId: z.string().uuid(), userId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertCanManageShare(ctx, input.pageId)
      const share = await ctx.prisma.pageShare.findUnique({
        where: { pageId: input.pageId },
        select: { id: true },
      })
      if (!share) return { ok: true }
      await ctx.prisma.pageShareUser.deleteMany({
        where: { pageShareId: share.id, userId: input.userId },
      })
      return { ok: true }
    }),
})
