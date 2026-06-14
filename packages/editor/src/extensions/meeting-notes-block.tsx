'use client'

import type { ReactNode } from 'react'
import { Box, Chip, Typography } from '@mui/material'
import GraphicEqIcon from '@mui/icons-material/GraphicEq'
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/react'

import {
  MeetingNotesBlockSchema,
  MEETING_NOTES_BLOCK_LABEL,
  type MeetingNotesBlockAttrs,
} from './meeting-notes-block.schema'

export {
  MEETING_NOTES_BLOCK_LABEL,
  createMeetingNotesBlockNode,
  type MeetingNotesBlockAttrs,
} from './meeting-notes-block.schema'

// Arguments handed to the app-injected renderer. The access-checked tRPC query
// (`meeting.getById`) + the MUI summary card live in apps/web, which CANNOT be
// imported from @repo/editor (module boundary / transpilePackages). So the node
// exposes a render slot: apps/web passes `renderMeetingBlock` through
// `MeetingNotesBlock.configure({ renderMeetingBlock })`, and this view calls it.
export type MeetingNotesBlockRenderArgs = {
  /** The MeetingArtifact id stored on the node. */
  meetingArtifactId: string | null
  /** True when the host editor is editable (false for public share / VIEWER). */
  editorEditable: boolean
  /** Navigate to the MEETING page (the «Открыть встречу» action). */
  onOpenMeeting: (pageId: string) => void
}

export type MeetingNotesBlockRenderer = (args: MeetingNotesBlockRenderArgs) => ReactNode

export type MeetingNotesBlockOptions = {
  // Injected by apps/web to render the live access-checked summary card. When
  // absent (SSR, standalone editor, an unconfigured host) we fall back to a
  // static placeholder card so the node still renders.
  renderMeetingBlock: MeetingNotesBlockRenderer | null
  // Navigation hook so the «Открыть встречу» action can route. Optional.
  onNavigateToPage: ((pageId: string) => void) | null
}

function PlaceholderCard() {
  return (
    <Box sx={{ p: 2 }}>
      <Typography component="div" variant="body2" sx={{ fontWeight: 600 }}>
        {MEETING_NOTES_BLOCK_LABEL}
      </Typography>
    </Box>
  )
}

function MeetingNotesBlockView({ node, extension, editor }: NodeViewProps) {
  const attrs = node.attrs as MeetingNotesBlockAttrs
  const { renderMeetingBlock, onNavigateToPage } = extension.options as MeetingNotesBlockOptions

  const onOpenMeeting = (pageId: string) => {
    onNavigateToPage?.(pageId)
  }

  const content = renderMeetingBlock
    ? renderMeetingBlock({
        meetingArtifactId: attrs.meetingArtifactId,
        editorEditable: editor.isEditable,
        onOpenMeeting,
      })
    : null

  return (
    <NodeViewWrapper
      as="div"
      className="anynote-meeting-notes-block"
      data-type="meeting-notes-block"
      data-meeting-artifact-id={attrs.meetingArtifactId ?? ''}
      data-drag-handle=""
      contentEditable={false}
    >
      <Box
        sx={{
          position: 'relative',
          borderLeft: '3px solid',
          borderColor: 'secondary.main',
          borderRadius: 1,
          bgcolor: 'action.hover',
          pl: 1,
          my: 0.5,
          overflow: 'hidden',
        }}
      >
        <Chip
          icon={<GraphicEqIcon sx={{ fontSize: 14 }} />}
          label={MEETING_NOTES_BLOCK_LABEL}
          size="small"
          sx={{
            position: 'absolute',
            top: 4,
            right: 4,
            height: 20,
            fontSize: 11,
            bgcolor: 'background.paper',
            color: 'text.secondary',
            zIndex: 1,
            '& .MuiChip-icon': { color: 'secondary.main' },
          }}
        />
        {content ?? <PlaceholderCard />}
      </Box>
    </NodeViewWrapper>
  )
}

export const MeetingNotesBlock = MeetingNotesBlockSchema.extend<MeetingNotesBlockOptions>({
  addOptions() {
    return { renderMeetingBlock: null, onNavigateToPage: null }
  },
  addNodeView() {
    return ReactNodeViewRenderer(MeetingNotesBlockView)
  },
})
