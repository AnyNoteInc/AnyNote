'use client'

// The Space-bar AI drafting bar (spec §3). Opened by the SpaceAI extension when
// Space is pressed on an empty top-level paragraph. The bar owns the controls
// (instruction input, suggestions, stop/accept/retry/follow-up); the draft text
// itself streams as the InlineAI plugin's in-document 'generate' decoration
// (inline-ai-popover.tsx renders that branch without a toolbar).
//
// Popper (not Popover) is deliberate: NO backdrop → click-away does NOT discard
// the draft (spec §3.4). Esc discards.

import CloseIcon from '@mui/icons-material/Close'
import SendIcon from '@mui/icons-material/Send'
import StopIcon from '@mui/icons-material/Stop'
import {
  Box,
  Button,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  Paper,
  Popper,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import type { Editor } from '@tiptap/core'
import { useEffect, useRef, useState } from 'react'

import {
  appendInlineAiToken,
  clearInlineAiPreview,
  failInlineAiPreview,
  finishInlineAiPreview,
  getInlineAiPreview,
  startInlineAiPreview,
} from '../extensions/inline-ai'
import type { SpaceAiTriggerArgs } from '../extensions/space-ai'
import { markdownToHtml } from '../lib/markdown-to-html'
import type { AskAIHandle, AskAiHistoryTurn, GenerateAICallback } from '../types'

const CONTEXT_BEFORE_CHARS = 8_000
/** Server cap is 10 turns — keep the newest 8 (matches the popover follow-up). */
const MAX_CLIENT_HISTORY_TURNS = 8

/** Empty-input suggestions (Notion's Draft-with-AI pattern, spec §3.2). */
const SUGGESTIONS: Array<{
  id: string
  label: string
  prefill?: string
  instruction?: string // self-sufficient → submits directly
}> = [
  {
    id: 'continue',
    label: 'Продолжить текст',
    instruction: 'Продолжи текст, сохраняя стиль и тему.',
  },
  {
    id: 'brainstorm',
    label: 'Мозговой штурм идей на тему…',
    prefill: 'Составь список идей на тему ',
  },
  { id: 'outline', label: 'План документа на тему…', prefill: 'Составь план документа на тему ' },
  { id: 'write', label: 'Написать текст о…', prefill: 'Напиши текст о ' },
]

type Phase = 'input' | 'streaming' | 'done' | 'error'

type Props = Readonly<{
  editor: Editor
  open: boolean
  anchor: SpaceAiTriggerArgs | null
  generateAI: GenerateAICallback | null
  onClose: () => void
}>

/** Two nested rAFs — the deferModalInsert contract from anynote-editor.tsx:
 *  inserting synchronously after async UI produces transactions y-prosemirror
 *  never syncs to Yjs (nodes lost on reload). Local copy: the original is
 *  module-private to anynote-editor. */
function deferInsert(run: () => void): void {
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => requestAnimationFrame(run))
  } else {
    setTimeout(run, 0)
  }
}

export function SpaceAiBar({ editor, open, anchor, generateAI, onClose }: Props) {
  const [phase, setPhase] = useState<Phase>('input')
  const [instruction, setInstruction] = useState('')
  const [followup, setFollowup] = useState('')
  const [error, setError] = useState<string | null>(null)
  const historyRef = useRef<AskAiHistoryTurn[]>([])
  const lastInstructionRef = useRef('')
  const handleRef = useRef<AskAIHandle | null>(null)
  const runTokenRef = useRef(0)

  // Reset per open.
  useEffect(() => {
    if (!open) return
    setPhase('input')
    setInstruction('')
    setFollowup('')
    setError(null)
    historyRef.current = []
    lastInstructionRef.current = ''
  }, [open, anchor])

  const abortRun = () => {
    runTokenRef.current += 1
    handleRef.current?.abort()
    handleRef.current = null
  }

  const discardAndClose = () => {
    abortRun()
    if (!editor.isDestroyed) clearInlineAiPreview(editor)
    onClose()
  }

  const currentDraftPos = (): number => {
    const preview = getInlineAiPreview(editor)
    if (preview.active) return preview.from
    return anchor?.pos ?? 0
  }

  const run = (nextInstruction: string, history: AskAiHistoryTurn[]) => {
    if (!generateAI || editor.isDestroyed) return
    const pos = currentDraftPos()
    const contextBefore = editor.state.doc
      .textBetween(0, Math.max(0, Math.min(pos, editor.state.doc.content.size)), '\n')
      .slice(-CONTEXT_BEFORE_CHARS)

    abortRun()
    const myToken = runTokenRef.current
    const isCurrent = () => runTokenRef.current === myToken

    // (Re)start the in-document pending draft at the live-mapped position.
    clearInlineAiPreview(editor)
    startInlineAiPreview(editor, { from: pos, to: pos, action: 'generate' })
    setPhase('streaming')
    setError(null)
    lastInstructionRef.current = nextInstruction

    const handle = generateAI({ instruction: nextInstruction, history, contextBefore })
    handleRef.current = handle
    handle.onToken((delta) => {
      if (editor.isDestroyed || !isCurrent()) return
      appendInlineAiToken(editor, delta)
    })
    handle.onError((message) => {
      if (editor.isDestroyed || !isCurrent()) return
      failInlineAiPreview(editor, message)
      setError(message)
      setPhase('error')
    })
    void handle.done.then(() => {
      if (editor.isDestroyed || !isCurrent()) return
      const current = getInlineAiPreview(editor)
      if (current.active && current.status === 'streaming') {
        finishInlineAiPreview(editor)
        setPhase('done')
      }
    })
  }

  const submitInstruction = (value: string) => {
    const trimmed = value.trim()
    if (!trimmed) return
    run(trimmed, historyRef.current)
  }

  const submitFollowup = () => {
    const trimmed = followup.trim()
    if (!trimmed) return
    const preview = getInlineAiPreview(editor)
    historyRef.current = [
      ...historyRef.current,
      { role: 'user' as const, content: lastInstructionRef.current },
      { role: 'assistant' as const, content: preview.text },
    ].slice(-MAX_CLIENT_HISTORY_TURNS)
    setFollowup('')
    run(trimmed, historyRef.current)
  }

  const retry = () => run(lastInstructionRef.current, historyRef.current)

  const accept = () => {
    const preview = getInlineAiPreview(editor)
    if (!preview.active || !preview.text || editor.isDestroyed) return
    const html = markdownToHtml(preview.text)
    const from = preview.from
    abortRun()
    clearInlineAiPreview(editor)
    onClose()
    deferInsert(() => {
      if (editor.isDestroyed) return
      const doc = editor.state.doc
      const $pos = doc.resolve(Math.max(0, Math.min(from, doc.content.size)))
      // Replace the (still empty) trigger paragraph with the parsed blocks.
      const start = $pos.depth >= 1 ? $pos.before(1) : 0
      const end = $pos.depth >= 1 ? $pos.after(1) : doc.content.size
      editor.chain().focus().insertContentAt({ from: start, to: end }, html).run()
    })
  }

  if (!open || !anchor || !generateAI) return null

  const anchorEl = { getBoundingClientRect: () => anchor.getRect() }
  const showSuggestions = phase === 'input' && instruction.trim().length === 0

  return (
    <Popper
      open
      anchorEl={anchorEl}
      placement="bottom-start"
      style={{ zIndex: 12 }}
      modifiers={[{ name: 'offset', options: { offset: [0, 6] } }]}
    >
      <Paper
        elevation={6}
        sx={{ width: 480, maxWidth: '90vw', p: 1 }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            discardAndClose()
          }
        }}
        data-testid="space-ai-bar"
      >
        {phase === 'input' || phase === 'error' ? (
          <Stack direction="row" spacing={0.5} alignItems="center">
            <TextField
              autoFocus
              fullWidth
              size="small"
              placeholder="Напишите, что сгенерировать…"
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  submitInstruction(instruction)
                }
              }}
              slotProps={{
                htmlInput: { 'data-testid': 'space-ai-input', 'aria-label': 'Инструкция для AI' },
              }}
            />
            <IconButton
              size="small"
              aria-label="Сгенерировать"
              onClick={() => submitInstruction(instruction)}
            >
              <SendIcon fontSize="small" />
            </IconButton>
            <IconButton size="small" aria-label="Закрыть" onClick={discardAndClose}>
              <CloseIcon fontSize="small" />
            </IconButton>
          </Stack>
        ) : null}

        {error ? (
          <Typography variant="caption" color="error" sx={{ px: 1 }} data-testid="space-ai-error">
            {error}
          </Typography>
        ) : null}

        {showSuggestions ? (
          <List dense disablePadding sx={{ mt: 0.5 }}>
            {SUGGESTIONS.map((s) => (
              <ListItemButton
                key={s.id}
                dense
                onClick={() => {
                  if (s.instruction) submitInstruction(s.instruction)
                  else setInstruction(s.prefill ?? '')
                }}
                data-testid={`space-ai-suggestion-${s.id}`}
              >
                <ListItemText primary={s.label} />
              </ListItemButton>
            ))}
          </List>
        ) : null}

        {phase === 'streaming' ? (
          <Stack direction="row" spacing={1} alignItems="center" sx={{ px: 1, py: 0.5 }}>
            <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
              Генерация…
            </Typography>
            <IconButton
              size="small"
              aria-label="Остановить"
              onClick={() => {
                abortRun()
                if (!editor.isDestroyed) {
                  const current = getInlineAiPreview(editor)
                  if (current.active) finishInlineAiPreview(editor)
                }
                setPhase('done')
              }}
            >
              <StopIcon fontSize="small" />
            </IconButton>
          </Stack>
        ) : null}

        {phase === 'done' ? (
          <Box sx={{ mt: 0.5 }}>
            <TextField
              fullWidth
              size="small"
              placeholder="Скажите AI, что сделать дальше…"
              value={followup}
              onChange={(e) => setFollowup(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  submitFollowup()
                }
              }}
              slotProps={{
                htmlInput: {
                  'data-testid': 'space-ai-followup',
                  'aria-label': 'Уточнить черновик',
                },
              }}
            />
            <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ mt: 0.5 }}>
              <Button size="small" onClick={discardAndClose}>
                Отклонить
              </Button>
              <Button size="small" onClick={retry}>
                Повторить
              </Button>
              <Button
                size="small"
                variant="contained"
                onClick={accept}
                data-testid="space-ai-accept"
              >
                Вставить
              </Button>
            </Stack>
          </Box>
        ) : null}
      </Paper>
    </Popper>
  )
}
