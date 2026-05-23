'use client'

import CheckIcon from '@mui/icons-material/Check'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import { Box, IconButton, MenuItem, Select, ToggleButton, ToggleButtonGroup, Tooltip } from '@mui/material'
import type { SelectChangeEvent } from '@mui/material'
import { useTheme } from '@mui/material/styles'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/react'
import { useCallback, useEffect, useState } from 'react'
import { renderMermaid, type RenderResult } from '@repo/mermaid/render-mermaid'
import { renderPlantuml } from '@repo/plantuml/render-plantuml'

type CodeLanguage = { value: string; label: string }

// Curated list for the in-block language picker. '' = Авто (lowlight auto-detects
// via highlightAuto). Mermaid and PlantUML also get the Код↔Просмотр preview toggle.
export const CODE_LANGUAGES: CodeLanguage[] = [
  { value: '', label: 'Авто' },
  { value: 'bash', label: 'Bash' },
  { value: 'json', label: 'JSON' },
  { value: 'yaml', label: 'YAML' },
  { value: 'python', label: 'Python' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'sql', label: 'SQL' },
  { value: 'html', label: 'HTML' },
  { value: 'css', label: 'CSS' },
  { value: 'xml', label: 'XML' },
  { value: 'mermaid', label: 'Mermaid' },
  { value: 'plantuml', label: 'PlantUML' },
]

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

function LanguageSelect({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  // Map an unknown stored language onto 'Авто' so MUI doesn't warn about an out-of-range value.
  const current = CODE_LANGUAGES.some((lang) => lang.value === value) ? value : ''
  return (
    <Select
      size="small"
      variant="standard"
      value={current}
      onChange={(event: SelectChangeEvent) => onChange(event.target.value)}
      aria-label="Язык подсветки"
      sx={{
        fontSize: '0.7rem',
        bgcolor: 'background.paper',
        borderRadius: 1,
        '&::before, &::after': { display: 'none' },
        '& .MuiSelect-select': { py: 0.25, pl: 0.75, pr: '20px !important' },
      }}
    >
      {CODE_LANGUAGES.map((lang) => (
        <MenuItem key={lang.value || 'auto'} value={lang.value} sx={{ fontSize: '0.8rem' }}>
          {lang.label}
        </MenuItem>
      ))}
    </Select>
  )
}

function CodeBlockView({ node, updateAttributes }: NodeViewProps) {
  const isMermaid = node.attrs.language === 'mermaid'
  const isPlantuml = node.attrs.language === 'plantuml'
  const isDiagram = isMermaid || isPlantuml
  const mode = useTheme().palette.mode
  const source = node.textContent
  // Default an existing (non-empty) block to the rendered preview; a freshly
  // inserted empty block opens in Код so the author can type the source first.
  const [view, setView] = useState<'code' | 'preview'>(() => (source.trim() ? 'preview' : 'code'))
  const [svg, setSvg] = useState('')
  const [error, setError] = useState<string | null>(null)
  const showPreview = isDiagram && view === 'preview'

  useEffect(() => {
    if (!showPreview) return
    let cancelled = false
    // mermaid renders client-side; plantuml renders server-side via the proxy
    // (renderPlantuml POSTs to /api/plantuml/render). Fresh id per render avoids
    // mermaid's "element already exists" error across repeated renders.
    const render = isPlantuml ? renderPlantuml : renderMermaid
    const renderId = `cb-diagram-${Math.random().toString(36).slice(2)}`
    void render(renderId, source, mode).then((result: RenderResult) => {
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
  }, [showPreview, isPlantuml, source, mode])

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
        <LanguageSelect
          value={(node.attrs.language as string | null) ?? ''}
          onChange={(next) => updateAttributes({ language: next || null })}
        />
        {isDiagram && (
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
 * CodeBlockLowlight + a React node view: every block gets a language picker and a
 * copy button; `language === 'mermaid'` additionally gets a Код↔Просмотр toggle
 * that renders the diagram client-side (renderMermaid). PlantUML uses the same
 * preview toggle through the render proxy. With language 'Авто' (null), lowlight
 * auto-detects via highlightAuto over `common`.
 */
export const CodeBlock = CodeBlockLowlight.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockView)
  },
})
