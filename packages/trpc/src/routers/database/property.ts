import { z } from 'zod'
import * as domain from '@repo/domain'

import { router, protectedProcedure } from '../../trpc'
import { assertPageAccess, assertPageEditAccess } from '../../helpers/page-access'
import { mapDomain } from '../../helpers/map-domain'
import { domain as domainSvc } from '../../domain'

export const propertyRouter = router({
  list: protectedProcedure
    .input(z.object({ pageId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertPageAccess(ctx, input.pageId)
      return mapDomain(() => domainSvc.database.listProperties(ctx.user.id, input.pageId))
    }),

  create: protectedProcedure
    .input(domain.createPropertyInput)
    .mutation(async ({ ctx, input }) => {
      await assertPageEditAccess(ctx, input.pageId)
      return mapDomain(() => domainSvc.database.createProperty(ctx.user.id, input))
    }),

  update: protectedProcedure
    .input(domain.updatePropertyInput)
    .mutation(async ({ ctx, input }) => {
      await assertPageEditAccess(ctx, input.pageId)
      return mapDomain(() => domainSvc.database.updateProperty(ctx.user.id, input))
    }),

  delete: protectedProcedure
    .input(domain.propertyIdInput)
    .mutation(async ({ ctx, input }) => {
      await assertPageEditAccess(ctx, input.pageId)
      return mapDomain(() => domainSvc.database.deleteProperty(ctx.user.id, input))
    }),

  reorder: protectedProcedure
    .input(domain.reorderPropertiesInput)
    .mutation(async ({ ctx, input }) => {
      await assertPageEditAccess(ctx, input.pageId)
      return mapDomain(() => domainSvc.database.reorderProperties(ctx.user.id, input))
    }),
})
