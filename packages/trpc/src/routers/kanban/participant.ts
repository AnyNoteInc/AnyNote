import * as domain from '@repo/domain'

import { router, protectedProcedure } from '../../trpc'
import { mapDomain } from '../../helpers/map-domain'
import { domain as domainSvc } from '../../domain'

export const participantRouter = router({
  list: protectedProcedure.input(domain.listParticipantsInput).query(async ({ ctx, input }) => {
    return mapDomain(() => domainSvc.kanban.listParticipants(ctx.user.id, input.workspaceId))
  }),

  create: protectedProcedure
    .input(domain.createParticipantInput)
    .mutation(async ({ ctx, input }) => {
      return mapDomain(() => domainSvc.kanban.createParticipant(ctx.user.id, input))
    }),

  update: protectedProcedure
    .input(domain.updateParticipantInput)
    .mutation(async ({ ctx, input }) => {
      return mapDomain(() => domainSvc.kanban.updateParticipant(ctx.user.id, input))
    }),

  delete: protectedProcedure.input(domain.participantIdInput).mutation(async ({ ctx, input }) => {
    return mapDomain(() => domainSvc.kanban.deleteParticipant(ctx.user.id, input))
  }),
})
