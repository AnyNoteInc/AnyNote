'use client'

/* eslint-disable react/prop-types -- plugin can't unwrap the Readonly<> props generic */

import Box from '@mui/material/Box'
import Timeline from '@mui/lab/Timeline'
import TimelineConnector from '@mui/lab/TimelineConnector'
import TimelineContent from '@mui/lab/TimelineContent'
import TimelineDot from '@mui/lab/TimelineDot'
import TimelineItem, { timelineItemClasses } from '@mui/lab/TimelineItem'
import TimelineSeparator from '@mui/lab/TimelineSeparator'
import type { ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'

import { ChatFileChip } from './chat-file-chip'
import { ChatServiceBlock, toolDotColor } from './chat-service-block'
import { ChatThinkingBlock } from './chat-thinking-block'
import type { ChatConfirmHandler, ChatMessagePart } from './chat-types'

export type ChatRenderLink = (href: string, children: ReactNode) => ReactNode

type TimelineDotColor = 'grey' | 'primary' | 'error' | 'warning'

type ChatMessageContentProps = Readonly<{
  parts: ChatMessagePart[]
  renderLink?: ChatRenderLink
  onConfirm?: ChatConfirmHandler
}>

function linkifyWorkspacePageReferences(text: string): string {
  return text.replace(
    /(здесь)\s*:\s*(\/workspaces\/[0-9a-f-]{8}-[0-9a-f-]{4}-[0-9a-f-]{4}-[0-9a-f-]{4}-[0-9a-f-]{12}\/pages\/[0-9a-f-]{8}-[0-9a-f-]{4}-[0-9a-f-]{4}-[0-9a-f-]{4}-[0-9a-f-]{12})/giu,
    '[$1]($2)',
  )
}

function dotColorForPart(part: ChatMessagePart): TimelineDotColor {
  return part.type === 'tool' ? toolDotColor(part.state) : 'grey'
}

// Tool dots are filled so their state colour (grey/primary/error/warning) reads
// at a glance — that colour IS the tool-state signal. Text/thinking dots stay
// outlined-grey so they sit quietly on the timeline rail without competing.
function dotVariantForPart(part: ChatMessagePart): 'filled' | 'outlined' {
  return part.type === 'tool' ? 'filled' : 'outlined'
}

export function ChatMessageContent({ parts, renderLink, onConfirm }: ChatMessageContentProps) {
  const markdownComponents = renderLink
    ? {
        a: ({ href, children }: { href?: string; children?: ReactNode }) =>
          href ? <>{renderLink(href, children)}</> : <>{children}</>,
      }
    : undefined

  return (
    <Timeline
      sx={{
        m: 0,
        p: 0,
        [`& .${timelineItemClasses.root}:before`]: { flex: 0, p: 0 },
      }}
    >
      {parts.map((part, index) => {
        const isLast = index === parts.length - 1
        return (
          <TimelineItem key={part.type === 'tool' ? part.id : `${part.type}-${index}`}>
            <TimelineSeparator>
              <TimelineDot color={dotColorForPart(part)} variant={dotVariantForPart(part)} />
              {isLast ? null : <TimelineConnector />}
            </TimelineSeparator>
            <TimelineContent sx={{ pb: 1.25, pt: 0 }}>
              {part.type === 'thinking' ? <ChatThinkingBlock text={part.text} /> : null}
              {part.type === 'text' ? (
                <Box
                  sx={{
                    '& code': { bgcolor: 'action.hover', borderRadius: 1, px: 0.5, py: 0.125 },
                    '& ol, & ul': { m: 0, pl: 3 },
                    '& p': { m: 0 },
                    '& p + p': { mt: 1 },
                    '& pre': {
                      bgcolor: 'grey.100',
                      borderRadius: 2,
                      m: 0,
                      overflowX: 'auto',
                      p: 1,
                    },
                    '& strong': { fontWeight: 600 },
                    overflowWrap: 'anywhere',
                  }}
                >
                  <ReactMarkdown components={markdownComponents}>
                    {linkifyWorkspacePageReferences(part.text)}
                  </ReactMarkdown>
                </Box>
              ) : null}
              {part.type === 'attacment' ? (
                <ChatFileChip
                  href={part.downloadUrl}
                  name={part.name}
                  secondaryLabel={part.fileSize}
                />
              ) : null}
              {part.type === 'tool' ? (
                <ChatServiceBlock onConfirm={onConfirm} part={part} />
              ) : null}
            </TimelineContent>
          </TimelineItem>
        )
      })}
    </Timeline>
  )
}
