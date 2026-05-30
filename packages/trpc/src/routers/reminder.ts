import { router, protectedProcedure } from '../trpc'
import * as domain from '@repo/domain'
import { mapDomain } from '../helpers/map-domain'
import { domain as domainSvc } from '../domain'

export const reminderRouter = router({
  syncForPage: protectedProcedure
    .input(domain.syncRemindersInput)
    .mutation(async ({ ctx, input }) => {
      return mapDomain(() => domainSvc.reminders.sync(ctx.user.id, input))
    }),
})
