"use client"

import { Box } from "@mui/material"
import { HocuspocusProvider } from "@hocuspocus/provider"
import { EditorContent, ReactRenderer, useEditor } from "@tiptap/react"
import type { SuggestionProps } from "@tiptap/suggestion"
import tippy, { type Instance } from "tippy.js"
import { useEffect, useMemo, useRef, useState } from "react"
import * as Y from "yjs"

import { EditorDragHandle } from "./components/drag-handle"
import { FloatingToolbar } from "./components/floating-toolbar"
import { SlashMenuPopover } from "./components/slash-menu-popover"
import type { SlashMenuPopoverHandle } from "./components/slash-menu-popover"
import { buildExtensions } from "./extensions/index"
import type { SlashMenuRender } from "./extensions/slash-menu"
import { defaultSlashItems } from "./slash-items"
import type { AnyNoteEditorProps, SlashCommandItem } from "./types"

type SlashSuggestionProps = SuggestionProps<SlashCommandItem, SlashCommandItem>

export function AnyNoteEditor(props: AnyNoteEditorProps) {
  const { pageId, yjsUrl, yjsToken, user, uploadHandler, editable = true } = props
  const placeholder = props.placeholder ?? "Введите '/' для команд"

  const [ydoc] = useState(() => new Y.Doc())
  const [provider] = useState(
    () =>
      new HocuspocusProvider({
        url: yjsUrl,
        name: pageId,
        document: ydoc,
        token: yjsToken,
      }),
  )

  type SlashMenuRenderer = ReactRenderer<
    SlashMenuPopoverHandle,
    {
      items: SlashCommandItem[]
      command: (item: SlashCommandItem) => void
      clientRect?: (() => DOMRect | null) | null
    }
  >

  const slashRendererRef = useRef<{
    component: SlashMenuRenderer | null
    popup: Instance | null
  }>({ component: null, popup: null })

  const slashRender = useMemo<() => SlashMenuRender>(
    () => () => ({
      onStart: (suggestionProps: SlashSuggestionProps) => {
        const component: SlashMenuRenderer = new ReactRenderer(SlashMenuPopover, {
          props: {
            items: suggestionProps.items,
            command: (item: SlashCommandItem) => suggestionProps.command(item),
            clientRect: suggestionProps.clientRect,
          },
          editor: suggestionProps.editor,
        })
        slashRendererRef.current.component = component

        const rect = suggestionProps.clientRect?.() ?? null
        if (!rect) return

        const [popup] = tippy("body", {
          getReferenceClientRect: () => suggestionProps.clientRect?.() ?? rect,
          appendTo: () => document.body,
          content: component.element,
          showOnCreate: true,
          interactive: true,
          trigger: "manual",
          placement: "bottom-start",
        })
        slashRendererRef.current.popup = popup ?? null
      },
      onUpdate: (suggestionProps: SlashSuggestionProps) => {
        slashRendererRef.current.component?.updateProps({
          items: suggestionProps.items,
          command: (item: SlashCommandItem) => suggestionProps.command(item),
          clientRect: suggestionProps.clientRect,
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
        slashItems: defaultSlashItems,
        slashRender,
      }),
    },
    [],
  )

  useEffect(() => {
    return () => {
      provider.destroy()
      ydoc.destroy()
    }
  }, [provider, ydoc])

  return (
    <Box className={`anynote-editor ${props.className ?? ""}`} sx={{ height: "100%" }}>
      {editor ? <EditorDragHandle editor={editor} /> : null}
      {editor ? <FloatingToolbar editor={editor} /> : null}
      <EditorContent editor={editor} />
    </Box>
  )
}
