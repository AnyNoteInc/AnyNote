'use client'

import { trpc } from '@/trpc/client'

interface UseKanbanEventsArgs {
  pageId: string
}

interface KanbanEvent {
  kind: string
  taskId?: string
}

export function useKanbanEvents({ pageId }: UseKanbanEventsArgs) {
  const utils = trpc.useUtils()

  trpc.kanban.events.subscribe.useSubscription(
    { pageId },
    {
      onData: async (event: KanbanEvent) => {
        await utils.kanban.board.getBoard.invalidate({ pageId })
        if (event.taskId) {
          await utils.kanban.board.getActivity.invalidate({ pageId, taskId: event.taskId })
        }
        if (
          (event.kind === 'comment.upserted' || event.kind === 'comment.deleted') &&
          event.taskId
        ) {
          await utils.kanban.comment.list.invalidate({ pageId, taskId: event.taskId })
        }
        if (
          (event.kind === 'task.updated' || event.kind === 'task.created') &&
          event.taskId
        ) {
          await utils.kanban.attachment.list.invalidate({ pageId, taskId: event.taskId })
        }
      },
    },
  )
}
