'use client'

import Box from '@mui/material/Box'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

type MarkdownProps = Readonly<{ children: string }>

/**
 * A safe, GFM-aware markdown renderer for short bodies (the meeting summary, and
 * anywhere else a server-generated markdown string needs to render). `react-markdown`
 * does NOT render raw HTML (no `rehype-raw`), so the output is XSS-safe by default —
 * it only emits the markdown AST as React elements. The surrounding `Box` carries
 * the prose styling (matching the chat markdown look).
 */
export function Markdown({ children }: MarkdownProps) {
  return (
    <Box
      sx={{
        '& code': { bgcolor: 'action.hover', borderRadius: 1, px: 0.5, py: 0.125 },
        '& ol, & ul': { m: 0, pl: 3 },
        '& p': { m: 0 },
        '& p + p': { mt: 1 },
        '& h1, & h2, & h3, & h4': { mt: 1.5, mb: 0.5, fontWeight: 600 },
        '& pre': { bgcolor: 'grey.100', borderRadius: 2, m: 0, overflowX: 'auto', p: 1 },
        '& strong': { fontWeight: 600 },
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
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </Box>
  )
}
