'use client'

import { Fab, ForumRoundedIcon, Tooltip } from '@repo/ui/components'

import { usePageCommentsContext } from '@/components/page/comments/comments-context'
import { COMMENTS_SIDEBAR_WIDTH } from '@/components/page/comments/comments-sidebar'
import { usePlanFeaturesOptional } from '@/components/workspace/plan-features-context'

import { PAGE_CHAT_SIDEBAR_WIDTH, usePageChatContext } from './page-chat-context'

/** Circular bottom-right entry point (Notion's agent-face placement, spec §7).
 *  Visible on EVERY plan — the paywall lives in the panel + server (spec §8.2). */
export function PageChatFab() {
  const chat = usePageChatContext()
  const features = usePlanFeaturesOptional()
  const { panelOpen: commentsOpen } = usePageCommentsContext()

  if (!chat?.enabled || !features) return null

  const rightOffset =
    (commentsOpen ? COMMENTS_SIDEBAR_WIDTH : 0) + (chat.panelOpen ? PAGE_CHAT_SIDEBAR_WIDTH : 0)

  return (
    <Tooltip title="Чат по странице">
      <Fab
        color="primary"
        size="medium"
        onClick={chat.togglePanel}
        data-testid="page-chat-fab"
        sx={{
          position: 'fixed',
          bottom: 24,
          right: 24 + rightOffset,
          zIndex: (theme) => theme.zIndex.appBar,
          transition: 'right 0.15s ease',
        }}
      >
        <ForumRoundedIcon />
      </Fab>
    </Tooltip>
  )
}
