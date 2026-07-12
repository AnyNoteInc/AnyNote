'use client'

import { Box } from '@mui/material'
import { HocuspocusProvider } from '@hocuspocus/provider'
import type { Editor } from '@tiptap/core'
import { EditorContent, ReactRenderer, useEditor } from '@tiptap/react'
import type { SuggestionKeyDownProps, SuggestionProps } from '@tiptap/suggestion'
import tippy, { type Instance } from 'tippy.js'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as Y from 'yjs'

import { DateInsertPopover } from './components/date-insert-popover'
import { EditorDragHandle } from './components/drag-handle'
import { DrawioEditorDialog } from './components/drawio-editor-dialog'
import { EmbedUrlPopover } from './components/embed-url-popover'
import { FileUploadPopover } from './components/file-upload-popover'
import { FloatingToolbar } from './components/floating-toolbar'
import {
  abortInlineAiSession,
  InlineAiPopover,
  inlineAiRenderPreview,
  type InlineAiCapturedRange,
} from './components/inline-ai-popover'
import { captureInlineAiRange, getInlineAiPreview } from './extensions/inline-ai'
import { MarkdownUploadPopover } from './components/markdown-upload-popover'
import { MentionMenuPopover } from './components/mention-menu-popover'
import type { MentionMenuPopoverHandle } from './components/mention-menu-popover'
import { PageLinkPopover } from './components/page-link-popover'
import { SlashMenuPopover } from './components/slash-menu-popover'
import type { SlashMenuPopoverHandle } from './components/slash-menu-popover'
import { SpaceAiBar } from './components/space-ai-bar'
import { TableToolbar } from './components/table-toolbar'
import { buildExtensions } from './extensions/index'
import type { SlashMenuRender } from './extensions/slash-menu'
import type { SpaceAiTriggerArgs } from './extensions/space-ai'
import { createSlashItems } from './slash-items'
import type {
  AnyNoteEditorProps,
  MentionLookupItem,
  SlashCommandItem,
  SlashRange,
  VirtualAnchor,
} from './types'

type SlashSuggestionProps = SuggestionProps<SlashCommandItem, SlashCommandItem>
type MentionSuggestionProps = SuggestionProps<MentionLookupItem, MentionLookupItem>

type YjsResources = { ydoc: Y.Doc; provider: HocuspocusProvider }

type PopoverKind =
  'date' | 'datetime' | 'file' | 'media' | 'markdown' | 'pageLink' | 'bookmark' | 'embed'

type OpenPopover = {
  kind: PopoverKind
  anchorEl: VirtualAnchor
  range: SlashRange
  // For the media popover: which inline player to insert.
  mediaKind?: 'video' | 'audio'
}

/**
 * Run an editor mutation AFTER a modal MUI Dialog has finished closing.
 *
 * The async-picker slash inserts (synced block, embedded database, meeting,
 * drawio) resolve a modal `Dialog` and then insert a node. A modal Dialog traps
 * focus and restores it to the previously-focused element asynchronously on
 * unmount. Running `editor.chain().focus().…run()` synchronously in the resolve
 * callback applies the ProseMirror transaction while that focus restore is still
 * in flight, so the y-prosemirror collab binding never observes the change — the
 * node renders locally but is absent from the persisted Yjs doc and is lost on
 * reload (the slash trigger text re-appears). Deferring a frame past the close
 * lets focus settle so the transaction syncs. (The non-modal Popover-based slash
 * inserts — date/file/media/etc. — never hit this and commit inline.)
 */
function deferModalInsert(run: () => void): void {
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => requestAnimationFrame(run))
  } else {
    setTimeout(run, 0)
  }
}

export function AnyNoteEditor(props: AnyNoteEditorProps) {
  const { pageId, yjsUrl, yjsToken, initialContentYjs } = props
  const [resources, setResources] = useState<YjsResources | null>(null)

  // Create Y.Doc + provider inside useEffect so React StrictMode's
  // mount → unmount → remount cycle gets fresh resources on the second
  // mount (otherwise we'd keep using destroyed objects).
  useEffect(() => {
    const ydoc = new Y.Doc()
    if (initialContentYjs) {
      const bytes = Uint8Array.from(atob(initialContentYjs), (c) => c.charCodeAt(0))
      Y.applyUpdate(ydoc, bytes)
    }
    const provider = new HocuspocusProvider({
      url: yjsUrl,
      name: pageId,
      document: ydoc,
      token: yjsToken,
    })
    setResources({ ydoc, provider })
    return () => {
      setResources(null)
      // Defer destroy so an in-flight WebSocket handshake can complete
      // before we close the socket. Prevents the browser warning
      // "WebSocket is closed before the connection is established" during
      // React StrictMode dev remounts.
      setTimeout(() => {
        provider.destroy()
        ydoc.destroy()
      }, 300)
    }
  }, [pageId, yjsUrl, yjsToken, initialContentYjs])

  if (!resources) {
    return (
      props.loadingFallback ?? (
        <Box className={`anynote-editor ${props.className ?? ''}`} sx={{ height: '100%' }} />
      )
    )
  }
  return <AnyNoteEditorInner {...props} resources={resources} />
}

function AnyNoteEditorInner(props: AnyNoteEditorProps & { resources: YjsResources }) {
  const {
    user,
    uploadHandler,
    workspaceId,
    pageSearch,
    mentionSearch,
    onNavigateToPage,
    editable = true,
    resources,
  } = props
  const { ydoc, provider } = resources
  // Capability-aware empty-line hint: with the space-bar drafting bridge wired
  // the placeholder advertises it (spec §3.1); otherwise the classic slash hint.
  const placeholder =
    props.placeholder ??
    (props.generateAI ? 'Нажмите «пробел» для AI или «/» — для команд' : "Введите '/' для команд")

  const [popover, setPopover] = useState<OpenPopover | null>(null)
  const [drawioCreate, setDrawioCreate] = useState<{ range: SlashRange } | null>(null)
  // The inline-AI action popover: opened by the «Спросить AI» bubble-menu button
  // with the selection captured BEFORE the click (the toolbar passes the range +
  // text + anchor rect via editor.storage.ai.onAskAi).
  const [aiCapture, setAiCapture] = useState<InlineAiCapturedRange | null>(null)
  // The space-bar AI drafting bar: opened by the SpaceAI extension via
  // editor.storage.ai.onSpaceAi when Space hits an empty top-level paragraph.
  const [spaceAi, setSpaceAi] = useState<SpaceAiTriggerArgs | null>(null)

  const slashClientRectRef = useRef<() => DOMRect>(() => new DOMRect(0, 0, 0, 0))

  type SlashMenuRenderer = ReactRenderer<
    SlashMenuPopoverHandle,
    {
      items: SlashCommandItem[]
      command: (item: SlashCommandItem) => void
    }
  >

  const slashRendererRef = useRef<{
    component: SlashMenuRenderer | null
    popup: Instance | null
  }>({ component: null, popup: null })

  type MentionMenuRenderer = ReactRenderer<
    MentionMenuPopoverHandle,
    {
      items: MentionLookupItem[]
      command: (item: MentionLookupItem) => void
    }
  >

  const mentionRendererRef = useRef<{
    component: MentionMenuRenderer | null
    popup: Instance | null
  }>({ component: null, popup: null })

  const openKind = useCallback((kind: PopoverKind, range: SlashRange) => {
    const rect = slashClientRectRef.current()
    slashRendererRef.current.popup?.hide()
    setPopover({
      kind,
      range,
      anchorEl: { nodeType: 1, getBoundingClientRect: () => rect },
    })
  }, [])

  const openMedia = useCallback((range: SlashRange, mediaKind: 'video' | 'audio') => {
    const rect = slashClientRectRef.current()
    slashRendererRef.current.popup?.hide()
    setPopover({
      kind: 'media',
      range,
      mediaKind,
      anchorEl: { nodeType: 1, getBoundingClientRect: () => rect },
    })
  }, [])

  const closePopover = useCallback(() => setPopover(null), [])

  const openDrawioCreate = useCallback((range: SlashRange) => {
    slashRendererRef.current.popup?.hide()
    setDrawioCreate({ range })
  }, [])

  // Deferred ref to the live editor so the database-picker slash handler (which
  // resolves an async dialog before inserting) can reach it without re-creating
  // `slashItems` on every editor identity change.
  const editorInstanceRef = useRef<Editor | null>(null)

  const onPickEmbeddedDatabase = props.onPickEmbeddedDatabase
  const openDatabasePicker = useMemo(() => {
    if (!onPickEmbeddedDatabase) return undefined
    return (range: SlashRange) => {
      slashRendererRef.current.popup?.hide()
      void onPickEmbeddedDatabase().then((pick) => {
        const ed = editorInstanceRef.current
        if (!ed || !pick) return
        deferModalInsert(() =>
          ed
            .chain()
            .focus()
            .deleteRange(range)
            .insertContent({
              type: 'embeddedDatabase',
              attrs: {
                sourceId: pick.sourceId,
                viewId: pick.viewId,
                displayMode: 'table',
                readonly: false,
              },
            })
            .run(),
        )
      })
    }
  }, [onPickEmbeddedDatabase])

  const onPickSyncedBlock = props.onPickSyncedBlock
  const openSyncedBlockPicker = useMemo(() => {
    if (!onPickSyncedBlock) return undefined
    return (range: SlashRange) => {
      slashRendererRef.current.popup?.hide()
      void onPickSyncedBlock().then((pick) => {
        const ed = editorInstanceRef.current
        if (!ed || !pick) return
        // Defer past the modal Dialog's close/focus-restore (it traps focus and
        // restores it asynchronously on unmount). Inserting synchronously here
        // applies the transaction to a view whose selection is mid-restore, so
        // y-prosemirror never syncs it to the Yjs doc and the node is lost on
        // reload — see deferModalInsert.
        deferModalInsert(() =>
          ed
            .chain()
            .focus()
            .deleteRange(range)
            .insertContent({ type: 'syncedBlock', attrs: { blockId: pick.blockId } })
            .run(),
        )
      })
    }
  }, [onPickSyncedBlock])

  const onPickMeetingBlock = props.onPickMeetingBlock
  const openMeetingPicker = useMemo(() => {
    if (!onPickMeetingBlock) return undefined
    return (range: SlashRange) => {
      slashRendererRef.current.popup?.hide()
      void onPickMeetingBlock().then((pick) => {
        const ed = editorInstanceRef.current
        // A null pick = cancelled, OR the user uploaded a NEW meeting (the upload
        // dialog navigates to the fresh MEETING page) — nothing to insert here.
        if (!ed || !pick) return
        deferModalInsert(() =>
          ed
            .chain()
            .focus()
            .deleteRange(range)
            .insertContent({
              type: 'meetingNotesBlock',
              attrs: { meetingArtifactId: pick.meetingArtifactId },
            })
            .run(),
        )
      })
    }
  }, [onPickMeetingBlock])

  const slashItems = useMemo(
    () =>
      createSlashItems({
        openDatePopover: (range) => openKind('date', range),
        openDatetimePopover: (range) => openKind('datetime', range),
        openFilePopover: (range) => openKind('file', range),
        openMediaPopover: (range, mediaKind) => openMedia(range, mediaKind),
        openMarkdownPopover: (range) => openKind('markdown', range),
        openPageLinkPopover: (range) => openKind('pageLink', range),
        openBookmarkPopover: (range) => openKind('bookmark', range),
        openEmbedPopover: (range) => openKind('embed', range),
        openReminderCreate: props.onReminderCreate,
        openDrawioCreate,
        openDatabasePicker,
        openSyncedBlockPicker,
        openMeetingPicker,
      }),
    [
      openKind,
      openMedia,
      props.onReminderCreate,
      openDrawioCreate,
      openDatabasePicker,
      openSyncedBlockPicker,
      openMeetingPicker,
    ],
  )

  const slashItemsRef = useRef(slashItems)
  slashItemsRef.current = slashItems

  const slashRender = useMemo<() => SlashMenuRender>(
    () => () => {
      const captureRect = (p: SlashSuggestionProps) => {
        if (p.clientRect) {
          slashClientRectRef.current = () => p.clientRect?.() ?? new DOMRect(0, 0, 0, 0)
        }
      }
      return {
        onStart: (suggestionProps: SlashSuggestionProps) => {
          captureRect(suggestionProps)
          const component: SlashMenuRenderer = new ReactRenderer(SlashMenuPopover, {
            props: {
              items: suggestionProps.items,
              command: (item: SlashCommandItem) => suggestionProps.command(item),
            },
            editor: suggestionProps.editor,
          })
          slashRendererRef.current.component = component

          if (!suggestionProps.clientRect) return
          const getRect = suggestionProps.clientRect
          const [popup] = tippy('body', {
            getReferenceClientRect: () => getRect() ?? new DOMRect(0, 0, 0, 0),
            appendTo: () => document.body,
            content: component.element,
            showOnCreate: true,
            interactive: true,
            trigger: 'manual',
            placement: 'bottom-start',
            offset: [0, 6],
          })
          slashRendererRef.current.popup = popup ?? null
        },
        onUpdate: (suggestionProps: SlashSuggestionProps) => {
          captureRect(suggestionProps)
          slashRendererRef.current.component?.updateProps({
            items: suggestionProps.items,
            command: (item: SlashCommandItem) => suggestionProps.command(item),
          })
          const clientRect = suggestionProps.clientRect
          if (clientRect) {
            slashRendererRef.current.popup?.setProps({
              getReferenceClientRect: () => clientRect() ?? new DOMRect(0, 0, 0, 0),
            })
          }
        },
        onKeyDown: (suggestionProps) => {
          if (suggestionProps.event.key === 'Escape') {
            slashRendererRef.current.popup?.hide()
            return true
          }
          return slashRendererRef.current.component?.ref?.onKeyDown(suggestionProps.event) ?? false
        },
        onExit: () => {
          slashRendererRef.current.popup?.destroy()
          slashRendererRef.current.component?.destroy()
          slashRendererRef.current.component = null
          slashRendererRef.current.popup = null
        },
      }
    },
    [],
  )

  const mentionRender = useMemo(
    () => () => ({
      onStart: (suggestionProps: MentionSuggestionProps) => {
        const component: MentionMenuRenderer = new ReactRenderer(MentionMenuPopover, {
          props: {
            items: suggestionProps.items,
            command: (item: MentionLookupItem) => suggestionProps.command(item),
          },
          editor: suggestionProps.editor,
        })
        mentionRendererRef.current.component = component

        if (!suggestionProps.clientRect) return
        const getRect = suggestionProps.clientRect
        const [popup] = tippy('body', {
          getReferenceClientRect: () => getRect() ?? new DOMRect(0, 0, 0, 0),
          appendTo: () => document.body,
          content: component.element,
          showOnCreate: true,
          interactive: true,
          trigger: 'manual',
          placement: 'bottom-start',
          offset: [0, 6],
        })
        mentionRendererRef.current.popup = popup ?? null
      },
      onUpdate: (suggestionProps: MentionSuggestionProps) => {
        mentionRendererRef.current.component?.updateProps({
          items: suggestionProps.items,
          command: (item: MentionLookupItem) => suggestionProps.command(item),
        })
        const clientRect = suggestionProps.clientRect
        if (clientRect) {
          mentionRendererRef.current.popup?.setProps({
            getReferenceClientRect: () => clientRect() ?? new DOMRect(0, 0, 0, 0),
          })
        }
      },
      onKeyDown: (suggestionProps: SuggestionKeyDownProps) => {
        if (suggestionProps.event.key === 'Escape') {
          mentionRendererRef.current.popup?.hide()
          return true
        }
        return mentionRendererRef.current.component?.ref?.onKeyDown(suggestionProps.event) ?? false
      },
      onExit: () => {
        mentionRendererRef.current.popup?.destroy()
        mentionRendererRef.current.component?.destroy()
        mentionRendererRef.current.component = null
        mentionRendererRef.current.popup = null
      },
    }),
    [],
  )

  const editor = useEditor(
    {
      editable,
      immediatelyRender: false,
      extensions: buildExtensions({
        ydoc,
        provider,
        user,
        uploadHandler,
        placeholder,
        slashItems: (query: string) => slashItemsRef.current(query),
        slashRender,
        mentionItems: mentionSearch,
        mentionRender,
        onNavigateToPage,
        drawioUrl: props.drawioUrl,
        onOpenThread: props.onOpenThread ?? (() => undefined),
        plantumlRenderAuth: props.plantumlRenderAuth,
        renderEmbeddedDatabase: props.renderEmbeddedDatabase,
        renderSyncedBlock: props.renderSyncedBlock,
        renderMeetingBlock: props.renderMeetingBlock,
        pageId: props.pageId,
        bookmarkPreview: props.bookmarkPreview,
        askAI: props.askAI,
        inlineAiRenderPreview,
        onOpenFilePreview: props.onOpenFilePreview,
      }),
      onCreate: ({ editor: ed }) => {
        editorInstanceRef.current = ed
        props.onReady?.(ed)
      },
    },
    [ydoc, provider],
  )

  useEffect(() => {
    if (!editor) return
    ;(editor.storage as unknown as Record<string, unknown>).reminderCallbacks = {
      onClick: props.onReminderClick,
    }
  }, [editor, props.onReminderClick])

  useEffect(() => {
    if (!editor) return
    editor.commands.setCommentThreads(props.commentThreads ?? [])
  }, [editor, props.commentThreads])

  useEffect(() => {
    if (!editor) return
    editor.commands.setActiveCommentAnchor(props.activeCommentAnchor ?? null)
  }, [editor, props.activeCommentAnchor])

  useEffect(() => {
    if (!editor) return
    ;(editor.storage as unknown as Record<string, unknown>).comments = {
      canComment: props.canComment ?? false,
      onCreateComment: props.onCreateComment,
    }
  }, [editor, props.canComment, props.onCreateComment])

  // Keep editor.storage.ai in sync with the injected bridges (the extension's
  // onCreate seeds `askAI`; here we refresh it and add `onAskAi`, which the
  // bubble-menu button calls to open the action popover, plus the space-bar
  // drafting pair `generateAI`/`onSpaceAi`). Mirrors the comments storage block.
  // NB: this WHOLESALE-REPLACES storage.ai — every capability key must live here.
  useEffect(() => {
    if (!editor) return
    ;(editor.storage as unknown as Record<string, unknown>).ai = {
      askAI: props.askAI ?? null,
      onAskAi: (captured: InlineAiCapturedRange) => {
        // No anchor rect (coordsAtPos threw) → the Popper can't render; skip
        // entirely so the plugin isn't left holding an invisible capture.
        if (!captured.anchorEl) return
        if (!editor.isDestroyed) {
          // HOLD the new range in the plugin: it gets the source highlight
          // (the popover's autofocused input steals the native selection
          // paint) and the drift guard re-maps it while the popover is open —
          // pick() reads the live range, not this stale capture. ONLY when the
          // preview slot is free (or holds a stale popover hold): opening the
          // menu must stay non-destructive — an un-accepted preview / a
          // streaming Space-AI draft survives until an action is actually
          // PICKED (runInlineAi's 'start' + session abort supersede then);
          // heldRange() in the popover falls back to this click-time capture.
          const held = getInlineAiPreview(editor)
          if (!held.active || held.status === 'capturing') {
            abortInlineAiSession(editor)
            captureInlineAiRange(editor, { from: captured.from, to: captured.to })
          }
        }
        setAiCapture(captured)
      },
      generateAI: props.generateAI ?? null,
      onSpaceAi: props.generateAI ? (args: SpaceAiTriggerArgs) => setSpaceAi(args) : undefined,
    }
  }, [editor, props.askAI, props.generateAI])

  const anchorEl = popover?.anchorEl ?? null
  const range = popover?.range ?? null

  return (
    <Box className={`anynote-editor ${props.className ?? ''}`} sx={{ height: '100%' }}>
      {editor ? (
        <EditorDragHandle editor={editor} onRequestBlockMove={props.onRequestBlockMove} />
      ) : null}
      {editor ? <FloatingToolbar editor={editor} /> : null}
      {editor ? <TableToolbar editor={editor} /> : null}
      <EditorContent editor={editor} />
      {editor ? (
        <>
          <DateInsertPopover
            open={popover?.kind === 'date' || popover?.kind === 'datetime'}
            mode={popover?.kind === 'datetime' ? 'datetime' : 'date'}
            anchorEl={anchorEl}
            range={range}
            editor={editor}
            onClose={closePopover}
          />
          <FileUploadPopover
            open={popover?.kind === 'file'}
            anchorEl={anchorEl}
            range={range}
            editor={editor}
            uploadHandler={uploadHandler}
            onClose={closePopover}
          />
          <FileUploadPopover
            open={popover?.kind === 'media'}
            anchorEl={anchorEl}
            range={range}
            editor={editor}
            uploadHandler={uploadHandler}
            target="media"
            accept={popover?.mediaKind === 'audio' ? 'audio/*' : 'video/*'}
            onClose={closePopover}
          />
          <MarkdownUploadPopover
            open={popover?.kind === 'markdown'}
            range={range}
            editor={editor}
            onClose={closePopover}
          />
          <PageLinkPopover
            open={popover?.kind === 'pageLink'}
            anchorEl={anchorEl}
            range={range}
            editor={editor}
            workspaceId={workspaceId}
            pageSearch={pageSearch}
            onClose={closePopover}
          />
          <EmbedUrlPopover
            open={popover?.kind === 'bookmark' || popover?.kind === 'embed'}
            mode={popover?.kind === 'embed' ? 'embed' : 'bookmark'}
            anchorEl={anchorEl}
            range={range}
            editor={editor}
            previewFetch={props.bookmarkPreview}
            onClose={closePopover}
          />
          <DrawioEditorDialog
            open={drawioCreate != null}
            initialXml=""
            drawioUrl={props.drawioUrl}
            onSave={(attrs) => {
              if (drawioCreate) {
                const { range } = drawioCreate
                deferModalInsert(() =>
                  editor
                    .chain()
                    .focus()
                    .deleteRange(range)
                    .insertContent({ type: 'drawio', attrs })
                    .run(),
                )
              }
              setDrawioCreate(null)
            }}
            onCancel={() => setDrawioCreate(null)}
          />
          <InlineAiPopover
            editor={editor}
            open={aiCapture != null}
            captured={aiCapture}
            askAI={props.askAI ?? null}
            onClose={() => setAiCapture(null)}
          />
          <SpaceAiBar
            editor={editor}
            open={spaceAi != null}
            anchor={spaceAi}
            generateAI={props.generateAI ?? null}
            onClose={() => setSpaceAi(null)}
          />
        </>
      ) : null}
    </Box>
  )
}
