import { z } from 'zod'
import { TRPCError } from '@trpc/server'

import { router, protectedProcedure } from '../trpc'
import { assertRole, MEMBER_ROLES } from '../helpers/membership'

const ScopeSchema = z.enum(['USER', 'WORKSPACE'])

/**
 * Generic integration providers with real connection logic. Everything else
 * (GitHub, Yandex, AmoCRM, MangoOffice) is a placeholder with no implemented
 * OAuth/connection flow, so it is filtered out server-side regardless of any
 * stale `integration_providers` rows a DB might still carry. Telegram has its
 * own dedicated linking flow (`telegram.*` procedures + TelegramLinkCard), not
 * a generic provider row, so this list is currently empty — kept as a typed
 * allowlist so re-enabling an implemented provider is a one-line change.
 */
const IMPLEMENTED_PROVIDER_SLUGS: readonly string[] = []

export const integrationRouter = router({
  listProviders: protectedProcedure.query(async ({ ctx }) => {
    const allowed = new Set(IMPLEMENTED_PROVIDER_SLUGS.map((s) => s.toLowerCase()))
    const providers = await ctx.prisma.integrationProvider.findMany({
      where: { isEnabled: true },
      orderBy: { sortOrder: 'asc' },
    })
    return providers.filter((p) => allowed.has(p.slug.toLowerCase()))
  }),

  listMine: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid().optional() }))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.integration.findMany({
        where: {
          OR: [
            { scope: 'USER', userId: ctx.user.id },
            ...(input.workspaceId
              ? [{ scope: 'WORKSPACE' as const, workspaceId: input.workspaceId }]
              : []),
          ],
          status: { in: ['PENDING', 'CONNECTED', 'ERROR'] },
        },
        include: { provider: true },
      })
    }),

  connect: protectedProcedure
    .input(
      z.object({
        providerId: z.string().uuid(),
        scope: ScopeSchema,
        workspaceId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.scope === 'WORKSPACE' && !input.workspaceId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'workspaceId required for WORKSPACE scope',
        })
      }
      if (input.scope === 'WORKSPACE') {
        await assertRole(ctx, input.workspaceId!, MEMBER_ROLES)
      }
      return ctx.prisma.integration.create({
        data: {
          providerId: input.providerId,
          scope: input.scope,
          userId: input.scope === 'USER' ? ctx.user.id : null,
          workspaceId: input.scope === 'WORKSPACE' ? input.workspaceId : null,
          status: 'PENDING',
        },
      })
    }),

  disconnect: protectedProcedure
    .input(z.object({ integrationId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const integration = await ctx.prisma.integration.findUnique({
        where: { id: input.integrationId },
      })
      if (!integration) throw new TRPCError({ code: 'NOT_FOUND' })
      if (integration.scope === 'USER' && integration.userId !== ctx.user.id) {
        throw new TRPCError({ code: 'FORBIDDEN' })
      }
      if (integration.scope === 'WORKSPACE') {
        await assertRole(ctx, integration.workspaceId!, MEMBER_ROLES)
      }
      return ctx.prisma.integration.update({
        where: { id: input.integrationId },
        data: { status: 'DISCONNECTED' },
      })
    }),
})
