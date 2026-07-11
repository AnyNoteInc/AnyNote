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
import { useCallback, useEffect, useRef, useState } from 'react'

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
import { abortInlineAiSession } from './inline-ai-popover'

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

  // Touches refs only → stable identity, safe in effect dep arrays.
  const abortRun = useCallback(() => {
    runTokenRef.current += 1
    handleRef.current?.abort()
    handleRef.current = null
  }, [])

  // Reset per open. A re-trigger while a previous run is still active must
  // supersede it (token bump + abort) AND clear its leftover in-document
  // preview — otherwise the stale done-flip lands under the user's fingers,
  // «Повторить» replays an empty instruction, and currentDraftPos() aims the
  // new draft at the OLD position.
  useEffect(() => {
    if (!open) return
    abortRun()
    // Clears any leftover preview AND aborts the 9D selection-AI in-flight
    // stream if one was running (cross-surface supersession — the plugin has a
    // single preview slot). Internally guards editor.isDestroyed.
    abortInlineAiSession(editor)
    setPhase('input')
    setInstruction('')
    setFollowup('')
    setError(null)
    historyRef.current = []
    lastInstructionRef.current = ''
  }, [open, anchor, editor, abortRun])

  // Abort any in-flight stream on unmount (e.g. page navigation mid-draft).
  useEffect(
    () => () => {
      handleRef.current?.abort()
    },
    [],
  )

  const discardAndClose = useCallback(() => {
    abortRun()
    if (!editor.isDestroyed) clearInlineAiPreview(editor)
    onClose()
  }, [abortRun, editor, onClose])

  // Esc must discard from ANY focus target (spec §3.4). After submit the
  // instruction input UNMOUNTS (phase → streaming) and focus falls to <body>,
  // so the Paper's onKeyDown alone never sees the key during streaming/done —
  // exactly the phases where the draft is on screen. Bubble-phase document
  // listener: an Escape handled (and stopPropagation'd) inside the Paper never
  // reaches it, so inside-bar Esc still discards exactly once.
  useEffect(() => {
    if (!open) return
    const onDocKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // Already consumed elsewhere (e.g. a ProseMirror handleKeyDown closing
      // the slash menu preventDefaults without stopPropagation) → not ours.
      if (e.defaultPrevented) return
      e.preventDefault()
      discardAndClose()
    }
    document.addEventListener('keydown', onDocKeyDown)
    return () => document.removeEventListener('keydown', onDocKeyDown)
  }, [open, discardAndClose])

  const currentDraftPos = (): number => {
    const preview = getInlineAiPreview(editor)
    if (preview.active) return preview.from
    return anchor?.pos ?? 0
  }

  const run = (nextInstruction: string, history: AskAiHistoryTurn[]) => {
    if (!nextInstruction) return
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
      } else if (!current.active) {
        // The draft slot was cleared by another surface (cross-surface
        // supersession, e.g. a selection-AI run) — close rather than strand
        // the bar in a spinner with no draft behind it.
        onClose()
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
    abortRun()
    onClose()
    deferInsert(() => {
      if (editor.isDestroyed) return
      // Re-read the position INSIDE the deferred callback: the preview stays
      // active across the two-rAF gap, so the plugin's drift guard keeps
      // re-mapping `from` through concurrent (remote) transactions right up to
      // the moment of insert. Clearing before the defer would freeze a stale
      // offset.
      const live = getInlineAiPreview(editor)
      const from = live.active ? live.from : null
      clearInlineAiPreview(editor)
      if (from === null) return
      const doc = editor.state.doc
      const $pos = doc.resolve(Math.max(0, Math.min(from, doc.content.size)))
      // Replace the (still empty) trigger paragraph with the parsed blocks.
      const start = $pos.depth >= 1 ? $pos.before(1) : 0
      const end = $pos.depth >= 1 ? $pos.after(1) : doc.content.size
      editor.chain().focus().insertContentAt({ from: start, to: end }, html).run()
    })
  }

  if (!open || !anchor || !generateAI) return null

  // getRect's doc contract: a zero rect (width + height 0) means the trigger
  // position is gone — treat as unanchored and don't pin the bar at the
  // viewport origin. A live caret rect always has height > 0.
  const rect = anchor.getRect()
  if (rect.width === 0 && rect.height === 0) return null

  const anchorEl = { getBoundingClientRect: () => anchor.getRect() }
  const showSuggestions = phase === 'input' && instruction.trim().length === 0
  // Final once phase === 'done' (the component re-renders on the phase flip).
  const hasDraftText = !editor.isDestroyed && getInlineAiPreview(editor).text.length > 0

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
        role="dialog"
        aria-label="AI-генерация"
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
          <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
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
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', px: 1, py: 0.5 }}>
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
            <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end', mt: 0.5 }}>
              <Button size="small" onClick={discardAndClose}>
                Отклонить
              </Button>
              <Button size="small" onClick={retry}>
                Повторить
              </Button>
              <Button
                size="small"
                variant="contained"
                disabled={!hasDraftText}
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
