'use client'

import { trpc } from '@/trpc/client'

interface UseKanbanEventsArgs {
  pageId: string
}

export function useKanbanEvents({ pageId }: UseKanbanEventsArgs) {
  const utils = trpc.useUtils()

  trpc.kanban.events.subscribe.useSubscription(
    { pageId },
    {
      onData: () => {
        void utils.kanban.board.getBoard.invalidate({ pageId })
      },
    },
  )
}
