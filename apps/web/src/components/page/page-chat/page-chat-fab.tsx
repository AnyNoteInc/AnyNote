'use client'

import { Box, Fab, ForumRoundedIcon, Tooltip, Zoom } from '@repo/ui/components'

import { usePageCommentsContext } from '@/components/page/comments/comments-context'
import { COMMENTS_SIDEBAR_WIDTH } from '@/components/page/comments/comments-sidebar'
import { usePlanFeaturesOptional } from '@/components/workspace/plan-features-context'

import { usePageChatContext } from './page-chat-context'

/** Circular bottom-right entry point (Notion's agent-face placement, spec §7).
 *  Visible on EVERY plan — the paywall lives in the panel + server (spec §8.2).
 *  Zoom-hidden while the panel is open: the panel's «Скрыть чат» button is the
 *  single close affordance, and the FAB reappears on close. */
export function PageChatFab() {
  const chat = usePageChatContext()
  const features = usePlanFeaturesOptional()
  const { panelOpen: commentsOpen } = usePageCommentsContext()

  if (!chat?.enabled || !features) return null

  const rightOffset = commentsOpen ? COMMENTS_SIDEBAR_WIDTH : 0

  return (
    <Zoom in={!chat.panelOpen} unmountOnExit>
      <Box
        sx={{
          position: 'fixed',
          bottom: 24,
          right: 24 + rightOffset,
          zIndex: (theme) => theme.zIndex.appBar,
          transition: 'right 0.15s ease',
        }}
      >
        <Tooltip title="Чат по странице">
          <Fab
            color="primary"
            size="medium"
            onClick={chat.togglePanel}
            data-testid="page-chat-fab"
          >
            <ForumRoundedIcon />
          </Fab>
        </Tooltip>
      </Box>
    </Zoom>
  )
}
