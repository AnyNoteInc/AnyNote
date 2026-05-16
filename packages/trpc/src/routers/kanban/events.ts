import { z } from 'zod'

import { router, protectedProcedure } from '../../trpc'
import { assertPageAccess } from '../../helpers/page-access'
import { kanbanBus, type KanbanEvent } from '../../realtime/kanban-bus'

export const eventsRouter = router({
  subscribe: protectedProcedure
    .input(z.object({ pageId: z.string().uuid() }))
    .subscription(async function* ({ ctx, input, signal }) {
      await assertPageAccess(ctx, input.pageId)

      const MAX_QUEUE = 500
      const queue: KanbanEvent[] = []
      let resolveNext: ((value: KanbanEvent | null) => void) | null = null

      const unsubscribe = kanbanBus.on(input.pageId, (event) => {
        if (resolveNext) {
          const r = resolveNext
          resolveNext = null
          r(event)
        } else {
          queue.push(event)
          if (queue.length > MAX_QUEUE) queue.shift()
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
          const buffered = queue.shift()
          if (buffered) {
            yield buffered
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
