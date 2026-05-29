import { router, protectedProcedure } from '../trpc'
import {
  rebuildDeliveries,
  cancelPendingDeliveries,
} from '@repo/notifications'
import * as domain from '@repo/domain'
import { mapDomain } from '../helpers/map-domain'

const scheduler = {
  rebuild: rebuildDeliveries,
  cancel: cancelPendingDeliveries,
}

export const reminderRouter = router({
  syncForPage: protectedProcedure
    .input(domain.syncRemindersInput)
    .mutation(async ({ ctx, input }) => {
      return mapDomain(() => domain.syncReminders(ctx.prisma, ctx.user.id, input, scheduler))
    }),
})
