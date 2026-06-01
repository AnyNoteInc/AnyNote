'use client'

/* eslint-disable react/prop-types -- plugin can't unwrap the Readonly<> props generic */

import Box from '@mui/material/Box'
import Timeline from '@mui/lab/Timeline'
import TimelineConnector, { timelineConnectorClasses } from '@mui/lab/TimelineConnector'
import TimelineContent from '@mui/lab/TimelineContent'
import TimelineDot from '@mui/lab/TimelineDot'
import TimelineItem, { timelineItemClasses } from '@mui/lab/TimelineItem'
import TimelineSeparator from '@mui/lab/TimelineSeparator'
import type { ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

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
  variant?: 'assistant' | 'user'
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

export function ChatMessageContent({
  parts,
  renderLink,
  onConfirm,
  variant = 'assistant',
}: ChatMessageContentProps) {
  const markdownComponents = renderLink
    ? {
        a: ({ href, children }: { href?: string; children?: ReactNode }) =>
          href ? <>{renderLink(href, children)}</> : <>{children}</>,
      }
    : undefined

  const renderPartBody = (part: ChatMessagePart): ReactNode => {
    if (part.type === 'thinking') return <ChatThinkingBlock text={part.text} />
    if (part.type === 'text') {
      return (
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
            // GFM tables: a wide table scrolls inside its own box (display:block +
            // overflow) instead of stretching the timeline rail past the chat width.
            '& table': {
              borderCollapse: 'collapse',
              display: 'block',
              my: 1,
              overflowX: 'auto',
              width: 'max-content',
              maxWidth: '100%',
            },
            '& th, & td': {
              border: '1px solid',
              borderColor: 'divider',
              px: 1,
              py: 0.5,
              textAlign: 'left',
            },
            '& th': { bgcolor: 'action.hover', fontWeight: 600 },
            overflowWrap: 'anywhere',
          }}
        >
          <ReactMarkdown components={markdownComponents} remarkPlugins={[remarkGfm]}>
            {linkifyWorkspacePageReferences(part.text)}
          </ReactMarkdown>
        </Box>
      )
    }
    if (part.type === 'attacment') {
      return (
        <ChatFileChip href={part.downloadUrl} name={part.name} secondaryLabel={part.fileSize} />
      )
    }
    if (part.type === 'tool') {
      return <ChatServiceBlock onConfirm={onConfirm} part={part} />
    }
    return null
  }

  const keyFor = (part: ChatMessagePart, index: number) =>
    part.type === 'tool' ? part.id : `${part.type}-${index}`

  if (variant === 'user') {
    return (
      <Box>
        {parts.map((part, index) => (
          <Box key={keyFor(part, index)}>{renderPartBody(part)}</Box>
        ))}
      </Box>
    )
  }

  return (
    <Timeline
      sx={{
        m: 0,
        p: 0,
        [`& .${timelineItemClasses.root}:before`]: { flex: 0, p: 0 },
        // Guarantee the connector lines a minimal visible height — content
        // otherwise fills the item and collapses the connector to 0.
        [`& .${timelineConnectorClasses.root}`]: { minHeight: 12 },
      }}
    >
      {parts.map((part, index) => {
        const isLast = index === parts.length - 1
        return (
          <TimelineItem key={keyFor(part, index)} sx={{ minHeight: 32, minWidth: 0 }}>
            <TimelineSeparator>
              <TimelineDot color={dotColorForPart(part)} variant={dotVariantForPart(part)} />
              {isLast ? null : <TimelineConnector />}
            </TimelineSeparator>
            {/* minWidth:0 + overflow lets a wide child (e.g. the confirmation's
                JSON <pre>) scroll inside its box instead of stretching the rail
                past the chat content width. */}
            <TimelineContent sx={{ minWidth: 0, overflow: 'hidden', pb: 0.5, pt: 0 }}>
              {renderPartBody(part)}
            </TimelineContent>
          </TimelineItem>
        )
      })}
    </Timeline>
  )
}
