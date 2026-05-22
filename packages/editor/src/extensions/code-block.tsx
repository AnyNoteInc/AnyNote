'use client'

import CheckIcon from '@mui/icons-material/Check'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import { Box, IconButton, ToggleButton, ToggleButtonGroup, Tooltip } from '@mui/material'
import { useTheme } from '@mui/material/styles'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/react'
import { useCallback, useEffect, useState } from 'react'
import { renderMermaid, type RenderResult } from '@repo/mermaid/render-mermaid'

function CopyButton({ source }: { source: string }) {
  const [copied, setCopied] = useState(false)
  const copy = useCallback(() => {
    void navigator.clipboard.writeText(source).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }, [source])
  return (
    <Tooltip title={copied ? 'Скопировано' : 'Копировать'} placement="left">
      {/* contentEditable=false + preventDefault keep the editor selection put when clicking */}
      <IconButton
        size="small"
        contentEditable={false}
        onMouseDown={(event) => event.preventDefault()}
        onClick={copy}
        aria-label="Копировать код"
        data-testid="code-block-copy"
        sx={{ color: 'text.secondary' }}
      >
        {copied ? <CheckIcon fontSize="inherit" /> : <ContentCopyIcon fontSize="inherit" />}
      </IconButton>
    </Tooltip>
  )
}

function CodeBlockView({ node }: NodeViewProps) {
  const isMermaid = node.attrs.language === 'mermaid'
  const mode = useTheme().palette.mode
  const [view, setView] = useState<'code' | 'preview'>('code')
  const [svg, setSvg] = useState('')
  const [error, setError] = useState<string | null>(null)
  const source = node.textContent
  const showPreview = isMermaid && view === 'preview'

  useEffect(() => {
    if (!showPreview) return
    let cancelled = false
    // Fresh id per render: reusing one id makes mermaid.render throw an
    // "element already exists" error across repeated renders (cf. mermaid-preview.tsx).
    const renderId = `cb-mermaid-${Math.random().toString(36).slice(2)}`
    void renderMermaid(renderId, source, mode).then((result: RenderResult) => {
      if (cancelled) return
      if (result.ok) {
        setSvg(result.svg)
        setError(null)
      } else {
        setError(result.error)
      }
    })
    return () => {
      cancelled = true
    }
  }, [showPreview, source, mode])

  return (
    <NodeViewWrapper className="anynote-code-block" data-language={node.attrs.language ?? undefined}>
      <Box
        className="anynote-code-block__toolbar"
        contentEditable={false}
        sx={{
          position: 'absolute',
          top: 6,
          right: 6,
          zIndex: 1,
          display: 'flex',
          alignItems: 'center',
          gap: 0.5,
          opacity: 0.6,
          transition: 'opacity 0.15s ease',
          '&:focus-within': { opacity: 1 },
          '.anynote-code-block:hover &': { opacity: 1 },
        }}
      >
        {isMermaid && (
          <ToggleButtonGroup
            size="small"
            exclusive
            value={view}
            onChange={(_event, next: 'code' | 'preview' | null) => {
              if (next) setView(next)
            }}
            sx={{
              bgcolor: 'background.paper',
              '& .MuiToggleButton-root': {
                px: 1,
                py: 0.25,
                fontSize: '0.7rem',
                lineHeight: 1.4,
                textTransform: 'none',
              },
            }}
          >
            <ToggleButton value="code">Код</ToggleButton>
            <ToggleButton value="preview">Просмотр</ToggleButton>
          </ToggleButtonGroup>
        )}
        <CopyButton source={source} />
      </Box>

      <pre style={showPreview ? { display: 'none' } : undefined}>
        <NodeViewContent<'code'> as="code" />
      </pre>

      {showPreview && (
        <Box className="anynote-code-block__preview" contentEditable={false}>
          {error ? (
            <Box className="anynote-code-block__error">{error}</Box>
          ) : (
            <Box
              sx={{ width: '100%', display: 'flex', justifyContent: 'center' }}
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          )}
        </Box>
      )}
    </NodeViewWrapper>
  )
}

/**
 * CodeBlockLowlight + a React node view: a copy button on every block, and for
 * `language === 'mermaid'` a Код↔Просмотр toggle that renders the diagram
 * client-side (renderMermaid). lowlight auto-detects plain blocks (highlightAuto
 * over `common`), so no language picker is needed.
 */
export const CodeBlock = CodeBlockLowlight.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockView)
  },
})
