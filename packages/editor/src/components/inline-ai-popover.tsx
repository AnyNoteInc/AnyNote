'use client'

// The «Спросить AI» surface (spec §4.2, plan Task 4 Step 2).
//
// Two cooperating pieces, both driven by the InlineAI extension's local
// streaming-preview plugin (inline-ai.ts) — NEVER touching Yjs until «Принять»:
//
//   1. <InlineAiPopover/> — a MUI Popover (mounted as a sibling in
//      anynote-editor.tsx, like the slash/embed popovers) anchored to the
//      captured selection. It lists the six preset actions (+ a target-language
//      sub-choice for «Перевести»). Picking an action starts the preview and
//      kicks off the injected `askAI` stream.
//
//   2. inlineAiRenderPreview — the `renderPreview` widget renderer injected into
//      the plugin. It returns a PLAIN-DOM box (the widget host is
//      kept mounted across the stream via a stable status-keyed decoration, so a
//      React root would fight the ProseMirror widget lifecycle; plain DOM with a
//      transaction listener that re-reads live plugin state is the package's
//      stated model). It shows the accumulating text + the
//      Принять/Повторить/Отклонить toolbar (and error states).
//
// Coordination: a per-editor session (held in a WeakMap) records the last
// request args + the in-flight AskAIHandle so «Повторить» can abort + re-call
// the same action without the popover being open, and so unmount can abort.

import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome'
import {
  Box,
  Divider,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Popover,
  Stack,
  Typography,
} from '@mui/material'
import SummarizeIcon from '@mui/icons-material/Summarize'
import EditNoteIcon from '@mui/icons-material/EditNote'
import SpellcheckIcon from '@mui/icons-material/Spellcheck'
import TranslateIcon from '@mui/icons-material/Translate'
import ShortTextIcon from '@mui/icons-material/ShortText'
import NotesIcon from '@mui/icons-material/Notes'
import type { Editor } from '@tiptap/core'
import { useState } from 'react'

import type { AskAICallback, AskAIArgs } from '../types'
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

  const handle = askAI(args)
  sessions.set(editor, { args, handle })

  handle.onToken((delta) => {
    if (editor.isDestroyed) return
    appendInlineAiToken(editor, delta)
  })
  handle.onError((message) => {
    if (editor.isDestroyed) return
    failInlineAiPreview(editor, message)
  })
  void handle.done.then(() => {
    if (editor.isDestroyed) return
    // `done` resolves on success / error / abort. Only flip to 'done' when we're
    // still streaming (an error already moved status to 'error'; an abort
    // typically follows a clear). The plugin's `finish` is a no-op if inactive.
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
  anchorEl: HTMLElement | { getBoundingClientRect: () => DOMRect } | null
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

  const pick = (action: ActionId, targetLang?: string) => {
    if (!captured || !askAI) {
      onClose()
      return
    }
    setLangChoice(false)
    onClose()
    runInlineAi(editor, askAI, {
      action,
      from: captured.from,
      to: captured.to,
      selectedText: captured.selectedText,
      ...(targetLang ? { targetLang } : {}),
    })
  }

  const handleClose = () => {
    setLangChoice(false)
    onClose()
  }

  return (
    <Popover
      open={open}
      anchorEl={(captured?.anchorEl ?? null) as Element | null}
      onClose={handleClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      slotProps={{ paper: { sx: { width: 260 } } }}
    >
      <Box sx={{ py: 0.5 }}>
        <Stack
          direction="row"
          alignItems="center"
          spacing={0.75}
          sx={{ px: 1.5, py: 0.75, color: 'text.secondary' }}
        >
          <AutoAwesomeIcon fontSize="small" color="primary" />
          <Typography variant="subtitle2">Спросить AI</Typography>
        </Stack>
        <Divider />
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
      </Box>
    </Popover>
  )
}

// --- the streaming-preview widget (plain DOM, live-updated) ------------------

const ERROR_STATUS = 'error'

/**
 * The `renderPreview` injected into the InlineAI plugin. Returns a plain-DOM box
 * that paints the accumulating text + the accept/retry/discard toolbar, and keeps
 * itself in sync with the live plugin state via a transaction listener (the
 * widget host node is reused across the stream, so we must update imperatively —
 * the package keys the decoration on `status` precisely so the host stays
 * mounted; see inline-ai.ts). Cleans up when the preview goes inactive / the view
 * is destroyed. The plugin supplies the live `editor` per render, so no editor is
 * needed at construction time (it runs inside buildExtensions, before useEditor).
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
  const retryBtn = makeButton('Повторить')
  const discardBtn = makeButton('Отклонить')
  toolbar.append(acceptBtn, retryBtn, discardBtn)

  acceptBtn.addEventListener('mousedown', (e) => e.preventDefault())
  retryBtn.addEventListener('mousedown', (e) => e.preventDefault())
  discardBtn.addEventListener('mousedown', (e) => e.preventDefault())

  acceptBtn.addEventListener('click', () => {
    if (editor.isDestroyed) return
    sessions.get(editor)?.handle.abort()
    sessions.delete(editor)
    applyInlineAiResult(editor)
  })
  retryBtn.addEventListener('click', () => {
    if (editor.isDestroyed) return
    retryInlineAi(editor, askAI)
  })
  discardBtn.addEventListener('click', () => discardInlineAi(editor))

  const paint = (s: InlineAiPreviewState) => {
    host.dataset.status = s.status
    if (s.status === ERROR_STATUS) {
      body.textContent = s.error || 'Ошибка ИИ'
      body.dataset.error = 'true'
    } else {
      body.textContent = s.text
      delete body.dataset.error
    }
    // Accept only makes sense once there's text and we're not still erroring.
    const canAccept = s.status !== ERROR_STATUS && s.text.length > 0
    acceptBtn.toggleAttribute('disabled', !canAccept)
    acceptBtn.style.display = s.status === ERROR_STATUS ? 'none' : ''
  }

  paint(state)

  // Live updates: re-read the plugin state on every transaction. The widget's
  // host node is reused, so renderPreview is NOT re-invoked per token — we own
  // the in-place update.
  const onTransaction = () => {
    if (editor.isDestroyed) {
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
