'use client'

import { useCallback, useRef, type KeyboardEvent } from 'react'
import { Box, IconButton, Tooltip } from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import CloseIcon from '@mui/icons-material/Close'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/react'

import {
  DEFAULT_TAB_LABEL,
  TabSchema,
  TabsSchema,
  appendTabTransaction,
  reconcileTabs,
  removeTabTransaction,
} from './tabs.schema'

// ---------------------------------------------------------------------------
// The parent `tabs` NodeView: a `role=tablist` strip + a contentDOM holding
// EVERY tab panel. Only the active panel is shown (the inactive ones are
// `display:none` in THIS render — the content is shared doc content, present
// for everyone, just hidden locally; spec §2/§8.5). Visibility is driven from
// the parent's `activeTab` attr via a scoped CSS selector, so the parent
// re-renders (and re-hides) whenever the active index changes.
// ---------------------------------------------------------------------------
function TabsView({ node, updateAttributes, editor, getPos }: NodeViewProps) {
  const activeTab = Number(node.attrs.activeTab ?? 0)
  const count = node.childCount
  const editable = editor.isEditable
  const buttonsRef = useRef<Array<HTMLButtonElement | null>>([])

  const labels: string[] = []
  node.forEach((child) => {
    labels.push(String(child.attrs.label ?? DEFAULT_TAB_LABEL))
  })

  const setActive = useCallback(
    (index: number) => {
      if (index < 0 || index >= count) return
      updateAttributes({ activeTab: index })
    },
    [count, updateAttributes],
  )

  const renameTab = useCallback(
    (index: number, label: string) => {
      const pos = getPos()
      if (typeof pos !== 'number') return
      const tabsNode = editor.state.doc.nodeAt(pos)
      if (!tabsNode || tabsNode.type.name !== 'tabs') return
      let childStart = pos + 1
      for (let i = 0; i < index; i++) childStart += tabsNode.child(i).nodeSize
      const tabNode = tabsNode.child(index)
      editor.view.dispatch(
        editor.state.tr.setNodeMarkup(childStart, undefined, {
          ...tabNode.attrs,
          label: label || DEFAULT_TAB_LABEL,
        }),
      )
    },
    [editor, getPos],
  )

  const addTab = useCallback(() => {
    const pos = getPos()
    if (typeof pos !== 'number') return
    editor.view.dispatch(appendTabTransaction(editor.state.tr, pos))
    editor.view.focus()
  }, [editor, getPos])

  const removeTab = useCallback(
    (index: number) => {
      const pos = getPos()
      if (typeof pos !== 'number') return
      editor.view.dispatch(removeTabTransaction(editor.state.tr, pos, index))
      editor.view.focus()
    },
    [editor, getPos],
  )

  // Arrow-key navigation across the tab buttons (the WAI-ARIA tablist pattern):
  // Left/Right (and Home/End) move the active tab and the roving focus.
  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
      let next = index
      switch (event.key) {
        case 'ArrowRight':
        case 'ArrowDown':
          next = (index + 1) % count
          break
        case 'ArrowLeft':
        case 'ArrowUp':
          next = (index - 1 + count) % count
          break
        case 'Home':
          next = 0
          break
        case 'End':
          next = count - 1
          break
        default:
          return
      }
      event.preventDefault()
      setActive(next)
      buttonsRef.current[next]?.focus()
    },
    [count, setActive],
  )

  return (
    <NodeViewWrapper
      as="div"
      className="anynote-tabs"
      data-type="tabs"
      data-active-tab={activeTab}
    >
      <Box
        role="tablist"
        aria-orientation="horizontal"
        contentEditable={false}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.5,
          borderBottom: '1px solid',
          borderColor: 'divider',
          mb: 1,
          overflowX: 'auto',
        }}
      >
        {labels.map((label, index) => {
          const isActive = index === activeTab
          return (
            <Box
              key={index}
              sx={{
                display: 'flex',
                alignItems: 'center',
                borderBottom: '2px solid',
                borderColor: isActive ? 'primary.main' : 'transparent',
                color: isActive ? 'text.primary' : 'text.secondary',
              }}
            >
              <Box
                component="button"
                type="button"
                role="tab"
                ref={(el: HTMLButtonElement | null) => {
                  buttonsRef.current[index] = el
                }}
                aria-selected={isActive}
                aria-controls={`anynote-tabpanel-${index}`}
                id={`anynote-tab-${index}`}
                tabIndex={isActive ? 0 : -1}
                // The active tab's label is editable inline (the author edits it
                // in place); inactive labels are plain buttons that activate.
                contentEditable={editable && isActive}
                suppressContentEditableWarning
                onKeyDown={(e: KeyboardEvent<HTMLButtonElement>) => {
                  if (editable && isActive && e.key === 'Enter') {
                    e.preventDefault()
                    ;(e.currentTarget as HTMLButtonElement).blur()
                    return
                  }
                  onKeyDown(e, index)
                }}
                onMouseDown={(e: React.MouseEvent) => {
                  // Don't steal focus/selection from a label being edited.
                  if (!(editable && isActive)) e.preventDefault()
                }}
                onClick={() => setActive(index)}
                onBlur={(e: React.FocusEvent<HTMLButtonElement>) => {
                  if (editable && isActive) {
                    renameTab(index, e.currentTarget.textContent ?? '')
                  }
                }}
                sx={{
                  appearance: 'none',
                  background: 'none',
                  border: 'none',
                  font: 'inherit',
                  color: 'inherit',
                  px: 1,
                  py: 0.75,
                  cursor: editable && isActive ? 'text' : 'pointer',
                  outline: 'none',
                  whiteSpace: 'nowrap',
                  fontWeight: isActive ? 600 : 400,
                  minWidth: 24,
                }}
              >
                {label}
              </Box>
              {editable && isActive ? (
                <Tooltip title="Удалить вкладку">
                  <IconButton
                    size="small"
                    aria-label="Удалить вкладку"
                    onMouseDown={(e: React.MouseEvent) => e.preventDefault()}
                    onClick={() => removeTab(index)}
                    sx={{ width: 18, height: 18, p: 0, ml: 0.25, color: 'text.secondary' }}
                  >
                    <CloseIcon sx={{ fontSize: 14 }} />
                  </IconButton>
                </Tooltip>
              ) : null}
            </Box>
          )
        })}
        {editable ? (
          <Tooltip title="Добавить вкладку">
            <IconButton
              size="small"
              aria-label="Добавить вкладку"
              onMouseDown={(e: React.MouseEvent) => e.preventDefault()}
              onClick={addTab}
              sx={{ width: 24, height: 24, p: 0, ml: 0.25, flexShrink: 0 }}
            >
              <AddIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
        ) : null}
      </Box>
      {/* All tab panels live here; only the active one is shown. The
          nth-of-type selector re-evaluates on every parent re-render (so it
          re-hides when activeTab changes). The contentDOM (NodeViewContent)
          carries the tab children, each a `[data-type="tab"]` wrapper. */}
      <Box
        sx={{
          '& > .anynote-tabs-panels > [data-type="tab"]': { display: 'none' },
          [`& > .anynote-tabs-panels > [data-type="tab"]:nth-of-type(${activeTab + 1})`]: {
            display: 'block',
          },
        }}
      >
        <NodeViewContent className="anynote-tabs-panels" as="div" />
      </Box>
    </NodeViewWrapper>
  )
}

// The child `tab` NodeView is intentionally thin: a clean wrapper carrying
// `data-type="tab"` (so the parent's nth-of-type selector can target it) plus
// the panel's contentDOM. Inline label/headers are a SERVER-export concern
// (TabSchema.renderHTML) — in the live editor the label lives in the strip.
function TabView({ node }: NodeViewProps) {
  const label = String(node.attrs.label ?? DEFAULT_TAB_LABEL)
  return (
    <NodeViewWrapper
      as="div"
      className="anynote-tab"
      data-type="tab"
      role="tabpanel"
      aria-label={label}
    >
      <NodeViewContent className="anynote-tab-content" as="div" />
    </NodeViewWrapper>
  )
}

const reconcileKey = new PluginKey('tabsReconcile')

export const Tabs = TabsSchema.extend({
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: reconcileKey,
        appendTransaction(_transactions, _oldState, newState) {
          return reconcileTabs(newState) ?? undefined
        },
      }),
    ]
  },
  addNodeView() {
    return ReactNodeViewRenderer(TabsView)
  },
})

export const Tab = TabSchema.extend({
  addNodeView() {
    return ReactNodeViewRenderer(TabView)
  },
})
