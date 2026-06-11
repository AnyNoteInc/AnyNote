import { TRPCError } from '@trpc/server'
import type { Prisma, PrismaClient } from '@repo/db'

export const BLOCKED_MESSAGE = 'Доступ заблокирован администратором'

export type WorkspaceRole = 'OWNER' | 'ADMIN' | 'EDITOR' | 'COMMENTER' | 'VIEWER' | 'GUEST'

/** Any membership at all — `assertRole(ctx, id, MEMBER_ROLES)` is the plain member assert. */
export const MEMBER_ROLES: readonly WorkspaceRole[] = [
  'OWNER',
  'ADMIN',
  'EDITOR',
  'COMMENTER',
  'VIEWER',
  'GUEST',
]

type Db = PrismaClient | Prisma.TransactionClient
type Ctx = { prisma: Db; user: { id: string } }

/**
 * The single role-gate for tRPC routers: the actor must hold a member row with
 * one of `allowed` roles AND no `workspace_blocked_users` row. Equivalent to
 * `domain.workspace.assertMembership` + a role check (canonical block
 * semantics: `PeopleService.isWorkspaceBlocked` in `@repo/domain`); runs on
 * `ctx.prisma` so transaction clients and mocked-context tests keep working.
 */
export async function assertRole(
  ctx: Ctx,
  workspaceId: string,
  allowed: readonly WorkspaceRole[],
) {
  const member = await ctx.prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId: ctx.user.id } },
  })
  if (!member || !allowed.includes(member.role as WorkspaceRole)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Недостаточно прав' })
  }
  await assertNotBlocked(ctx, workspaceId)
  return member
}

/**
 * One indexed lookup on the block table — the ctx-bound mirror of
 * `PeopleService.assertNotBlocked` in `@repo/domain`.
 */
export async function assertNotBlocked(ctx: Ctx, workspaceId: string): Promise<void> {
  const blocked = await ctx.prisma.workspaceBlockedUser.findUnique({
    where: { workspaceId_userId: { workspaceId, userId: ctx.user.id } },
    select: { id: true },
  })
  if (blocked) {
    throw new TRPCError({ code: 'FORBIDDEN', message: BLOCKED_MESSAGE })
  }
}
