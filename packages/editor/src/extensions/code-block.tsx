'use client'

import CheckIcon from '@mui/icons-material/Check'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import { IconButton, Tooltip } from '@mui/material'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/react'
import { useCallback, useState } from 'react'

function CodeBlockView({ node }: NodeViewProps) {
  const [copied, setCopied] = useState(false)

  const copy = useCallback(() => {
    void navigator.clipboard.writeText(node.textContent).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }, [node.textContent])

  return (
    <NodeViewWrapper className="anynote-code-block">
      <Tooltip title={copied ? 'Скопировано' : 'Копировать'} placement="left">
        {/* contentEditable=false + preventDefault keep the editor selection put when clicking */}
        <IconButton
          size="small"
          contentEditable={false}
          onMouseDown={(event) => event.preventDefault()}
          onClick={copy}
          aria-label="Копировать код"
          data-testid="code-block-copy"
          sx={{
            position: 'absolute',
            top: 6,
            right: 6,
            zIndex: 1,
            color: 'text.secondary',
            bgcolor: 'background.paper',
            opacity: 0.6,
            transition: 'opacity 0.15s ease',
            '&:hover': { opacity: 1, bgcolor: 'background.paper' },
            '.anynote-code-block:hover &': { opacity: 1 },
          }}
        >
          {copied ? <CheckIcon fontSize="inherit" /> : <ContentCopyIcon fontSize="inherit" />}
        </IconButton>
      </Tooltip>
      <pre>
        <NodeViewContent<'code'> as="code" />
      </pre>
    </NodeViewWrapper>
  )
}

/**
 * CodeBlockLowlight + a React node view that adds a copy button. lowlight
 * highlighting is unchanged: with no language set the plugin auto-detects
 * (`highlightAuto`) across the registered `common` languages.
 */
export const CodeBlock = CodeBlockLowlight.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockView)
  },
})
