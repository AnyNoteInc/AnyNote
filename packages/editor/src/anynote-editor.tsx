"use client"

import { Box } from "@mui/material"
import { HocuspocusProvider } from "@hocuspocus/provider"
import { EditorContent, ReactRenderer, useEditor } from "@tiptap/react"
import type { SuggestionProps } from "@tiptap/suggestion"
import tippy, { type Instance } from "tippy.js"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import * as Y from "yjs"

import { EditorDragHandle } from "./components/drag-handle"
import { FileUploadPopover } from "./components/file-upload-popover"
import { FloatingToolbar } from "./components/floating-toolbar"
import { MarkdownUploadPopover } from "./components/markdown-upload-popover"
import { PageLinkPopover } from "./components/page-link-popover"
import { SlashMenuPopover } from "./components/slash-menu-popover"
import type { SlashMenuPopoverHandle } from "./components/slash-menu-popover"
import { TableToolbar } from "./components/table-toolbar"
import { buildExtensions } from "./extensions/index"
import type { SlashMenuRender } from "./extensions/slash-menu"
import { createSlashItems } from "./slash-items"
import type { AnyNoteEditorProps, SlashCommandItem, SlashRange, VirtualAnchor } from "./types"

type SlashSuggestionProps = SuggestionProps<SlashCommandItem, SlashCommandItem>

type YjsResources = { ydoc: Y.Doc; provider: HocuspocusProvider }

type PopoverKind = "file" | "markdown" | "pageLink"

type OpenPopover = {
  kind: PopoverKind
  anchorEl: VirtualAnchor
  range: SlashRange
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
    return <Box className={`anynote-editor ${props.className ?? ""}`} sx={{ height: "100%" }} />
  }
  return <AnyNoteEditorInner {...props} resources={resources} />
}

function AnyNoteEditorInner(props: AnyNoteEditorProps & { resources: YjsResources }) {
  const {
    user,
    uploadHandler,
    workspaceId,
    pageSearch,
    onNavigateToPage,
    editable = true,
    resources,
  } = props
  const { ydoc, provider } = resources
  const placeholder = props.placeholder ?? "Введите '/' для команд"

  const [popover, setPopover] = useState<OpenPopover | null>(null)

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

  const openKind = useCallback((kind: PopoverKind, range: SlashRange) => {
    const rect = slashClientRectRef.current()
    slashRendererRef.current.popup?.hide()
    setPopover({
      kind,
      range,
      anchorEl: { nodeType: 1, getBoundingClientRect: () => rect },
    })
  }, [])

  const closePopover = useCallback(() => setPopover(null), [])

  const slashItems = useMemo(
    () =>
      createSlashItems({
        openFilePopover: (range) => openKind("file", range),
        openMarkdownPopover: (range) => openKind("markdown", range),
        openPageLinkPopover: (range) => openKind("pageLink", range),
      }),
    [openKind],
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
          const [popup] = tippy("body", {
            getReferenceClientRect: () => getRect() ?? new DOMRect(0, 0, 0, 0),
            appendTo: () => document.body,
            content: component.element,
            showOnCreate: true,
            interactive: true,
            trigger: "manual",
            placement: "bottom-start",
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
          if (suggestionProps.event.key === "Escape") {
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
        onNavigateToPage,
      }),
      onCreate: ({ editor: ed }) => {
        props.onReady?.(ed)
      },
    },
    [ydoc, provider],
  )

  const anchorEl = popover?.anchorEl ?? null
  const range = popover?.range ?? null

  return (
    <Box className={`anynote-editor ${props.className ?? ""}`} sx={{ height: "100%" }}>
      {editor ? (
        <EditorDragHandle editor={editor} onRequestBlockMove={props.onRequestBlockMove} />
      ) : null}
      {editor ? <FloatingToolbar editor={editor} /> : null}
      {editor ? <TableToolbar editor={editor} /> : null}
      <EditorContent editor={editor} />
      {editor ? (
        <>
          <FileUploadPopover
            open={popover?.kind === "file"}
            anchorEl={anchorEl}
            range={range}
            editor={editor}
            uploadHandler={uploadHandler}
            onClose={closePopover}
          />
          <MarkdownUploadPopover
            open={popover?.kind === "markdown"}
            anchorEl={anchorEl}
            range={range}
            editor={editor}
            onClose={closePopover}
          />
          <PageLinkPopover
            open={popover?.kind === "pageLink"}
            anchorEl={anchorEl}
            range={range}
            editor={editor}
            workspaceId={workspaceId}
            pageSearch={pageSearch}
            onClose={closePopover}
          />
        </>
      ) : null}
    </Box>
  )
}
