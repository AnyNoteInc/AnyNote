'use client'

import Box from '@mui/material/Box'
import ReactMarkdown from 'react-markdown'

import { ChatFileChip } from './chat-file-chip'
import { ChatServiceBlock } from './chat-service-block'
import type { ChatMessagePart } from './chat-types'

type ChatMessageContentProps = {
  parts: ChatMessagePart[]
}

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

export function ChatMessageContent({ parts }: ChatMessageContentProps) {
  const sortedParts = [...parts].sort((left, right) => getPartOrder(left) - getPartOrder(right))

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
              <ReactMarkdown>{part.text}</ReactMarkdown>
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
          return <ChatServiceBlock key={part.id} part={part} />
        }

        return null
      })}
    </Box>
  )
}
