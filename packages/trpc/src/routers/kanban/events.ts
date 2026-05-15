import { z } from 'zod'

import { router, protectedProcedure } from '../../trpc'
import { assertPageAccess } from '../../helpers/page-access'
import { kanbanBus, type KanbanEvent } from '../../realtime/kanban-bus'

export const eventsRouter = router({
  subscribe: protectedProcedure
    .input(z.object({ pageId: z.string().uuid() }))
    .subscription(async function* ({ ctx, input, signal }) {
      await assertPageAccess(ctx, input.pageId)

      const queue: KanbanEvent[] = []
      let resolveNext: ((value: KanbanEvent | null) => void) | null = null

      const unsubscribe = kanbanBus.on(input.pageId, (event) => {
        if (resolveNext) {
          const r = resolveNext
          resolveNext = null
          r(event)
        } else {
          queue.push(event)
        }
      })

      const onAbort = () => {
        if (resolveNext) {
          const r = resolveNext
          resolveNext = null
          r(null)
        }
      }
      signal?.addEventListener('abort', onAbort)

      try {
        while (!signal?.aborted) {
          if (queue.length > 0) {
            yield queue.shift()!
            continue
          }
          const event = await new Promise<KanbanEvent | null>((resolve) => {
            resolveNext = resolve
          })
          if (event === null || signal?.aborted) break
          yield event
        }
      } finally {
        unsubscribe()
        signal?.removeEventListener('abort', onAbort)
      }
    }),
})
