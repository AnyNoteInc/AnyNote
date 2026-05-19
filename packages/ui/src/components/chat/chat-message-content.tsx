'use client'

import Box from '@mui/material/Box'
import type { ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'

import { ChatFileChip } from './chat-file-chip'
import { ChatServiceBlock } from './chat-service-block'
import type { ChatConfirmHandler, ChatMessagePart } from './chat-types'

export type ChatRenderLink = (href: string, children: ReactNode) => ReactNode

type ChatMessageContentProps = Readonly<{
  parts: ChatMessagePart[]
  renderLink?: ChatRenderLink
  onConfirm?: ChatConfirmHandler
}>

function getPartOrder(part: ChatMessagePart) {
  switch (part.type) {
    case 'text':
      return 0
    case 'tool':
      return 1
    case 'attacment':
      return 2
    default:
      return 3
  }
}

function linkifyWorkspacePageReferences(text: string): string {
  return text.replace(
    /(здесь)\s*:\s*(\/workspaces\/[0-9a-f-]{8}-[0-9a-f-]{4}-[0-9a-f-]{4}-[0-9a-f-]{4}-[0-9a-f-]{12}\/pages\/[0-9a-f-]{8}-[0-9a-f-]{4}-[0-9a-f-]{4}-[0-9a-f-]{4}-[0-9a-f-]{12})/giu,
    '[$1]($2)',
  )
}

// eslint-disable-next-line react/prop-types -- plugin can't unwrap Readonly<> generic
export function ChatMessageContent({ parts, renderLink, onConfirm }: ChatMessageContentProps) {
  const sortedParts = [...parts].sort((left, right) => getPartOrder(left) - getPartOrder(right))
  const markdownComponents = renderLink
    ? {
        a: ({ href, children }: { href?: string; children?: ReactNode }) =>
          href ? <>{renderLink(href, children)}</> : <>{children}</>,
      }
    : undefined

  return (
    <Box display="flex" flexDirection="column" gap={1.25}>
      {sortedParts.map((part, index) => {
        if (part.type === 'text') {
          return (
            <Box
              key={`${part.type}-${index}`}
              sx={{
                '& code': {
                  bgcolor: 'action.hover',
                  borderRadius: 1,
                  px: 0.5,
                  py: 0.125,
                },
                '& ol, & ul': {
                  m: 0,
                  pl: 3,
                },
                '& p': {
                  m: 0,
                },
                '& p + p': {
                  mt: 1,
                },
                '& pre': {
                  bgcolor: 'grey.100',
                  borderRadius: 2,
                  m: 0,
                  overflowX: 'auto',
                  p: 1,
                },
                '& strong': {
                  fontWeight: 600,
                },
                overflowWrap: 'anywhere',
              }}
            >
              <ReactMarkdown components={markdownComponents}>
                {linkifyWorkspacePageReferences(part.text)}
              </ReactMarkdown>
            </Box>
          )
        }

        if (part.type === 'attacment') {
          return (
            <ChatFileChip
              key={part.fileId}
              href={part.downloadUrl}
              name={part.name}
              secondaryLabel={part.fileSize}
            />
          )
        }

        if (part.type === 'tool') {
          return <ChatServiceBlock key={part.id} onConfirm={onConfirm} part={part} />
        }

        return null
      })}
    </Box>
  )
}
