'use client'

// The «Спросить AI» surface (spec §4.2, plan Task 4 Step 2).
//
// Two cooperating pieces, both driven by the InlineAI extension's local
// streaming-preview plugin (inline-ai.ts) — NEVER touching Yjs until «Принять»:
//
//   1. <InlineAiPopover/> — a MUI Popover (mounted as a sibling in
//      anynote-editor.tsx, like the slash/embed popovers) anchored to the
//      captured selection. Notion layout (spec §5): a free-form instruction
//      input on top (Enter → the 'custom' action), the six preset actions below
//      (+ a target-language sub-choice for «Перевести»). Picking either starts
//      the preview and kicks off the injected `askAI` stream.
//
//   2. inlineAiRenderPreview — the `renderPreview` widget renderer injected into
//      the plugin. It returns a PLAIN-DOM box (the widget host is
//      kept mounted across the stream via a stable status-keyed decoration, so a
//      React root would fight the ProseMirror widget lifecycle; plain DOM with a
//      transaction listener that re-reads live plugin state is the package's
//      stated model). It shows the accumulating text + the Принять/Вставить
//      ниже/Повторить/Отклонить toolbar, a follow-up refinement input (visible
//      once done), and error states. The Space-bar 'generate' action gets a
//      reduced block-level draft branch with NO toolbar (the bar owns controls).
//
// Coordination: a per-editor session (held in a WeakMap) records the last
// request args + the in-flight AskAIHandle so «Повторить» can abort + re-call
// the same action without the popover being open, and so unmount can abort.

import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome'
import {
  Box,
  ClickAwayListener,
  Divider,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Paper,
  Popper,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import SummarizeIcon from '@mui/icons-material/Summarize'
import EditNoteIcon from '@mui/icons-material/EditNote'
import SpellcheckIcon from '@mui/icons-material/Spellcheck'
import TranslateIcon from '@mui/icons-material/Translate'
import ShortTextIcon from '@mui/icons-material/ShortText'
import NotesIcon from '@mui/icons-material/Notes'
import type { Editor } from '@tiptap/core'
import { useEffect, useState } from 'react'

import type { AskAICallback, AskAIArgs, VirtualAnchor } from '../types'
import {
  appendInlineAiToken,
  applyInlineAiResult,
  clearInlineAiPreview,
  failInlineAiPreview,
  finishInlineAiPreview,
  getInlineAiPreview,
  startInlineAiPreview,
  type InlineAiPreviewState,
  type InlineAiRenderPreview,
} from '../extensions/inline-ai'

// --- preset action catalogue ------------------------------------------------

type ActionId = 'summarize' | 'rewrite' | 'grammar' | 'translate' | 'shorten' | 'expand'

type ActionDef = {
  id: ActionId
  label: string
  icon: typeof SummarizeIcon
}

const ACTIONS: ActionDef[] = [
  { id: 'summarize', label: 'Кратко', icon: SummarizeIcon },
  { id: 'rewrite', label: 'Переписать', icon: EditNoteIcon },
  { id: 'grammar', label: 'Грамматика', icon: SpellcheckIcon },
  { id: 'translate', label: 'Перевести', icon: TranslateIcon },
  { id: 'shorten', label: 'Короче', icon: ShortTextIcon },
  { id: 'expand', label: 'Подробнее', icon: NotesIcon },
]

const TARGET_LANGS = ['English', 'Русский', 'Deutsch', 'Français', 'Español', '中文'] as const

// --- per-editor session (popover ↔ widget toolbar coordination) -------------

type InlineAiSession = {
  args: AskAIArgs
  handle: { abort: () => void }
  // Monotonic run token (the active run for this editor). Each (re)run bumps it;
  // the AskAIHandle callbacks captured a token at run-start and no-op when it no
  // longer matches — so a superseded run (retry / re-pick) can't leak a late
  // token, error, or `done`-flip into the NEW in-flight preview.
  token: number
}

const sessions = new WeakMap<Editor, InlineAiSession>()

/**
 * Capture-then-stream: start the local preview over the captured range, call the
 * injected `askAI`, and wire the AskAIHandle's callbacks into the plugin metas.
 * Records the session so «Повторить» can re-run the same action.
 */
function runInlineAi(editor: Editor, askAI: AskAICallback, args: AskAIArgs): void {
  if (editor.isDestroyed) return
  // Abort any prior in-flight request for this editor (retry / re-pick).
  sessions.get(editor)?.handle.abort()

  startInlineAiPreview(editor, { from: args.from, to: args.to, action: args.action })

  // Tag this run so its async callbacks can detect being superseded by a retry /
  // re-pick. We bump the prior session's token (if any) and capture ours; a
  // callback fires only while it's still the editor's active run.
  const myToken = (sessions.get(editor)?.token ?? 0) + 1
  const isCurrent = () => sessions.get(editor)?.token === myToken

  const handle = askAI(args)
  sessions.set(editor, { args, handle, token: myToken })

  handle.onToken((delta) => {
    if (editor.isDestroyed || !isCurrent()) return
    appendInlineAiToken(editor, delta)
  })
  handle.onError((message) => {
    if (editor.isDestroyed || !isCurrent()) return
    failInlineAiPreview(editor, message)
  })
  void handle.done.then(() => {
    // `done` resolves on success / error / abort. A superseded run's `done`
    // (e.g. the OLD handle aborted by «Повторить») can resolve AFTER the new run
    // started — ignore it so it can't flip the NEW streaming preview to 'done'.
    if (editor.isDestroyed || !isCurrent()) return
    // Only flip to 'done' when we're still streaming (an error already moved
    // status to 'error'; an abort typically follows a clear). The plugin's
    // `finish` is a no-op if inactive.
    const current = getInlineAiPreview(editor)
    if (current.active && current.status === 'streaming') {
      finishInlineAiPreview(editor)
    }
  })
}

/** «Повторить» — abort the in-flight request + restream the same action. */
function retryInlineAi(editor: Editor, askAI: AskAICallback | null): void {
  if (editor.isDestroyed || !askAI) return
  const session = sessions.get(editor)
  if (!session) return
  // Re-resolve the CURRENT mapped range from live plugin state (the drift guard)
  // so a re-run targets the same content even after remote edits.
  const preview = getInlineAiPreview(editor)
  if (!preview.active) return
  runInlineAi(editor, askAI, {
    ...session.args,
    from: preview.from,
    to: preview.to,
  })
}

/** «Отклонить» / unmount — abort + clear, doc untouched. */
function discardInlineAi(editor: Editor): void {
  sessions.get(editor)?.handle.abort()
  sessions.delete(editor)
  if (!editor.isDestroyed) clearInlineAiPreview(editor)
}

// --- the action-menu popover ------------------------------------------------

export type InlineAiCapturedRange = {
  from: number
  to: number
  selectedText: string
  anchorEl: HTMLElement | VirtualAnchor | null
}

type PopoverProps = Readonly<{
  editor: Editor
  open: boolean
  captured: InlineAiCapturedRange | null
  askAI: AskAICallback | null
  onClose: () => void
}>

export function InlineAiPopover({ editor, open, captured, askAI, onClose }: PopoverProps) {
  const [langChoice, setLangChoice] = useState(false)
  const [instruction, setInstruction] = useState('')

  // Fresh free-form input per capture — the popover re-opens over a new
  // selection with the previous instruction discarded (Notion layout, spec §5).
  useEffect(() => {
    if (open) setInstruction('')
  }, [open, captured])

  // The range to act on: PREFER the plugin's live 'capturing' hold (dispatched
  // by anynote-editor's onAskAi) — its drift guard kept re-mapping the range
  // through every doc change while the popover was open. The click-time capture
  // is only the fallback (plugin inactive, e.g. a destroyed-and-recreated view).
  const heldRange = (): { from: number; to: number; selectedText: string } | null => {
    if (!captured) return null
    if (!editor.isDestroyed) {
      const held = getInlineAiPreview(editor)
      if (held.active && held.status === 'capturing') {
        return {
          from: held.from,
          to: held.to,
          selectedText: editor.state.doc.textBetween(held.from, held.to, ' '),
        }
      }
    }
    return { from: captured.from, to: captured.to, selectedText: captured.selectedText }
  }

  const submitCustom = () => {
    const trimmed = instruction.trim()
    const range = heldRange()
    if (!trimmed || !range || !askAI) return
    setLangChoice(false)
    onClose()
    runInlineAi(editor, askAI, {
      action: 'custom',
      from: range.from,
      to: range.to,
      selectedText: range.selectedText,
      instruction: trimmed,
    })
  }

  const pick = (action: ActionId, targetLang?: string) => {
    const range = heldRange()
    if (!range || !askAI) {
      dismiss()
      return
    }
    setLangChoice(false)
    onClose()
    runInlineAi(editor, askAI, {
      action,
      from: range.from,
      to: range.to,
      selectedText: range.selectedText,
      ...(targetLang ? { targetLang } : {}),
    })
  }

  // Dismissal WITHOUT picking an action (click-away / Escape): release the
  // plugin's 'capturing' hold so its highlight doesn't linger. The status guard
  // makes this safe against ordering changes — a streaming preview started by
  // pick() is never cleared here.
  const dismiss = () => {
    setLangChoice(false)
    if (!editor.isDestroyed) {
      const held = getInlineAiPreview(editor)
      if (held.active && held.status === 'capturing') clearInlineAiPreview(editor)
    }
    onClose()
  }

  if (!open || !captured?.anchorEl) return null

  return (
    // Popper (not Popover) — deliberately NON-modal, the SpaceAiBar precedent:
    // no backdrop, no focus trap (the modal Popover aria-hid the app root while
    // the editor still held focus — the console error), no scroll lock, and no
    // focus RESTORE on close (MUI restores without preventScroll, which yanked
    // the page scroll position when the tall contenteditable re-focused).
    // Click-away and Escape dismiss explicitly below.
    <Popper
      open
      anchorEl={captured.anchorEl}
      placement="bottom-start"
      style={{ zIndex: 12 }}
      modifiers={[{ name: 'offset', options: { offset: [0, 6] } }]}
    >
      <ClickAwayListener onClickAway={dismiss}>
        <Paper
          elevation={6}
          sx={{ width: 260, py: 0.5 }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              e.stopPropagation()
              dismiss()
            }
          }}
          data-testid="inline-ai-popover"
        >
          <Stack
            direction="row"
            spacing={0.75}
            sx={{
              alignItems: 'center',
              px: 1.5,
              py: 0.75,
              color: 'text.secondary',
            }}
          >
            <AutoAwesomeIcon fontSize="small" color="primary" />
            <Typography variant="subtitle2">Спросить AI</Typography>
          </Stack>
          <Box sx={{ px: 1, pt: 1 }}>
            <TextField
              autoFocus
              fullWidth
              size="small"
              placeholder="Спросите AI изменить или создать…"
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  submitCustom()
                }
              }}
              slotProps={{
                htmlInput: {
                  'data-testid': 'inline-ai-custom-input',
                  'aria-label': 'Инструкция для AI',
                },
              }}
            />
          </Box>
          <Divider sx={{ mt: 1 }} />
          {langChoice ? (
            <List dense disablePadding>
              <ListItemButton onClick={() => setLangChoice(false)} sx={{ color: 'text.secondary' }}>
                <ListItemText primary="‹ Назад" />
              </ListItemButton>
              {TARGET_LANGS.map((lang) => (
                <ListItemButton key={lang} onClick={() => pick('translate', lang)}>
                  <ListItemText primary={lang} />
                </ListItemButton>
              ))}
            </List>
          ) : (
            <List dense disablePadding>
              {ACTIONS.map((action) => {
                const Icon = action.icon
                return (
                  <ListItemButton
                    key={action.id}
                    onClick={() =>
                      action.id === 'translate' ? setLangChoice(true) : pick(action.id)
                    }
                  >
                    <ListItemIcon sx={{ minWidth: 32 }}>
                      <Icon fontSize="small" />
                    </ListItemIcon>
                    <ListItemText primary={action.label} />
                  </ListItemButton>
                )
              })}
            </List>
          )}
        </Paper>
      </ClickAwayListener>
    </Popper>
  )
}

// --- the streaming-preview widget (plain DOM, live-updated) ------------------

const ERROR_STATUS = 'error'

/** Paint the accumulated text (or the error message) into the preview body. */
const paintPreviewBody = (body: HTMLElement, s: InlineAiPreviewState): void => {
  if (s.status === ERROR_STATUS) {
    body.textContent = s.error || 'Ошибка ИИ'
    body.dataset.error = 'true'
  } else {
    body.textContent = s.text
    delete body.dataset.error
  }
}

/**
 * Live updates: re-read the plugin state on every transaction and repaint. The
 * widget's host node is reused (status-keyed decoration), so renderPreview is
 * NOT re-invoked per token — the paint callback owns the in-place update.
 * Self-unsubscribes when the preview goes inactive, the editor is destroyed, OR
 * the host left the DOM: each streaming→done status flip rebuilds the widget
 * (and a follow-up refinement loops that flip repeatedly), so without the
 * isConnected check every rebuild would strand a listener repainting a detached
 * node until the preview cleared.
 */
const subscribePreviewRepaint = (
  editor: Editor,
  host: HTMLElement,
  paint: (s: InlineAiPreviewState) => void,
): void => {
  const onTransaction = () => {
    if (editor.isDestroyed || !host.isConnected) {
      editor.off('transaction', onTransaction)
      return
    }
    const next = getInlineAiPreview(editor)
    if (!next.active) {
      editor.off('transaction', onTransaction)
      return
    }
    paint(next)
  }
  editor.on('transaction', onTransaction)
}

/**
 * The `renderPreview` injected into the InlineAI plugin. Returns a plain-DOM box
 * that paints the accumulating text + the accept/insert-below/retry/discard
 * toolbar and the follow-up refinement input, and keeps itself in sync with the
 * live plugin state via a transaction listener (the widget host node is reused
 * across the stream, so we must update imperatively — the package keys the
 * decoration on `status` precisely so the host stays mounted; see inline-ai.ts).
 * Cleans up when the preview goes inactive / the view is destroyed. The plugin
 * supplies the live `editor` per render, so no editor is needed at construction
 * time (it runs inside buildExtensions, before useEditor).
 *
 * The Space-bar `generate` action renders a REDUCED branch: a block-level draft
 * without the toolbar — the AI bar owns the controls (spec §3.3).
 */
export const inlineAiRenderPreview: InlineAiRenderPreview = ({
  state,
  editor,
}: {
  state: InlineAiPreviewState
  editor: Editor
}): HTMLElement => {
  const askAI =
    (editor.storage as unknown as { ai?: { askAI?: AskAICallback | null } }).ai?.askAI ?? null

  if (state.action === 'generate') {
    // Space-bar pending draft (spec §3.3): body only, no toolbar — accept /
    // discard / refine live in the Space AI bar, not in the widget.
    const host = document.createElement('div')
    host.className = 'anynote-inline-ai-preview anynote-inline-ai-preview--draft'
    host.contentEditable = 'false'
    host.dataset.status = state.status

    const body = document.createElement('div')
    body.className = 'anynote-inline-ai-preview__body'
    host.appendChild(body)

    const paint = (s: InlineAiPreviewState) => {
      host.dataset.status = s.status
      paintPreviewBody(body, s)
    }
    paint(state)
    subscribePreviewRepaint(editor, host, paint)
    return host
  }

  const host = document.createElement('span')
  host.className = 'anynote-inline-ai-preview'
  host.contentEditable = 'false'
  host.dataset.status = state.status

  const body = document.createElement('div')
  body.className = 'anynote-inline-ai-preview__body'
  host.appendChild(body)

  const toolbar = document.createElement('div')
  toolbar.className = 'anynote-inline-ai-preview__toolbar'
  host.appendChild(toolbar)

  const acceptBtn = makeButton('Принять', 'primary')
  const insertBelowBtn = makeButton('Вставить ниже')
  const retryBtn = makeButton('Повторить')
  const discardBtn = makeButton('Отклонить')
  toolbar.append(acceptBtn, insertBelowBtn, retryBtn, discardBtn)

  acceptBtn.addEventListener('mousedown', (e) => e.preventDefault())
  insertBelowBtn.addEventListener('mousedown', (e) => e.preventDefault())
  retryBtn.addEventListener('mousedown', (e) => e.preventDefault())
  discardBtn.addEventListener('mousedown', (e) => e.preventDefault())

  acceptBtn.addEventListener('click', () => {
    if (editor.isDestroyed) return
    sessions.get(editor)?.handle.abort()
    sessions.delete(editor)
    applyInlineAiResult(editor)
  })
  insertBelowBtn.addEventListener('click', () => {
    if (editor.isDestroyed) return
    sessions.get(editor)?.handle.abort()
    sessions.delete(editor)
    applyInlineAiResult(editor, 'insertBelow')
  })
  retryBtn.addEventListener('click', () => {
    if (editor.isDestroyed) return
    retryInlineAi(editor, askAI)
  })
  discardBtn.addEventListener('click', () => discardInlineAi(editor))

  // Follow-up refinement («Скажите AI, что сделать дальше…», spec §5): a plain
  // input shown once the stream settled. Enter re-runs as 'custom' with the
  // prior exchange folded into `history`, so the model refines its own answer.
  const followup = document.createElement('input')
  followup.className = 'anynote-inline-ai-preview__followup'
  followup.placeholder = 'Скажите AI, что сделать дальше…'
  followup.setAttribute('aria-label', 'Уточнить ответ AI')
  followup.addEventListener('mousedown', (e) => e.stopPropagation())
  followup.addEventListener('keydown', (e) => {
    e.stopPropagation()
    if (e.key !== 'Enter') return
    const value = followup.value.trim()
    if (!value || editor.isDestroyed || !askAI) return
    const session = sessions.get(editor)
    const current = getInlineAiPreview(editor)
    if (!session || !current.active) return
    // Build the refinement history: prior turns + the just-finished exchange.
    // For a preset first-run the "instruction" is the preset label; the
    // translate preset keeps its target language so the refinement context
    // doesn't silently drop it.
    const presetLabel = ACTIONS.find((a) => a.id === session.args.action)?.label
    const presetInstruction =
      presetLabel && session.args.targetLang
        ? `${presetLabel} (${session.args.targetLang})`
        : presetLabel
    const prevInstruction = session.args.instruction ?? presetInstruction ?? session.args.action
    // Trim to the LAST 8 turns (newest context wins): the server rejects
    // histories longer than 10, so unbounded growth would 400 on the 6th
    // refinement.
    const history = [
      ...(session.args.history ?? []),
      { role: 'user' as const, content: prevInstruction },
      { role: 'assistant' as const, content: current.text },
    ].slice(-8)
    runInlineAi(editor, askAI, {
      action: 'custom',
      from: current.from,
      to: current.to,
      selectedText: session.args.selectedText,
      instruction: value,
      history,
    })
  })
  host.appendChild(followup)

  const paint = (s: InlineAiPreviewState) => {
    host.dataset.status = s.status
    paintPreviewBody(body, s)
    // Accept only makes sense once there's text and we're not still erroring.
    const canAccept = s.status !== ERROR_STATUS && s.text.length > 0
    acceptBtn.toggleAttribute('disabled', !canAccept)
    acceptBtn.style.display = s.status === ERROR_STATUS ? 'none' : ''
    insertBelowBtn.toggleAttribute('disabled', !canAccept)
    insertBelowBtn.style.display = s.status === ERROR_STATUS ? 'none' : ''
    // The follow-up input appears only once the stream settled successfully.
    // paint NEVER recreates the element, so user-typed text survives repaints.
    followup.style.display = s.status === 'done' ? '' : 'none'
  }

  paint(state)
  subscribePreviewRepaint(editor, host, paint)

  return host
}

function makeButton(label: string, variant?: 'primary'): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.textContent = label
  btn.className =
    'anynote-inline-ai-preview__btn' +
    (variant === 'primary' ? ' anynote-inline-ai-preview__btn--primary' : '')
  return btn
}

export { discardInlineAi as abortInlineAiSession }
