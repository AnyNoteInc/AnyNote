import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import type { Prisma } from '@repo/db'
import { buildPageVisibilityWhere } from '@repo/domain'

import { router, protectedProcedure } from '../trpc'
import {
  assertPageEditAccess,
  assertWorkspaceMember,
  resolveMemberOrPageGrant,
} from '../helpers/page-access'

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * The TYPED result the `syncedBlock` editor node switches on (spec §5). It is
 * what the render-prop placeholder renders AND what the public/VIEWER read path
 * uses for the snapshot.
 *
 * - `ok`: the live, accessible block — `content` is the JSON snapshot, `readOnly`
 *   true when the caller cannot EDIT the origin page (VIEWER/COMMENTER).
 * - `no_access`: the caller cannot reach the block (foreign workspace, no
 *   origin-page access, or an unknown id) — NEVER carries content.
 * - `deleted`: the canonical block was soft-deleted — instances show «удалён».
 * - `unsynced`: «отсоединить все» fired (or the origin page was deleted →
 *   orphan) — carries `content` so each instance can inline-detach locally.
 */
export type SyncedBlockReadResult =
  | { status: 'ok'; content: Prisma.JsonValue | null; originPageId: string; readOnly: boolean }
  | { status: 'no_access' }
  | { status: 'deleted' }
  | { status: 'unsynced'; content: Prisma.JsonValue | null }

type Ctx = { prisma: import('@repo/db').PrismaClient; user: { id: string } }

const NO_ACCESS: SyncedBlockReadResult = { status: 'no_access' }

const tiptapDoc = z
  .object({ type: z.literal('doc') })
  .passthrough()
  .nullable()

// ── Access helpers ──────────────────────────────────────────────────────────

/**
 * Visibility-aware origin-page access (the SAME shape the yjs
 * `canAccessSyncedBlock` resolves, expressed in tRPC terms). Mirrors
 * `page.getById`: the MEMBER arm honours PERSONAL-collection privacy via
 * `buildPageVisibilityWhere` (a workspace member who cannot see the origin
 * PERSONAL page is denied — spec §8.1); the GUEST arm admits a `PageShareUser`
 * grant on the page or an ancestor. Returns null when the caller cannot reach
 * the origin page at all (object-hiding 'no_access'); `readOnly` is true for a
 * VIEWER/COMMENTER (a member without edit role, or a non-EDITOR grant).
 */
async function resolveOriginAccess(
  ctx: Ctx,
  originPageId: string,
): Promise<{ readOnly: boolean } | null> {
  // Member arm — membership + block-awareness + PERSONAL-privacy predicate.
  const memberPage = await ctx.prisma.page.findFirst({
    where: {
      id: originPageId,
      deletedAt: null,
      workspace: {
        members: { some: { userId: ctx.user.id } },
        blockedUsers: { none: { userId: ctx.user.id } },
      },
      AND: [buildPageVisibilityWhere(ctx.user.id)],
    },
    select: { workspaceId: true, createdById: true },
  })
  if (memberPage) {
    // Edit-capable member (creator / OWNER / ADMIN / EDITOR) ⇒ writable.
    if (memberPage.createdById === ctx.user.id) return { readOnly: false }
    const member = await ctx.prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: { workspaceId: memberPage.workspaceId, userId: ctx.user.id },
      },
      select: { role: true },
    })
    const canEdit =
      member?.role === 'OWNER' || member?.role === 'ADMIN' || member?.role === 'EDITOR'
    return { readOnly: !canEdit }
  }

  // Guest arm — a PageShareUser grant on the page or an ancestor. A grant that
  // is not EDITOR is read-only (the share-grant role precedent).
  const page = await ctx.prisma.page.findFirst({
    where: { id: originPageId, deletedAt: null },
    select: { workspaceId: true },
  })
  if (!page) return null
  const access = await resolveMemberOrPageGrant(ctx, page.workspaceId, originPageId)
  // kind === 'member' here means the member arm above rejected on visibility
  // (someone else's PERSONAL page) — members keep no_access.
  if (!access || access.kind !== 'guest') return null
  return { readOnly: access.role !== 'EDITOR' }
}

/** True when the caller is an EDIT-capable member of the workspace (OWNER /
 *  ADMIN / EDITOR) OR the block's creator. The detach/delete fallback gate when
 *  a block has no origin page to assert against (already unsynced / orphaned). */
async function callerCanEditDetachedBlock(
  ctx: Ctx,
  block: { workspaceId: string; createdById: string | null },
): Promise<boolean> {
  if (block.createdById && block.createdById === ctx.user.id) return true
  const member = await ctx.prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: block.workspaceId, userId: ctx.user.id } },
    select: { role: true },
  })
  return member?.role === 'OWNER' || member?.role === 'ADMIN' || member?.role === 'EDITOR'
}

/**
 * Resolve the EDIT gate for a block-level mutation (unsyncAll / delete). When the
 * block still has an origin page we delegate to `assertPageEditAccess` (the
 * canonical origin-page edit check); once the block is detached/orphaned
 * (originPageId null) there is no page to assert against, so we fall back to the
 * workspace edit-capable / creator gate. Throws FORBIDDEN/NOT_FOUND on denial.
 */
async function assertCanEditBlock(
  ctx: Ctx,
  block: { workspaceId: string; originPageId: string | null; createdById: string | null },
): Promise<void> {
  if (block.originPageId) {
    await assertPageEditAccess(ctx, block.originPageId)
    return
  }
  if (!(await callerCanEditDetachedBlock(ctx, block))) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Недостаточно прав на редактирование' })
  }
}

// ── Router ──────────────────────────────────────────────────────────────────

export const syncedBlockRouter = router({
  // Create a canonical synced block originating on `originPageId`. EDIT access to
  // the origin page is required; the workspace is derived from the page (never
  // trusted from the client). The supplied tiptap JSON seeds `content` so the
  // snapshot/export render immediately; `contentYjs` is left null — the first
  // nested-editor connection (`syncedBlock:{id}` Hocuspocus doc) seeds the bytes.
  create: protectedProcedure
    .input(
      z.object({
        originPageId: z.string().uuid(),
        content: tiptapDoc.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const page = await assertPageEditAccess(ctx, input.originPageId)
      const created = await ctx.prisma.syncedBlock.create({
        data: {
          workspaceId: page.workspaceId,
          originPageId: input.originPageId,
          createdById: ctx.user.id,
          ...(input.content == null ? {} : { content: input.content as Prisma.InputJsonValue }),
        },
        select: { id: true },
      })
      return { id: created.id }
    }),

  // The access-checked read the editor node switches on. Returns a TYPED union
  // (spec §5) — never throws on no-access (the node must distinguish 'no_access'
  // from 'deleted'/'unsynced' to render the right placeholder), and never leaks
  // content to a viewer without origin-page access.
  getById: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }): Promise<SyncedBlockReadResult> => {
      const block = await ctx.prisma.syncedBlock.findUnique({
        where: { id: input.id },
        select: {
          workspaceId: true,
          originPageId: true,
          content: true,
          deletedAt: true,
          unsyncedAt: true,
        },
      })
      // Unknown id ⇒ object-hiding no_access (never reveal existence).
      if (!block) return NO_ACCESS

      // Cross-workspace backstop: a caller who is not a member of the block's
      // workspace gets no_access for EVERY state — content never leaks across the
      // workspace boundary (the copy-bytes-verbatim caveat's runtime backstop).
      const member = await ctx.prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: block.workspaceId, userId: ctx.user.id } },
        select: { id: true },
      })
      if (!member) return NO_ACCESS

      if (block.deletedAt) return { status: 'deleted' }

      // «Отсоединить все» fired, or the origin page was deleted (SetNull → orphan)
      // ⇒ unsynced WITH content so the instance inlines + detaches locally.
      if (block.unsyncedAt || !block.originPageId) {
        return { status: 'unsynced', content: block.content }
      }

      // Live block: inherit the origin page's access (visibility-aware — a
      // member who cannot see the origin PERSONAL page is denied). No access ⇒
      // no_access, never leaking content. readOnly when the caller can read but
      // not EDIT the origin page (VIEWER/COMMENTER).
      const origin = await resolveOriginAccess(ctx, block.originPageId)
      if (!origin) return NO_ACCESS
      return {
        status: 'ok',
        content: block.content,
        originPageId: block.originPageId,
        readOnly: origin.readOnly,
      }
    }),

  // The picker / «отсоединить все» management list: the workspace's live synced
  // blocks the caller can ACCESS (per-block origin-page access filter). Excludes
  // deleted blocks; detached/orphaned blocks (no origin page) are omitted — the
  // picker only offers re-insertable LIVE blocks. Capped defensively.
  list: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertWorkspaceMember(ctx, input.workspaceId)
      const rows = await ctx.prisma.syncedBlock.findMany({
        where: {
          workspaceId: input.workspaceId,
          deletedAt: null,
          unsyncedAt: null,
          originPageId: { not: null },
        },
        select: { id: true, originPageId: true, content: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 200,
      })
      const accessible: { id: string; originPageId: string }[] = []
      for (const row of rows) {
        if (!row.originPageId) continue
        const origin = await resolveOriginAccess(ctx, row.originPageId)
        if (!origin) continue
        accessible.push({ id: row.id, originPageId: row.originPageId })
      }
      return { blocks: accessible }
    }),

  // «Отсоединить все»: detach EVERY instance at once. Origin-page-edit-gated.
  // Sets unsyncedAt + nulls originPageId so each instance, on next render, sees
  // getById → 'unsynced' and inlines locally (lazy, no synchronous remote
  // deletion — the safe rule). Idempotent: a re-detach / a detached block is a
  // no-op success.
  unsyncAll: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const block = await ctx.prisma.syncedBlock.findUnique({
        where: { id: input.id },
        select: { workspaceId: true, originPageId: true, createdById: true, unsyncedAt: true },
      })
      if (!block) throw new TRPCError({ code: 'NOT_FOUND', message: 'Блок не найден' })
      await assertCanEditBlock(ctx, block)
      await ctx.prisma.syncedBlock.update({
        where: { id: input.id },
        data: { unsyncedAt: block.unsyncedAt ?? new Date(), originPageId: null },
      })
      return { ok: true }
    }),

  // Soft-delete the canonical block. Origin-page-edit-gated. Instances degrade to
  // the «удалён» placeholder on next render. Idempotent.
  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const block = await ctx.prisma.syncedBlock.findUnique({
        where: { id: input.id },
        select: { workspaceId: true, originPageId: true, createdById: true, deletedAt: true },
      })
      if (!block) throw new TRPCError({ code: 'NOT_FOUND', message: 'Блок не найден' })
      await assertCanEditBlock(ctx, block)
      if (!block.deletedAt) {
        await ctx.prisma.syncedBlock.update({
          where: { id: input.id },
          data: { deletedAt: new Date() },
        })
      }
      return { ok: true }
    }),
})
