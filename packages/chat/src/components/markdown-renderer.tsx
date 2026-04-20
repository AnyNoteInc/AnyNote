"use client"

import { Box } from "@mui/material"
import ReactMarkdown from "react-markdown"
import rehypeHighlight from "rehype-highlight"
import remarkGfm from "remark-gfm"
import type { ReactElement } from "react"

export interface MarkdownRendererProps {
  text: string
}

export function MarkdownRenderer({ text }: MarkdownRendererProps): ReactElement {
  return (
    <Box
      sx={{
        "& p": { my: 1, lineHeight: 1.6 },
        "& p:first-of-type": { mt: 0 },
        "& p:last-of-type": { mb: 0 },
        "& ul, & ol": { my: 1, pl: 3 },
        "& code": {
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: "0.9em",
          px: 0.5,
          borderRadius: 0.5,
          bgcolor: "action.hover",
        },
        "& pre": {
          my: 1,
          p: 1.5,
          borderRadius: 1,
          bgcolor: "action.hover",
          overflowX: "auto",
        },
        "& pre code": { bgcolor: "transparent", px: 0 },
        "& a": { color: "primary.main", textDecoration: "underline" },
        "& blockquote": {
          borderLeft: 3,
          borderColor: "divider",
          pl: 1.5,
          color: "text.secondary",
        },
      }}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          a: (props) => <a {...props} target="_blank" rel="noopener noreferrer" />,
        }}
      >
        {text}
      </ReactMarkdown>
    </Box>
  )
}
