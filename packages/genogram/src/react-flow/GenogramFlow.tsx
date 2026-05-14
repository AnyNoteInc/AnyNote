'use client'

import '@xyflow/react/dist/style.css'

import { useEffect, useMemo, useReducer, useRef, type CSSProperties } from 'react'
import * as Y from 'yjs'
import {
  Background,
  Controls,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react'
import { Button } from '@mui/material'
import type { GenogramEdge, GenogramNode, GenogramPageData } from '../types'
import type { AnnotationId, PersonId, UnionId } from '../types/ids'
import { useGenogram } from '../hooks'
import { getGenogramMaps } from '../yjs/schema'
import { hydrateDoc } from '../yjs/hydrateDoc'
import { snapshotFromDoc } from '../yjs/snapshotFromDoc'
import {
  addParents,
  getMeta,
  removeAnnotation,
  updateAnnotation,
} from '../yjs/actions'
import { assembleDomain } from '../yjs/assembleDomain'
import { hasParents, isoToPartial } from '../model/computed'
import { formatPartialDate } from '../i18n/format-date'
import { RU } from '../i18n/ru'
import { findSafeNotePosition } from '../utils/notePosition'
import { domainToFlow } from './domainToFlow'
import { DocContext } from './doc-context'
import { edgeTypes } from './edgeTypes'
import { nodeTypes } from './nodeTypes'
import { initialUiState, uiReducer } from '../ui/ui-state'
import { AnnotationMenu } from '../ui/AnnotationMenu'
import { DrawerHost } from '../ui/DrawerHost'
import { ElementMenu } from '../ui/ElementMenu'
import { EdgeMenu } from '../ui/EdgeMenu'
import { EmptyState } from '../ui/EmptyState'
import { PaneMenu } from '../ui/PaneMenu'

export type GenogramMode = 'readonly' | 'editor'

export interface GenogramFlowProps {
  /** External Y.Doc (collab). Leave undefined for standalone mode. */
  yDoc?: Y.Doc
  /** Hydrate a fresh Y.Doc from this snapshot on first mount. */
  initialSnapshot?: GenogramPageData
  mode?: GenogramMode
  /** Called whenever the domain changes. Parent owns debouncing/saving. */
  onChange?: (snapshot: GenogramPageData) => void
  className?: string
  style?: CSSProperties
  fitView?: boolean
}

export function GenogramFlow(props: GenogramFlowProps) {
  return (
    <ReactFlowProvider>
      <GenogramFlowInner {...props} />
    </ReactFlowProvider>
  )
}

// DocContext is provided inside GenogramFlowInner where the resolved Y.Doc is available.

function GenogramFlowInner({
  yDoc,
  initialSnapshot,
  mode = 'editor',
  onChange,
  className,
  style,
  fitView = true,
}: GenogramFlowProps) {
  const localDocRef = useRef<Y.Doc | null>(null)
  if (!yDoc && !localDocRef.current) {
    localDocRef.current = new Y.Doc()
  }
  const doc = yDoc ?? localDocRef.current!

  useEffect(() => {
    if (initialSnapshot && isDocEmpty(doc)) {
      hydrateDoc(doc, initialSnapshot)
    }
  }, [doc, initialSnapshot])

  const { domain, layout } = useGenogram(doc)
  const [ui, dispatch] = useReducer(uiReducer, initialUiState)
  const reactFlowInstance = useReactFlow()

  const meta = getMeta(doc)

  const { nodes: rawNodes, edges } = useMemo(
    () => domainToFlow(domain, layout, meta),
    [domain, layout, meta],
  ) as {
    nodes: GenogramNode[]
    edges: GenogramEdge[]
  }

  // Annotations are draggable only while in "move-annotation" mode (the
  // user picked "Изменить положение" from the annotation menu). Everything
  // else stays locked to the layout.
  const movingId = ui.movingAnnotationId
  const nodes = useMemo<GenogramNode[]>(
    () =>
      rawNodes.map((n) => ({
        ...n,
        draggable: n.type === 'annotation' && n.id === movingId,
      })),
    [rawNodes, movingId],
  )

  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const lastSnapshotRef = useRef<GenogramPageData | null>(null)
  useEffect(() => {
    if (!onChangeRef.current) return
    let snapshot: GenogramPageData
    try {
      snapshot = snapshotFromDoc(doc)
    } catch {
      return
    }
    if (lastSnapshotRef.current === snapshot) return
    lastSnapshotRef.current = snapshot
    onChangeRef.current(snapshot)
  }, [domain, doc])

  const readonly = mode === 'readonly'

  const onNodeClick = (e: React.MouseEvent, node: { id: string; type?: string }) => {
    if (readonly) return
    if (node.id === '__creation_date__') return
    if (node.type === 'annotation') {
      dispatch({
        type: 'select-annotation',
        id: node.id as AnnotationId,
        anchorEl: e.currentTarget as HTMLElement,
      })
      return
    }
    dispatch({ type: 'select-node', id: node.id, anchorEl: e.currentTarget as HTMLElement })
  }

  const onEdgeClick = (e: React.MouseEvent, edge: { id: string }) => {
    if (readonly) return
    // e.currentTarget is a SVG <g> element. MUI Menu needs an HTML element as
    // anchorEl. Create a zero-size virtual div positioned at the click point.
    const virtualEl = document.createElement('div')
    virtualEl.style.position = 'fixed'
    virtualEl.style.left = `${e.clientX}px`
    virtualEl.style.top = `${e.clientY}px`
    virtualEl.style.width = '0'
    virtualEl.style.height = '0'
    document.body.appendChild(virtualEl)
    // Remove the virtual element once the menu closes (next tick is fine)
    setTimeout(() => virtualEl.remove(), 5000)
    dispatch({ type: 'select-edge', id: edge.id, anchorEl: virtualEl })
  }

  // Build a virtual anchor element for menus opened from canvas events
  // (pane double-click) — MUI's Menu needs an HTML anchor and React Flow
  // gives us a screen-space MouseEvent.
  const makeVirtualAnchor = (clientX: number, clientY: number): HTMLElement => {
    const el = document.createElement('div')
    el.style.position = 'fixed'
    el.style.left = `${clientX}px`
    el.style.top = `${clientY}px`
    el.style.width = '0'
    el.style.height = '0'
    document.body.appendChild(el)
    setTimeout(() => el.remove(), 5000)
    return el
  }

  const onPaneDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (readonly) return
    // ReactFlow doesn't expose a pane-double-click event, so we listen on
    // the wrapper div and ignore double-clicks landing on a node/edge —
    // those have a `react-flow__node` / `react-flow__edge` ancestor in the
    // event path.
    const target = e.target as HTMLElement
    if (target.closest('.react-flow__node') || target.closest('.react-flow__edge')) {
      return
    }
    if (ui.movingAnnotationId) {
      dispatch({ type: 'stop-move-annotation' })
      return
    }
    const flowPos = reactFlowInstance.screenToFlowPosition({ x: e.clientX, y: e.clientY })
    const anchor = makeVirtualAnchor(e.clientX, e.clientY)
    dispatch({ type: 'open-pane-menu', anchorEl: anchor, position: flowPos })
  }

  const onPaneClick = () => {
    if (readonly) return
    if (ui.movingAnnotationId) {
      // Single click outside annotation in move-mode commits the position.
      dispatch({ type: 'stop-move-annotation' })
    }
  }

  const onNodeDragStop = (
    _e: React.MouseEvent,
    node: { id: string; type?: string; position: { x: number; y: number } },
  ) => {
    if (node.type !== 'annotation') return
    if (node.id !== ui.movingAnnotationId) return
    updateAnnotation(doc, node.id as AnnotationId, { position: node.position })
  }

  const formattedCreationDate = (() => {
    if (!meta?.createdAt) return null
    const partial = isoToPartial(meta.createdAt)
    return partial ? formatPartialDate(partial) : null
  })()

  const handleAddNoteFromPanel = () => {
    if (readonly) return
    // Drop the new note near the visible centre of the canvas so the user
    // doesn't have to hunt for it. screenToFlowPosition translates client
    // pixels into flow coordinates, accounting for current pan/zoom.
    const flowPos = reactFlowInstance.screenToFlowPosition({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    })
    const safe = findSafeNotePosition(flowPos, layout)
    dispatch({ type: 'open-drawer', drawer: { mode: 'add-note', position: safe } })
  }

  // When meta is null (genogram not yet created), show EmptyState + DrawerHost for CTA flow
  if (!meta) {
    return (
      <DocContext.Provider value={doc}>
        <EmptyState mode={mode} onCreate={() => dispatch({ type: 'open-create' })} />
        <DrawerHost doc={doc} drawer={ui.drawer} onClose={() => dispatch({ type: 'cancel' })} />
      </DocContext.Provider>
    )
  }

  return (
    <DocContext.Provider value={doc}>
      <div
        className={className}
        style={{ width: '100%', height: '100%', ...style }}
        onDoubleClick={readonly ? undefined : onPaneDoubleClick}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          nodesDraggable={!readonly}
          nodesConnectable={!readonly}
          elementsSelectable={!readonly}
          edgesFocusable={!readonly}
          panOnDrag
          zoomOnScroll
          panOnScroll={false}
          fitView={fitView}
          proOptions={{ hideAttribution: true }}
          onNodeClick={readonly ? undefined : onNodeClick}
          onEdgeClick={readonly ? undefined : onEdgeClick}
          onPaneClick={readonly ? undefined : onPaneClick}
          onNodeDragStop={readonly ? undefined : onNodeDragStop}
        >
          <Background gap={24} />
          <Controls showInteractive={false} />
          <Panel
            position="bottom-left"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              marginLeft: 56, // clear ReactFlow's <Controls> column
              padding: '6px 12px',
              background: 'var(--genogram-fill, #fff)',
              border: '1px solid var(--genogram-stroke-soft, #ddd)',
              borderRadius: 6,
              fontSize: 12,
              color: 'var(--genogram-text, #333)',
              userSelect: 'none',
            }}
          >
            {formattedCreationDate && (
              <span data-testid="genogram-creation-date">
                {RU.labels.creationDate}: {formattedCreationDate}
              </span>
            )}
            {!readonly && (
              <Button
                size="small"
                variant="outlined"
                onClick={handleAddNoteFromPanel}
                data-testid="genogram-add-note"
              >
                {RU.menu.addNote}
              </Button>
            )}
          </Panel>
        </ReactFlow>
      </div>

      {ui.menu?.kind === 'node' &&
        (() => {
          const menu = ui.menu
          const domain = assembleDomain(doc)
          const person = domain.entities.people[menu.targetId as PersonId]
          if (!person) return null
          return (
            <ElementMenu
              open
              anchorEl={ui.menu.anchorEl}
              personSize={person.size}
              personRole={person.role}
              bloodRelation={person.bloodRelation}
              hasParents={hasParents(person.id, domain.entities.childGroups)}
              onClose={() => dispatch({ type: 'close-menu' })}
              onAction={(action) => {
                if (action === 'edit-data')
                  dispatch({
                    type: 'open-drawer',
                    drawer: { mode: 'edit-data', personId: person.id },
                  })
                else if (action === 'edit-owner')
                  dispatch({
                    type: 'open-drawer',
                    drawer: { mode: 'edit-owner-data', personId: person.id },
                  })
                else if (action === 'add-partner')
                  dispatch({
                    type: 'open-drawer',
                    drawer: { mode: 'add-partner', basePersonId: person.id },
                  })
                else if (action === 'add-parents') {
                  addParents(doc, person.id)
                  dispatch({ type: 'close-menu' })
                }
              }}
            />
          )
        })()}

      {ui.menu?.kind === 'edge' &&
        (() => {
          const menu = ui.menu
          return (
            <EdgeMenu
              open
              anchorEl={menu.anchorEl}
              onClose={() => dispatch({ type: 'close-menu' })}
              onAction={(action) => {
                // Edge IDs are prefixed: "marriage:<uuid>" or "cohabitation:<uuid>".
                // Strip the prefix to get the raw union ID for DrawerHost lookups.
                const edgeId = menu.targetId
                const unionId = (
                  edgeId.includes(':') ? edgeId.slice(edgeId.indexOf(':') + 1) : edgeId
                ) as UnionId
                if (action === 'edit-connection')
                  dispatch({
                    type: 'open-drawer',
                    drawer: { mode: 'edit-connection', unionId },
                  })
                else if (action === 'add-children')
                  dispatch({
                    type: 'open-drawer',
                    drawer: { mode: 'add-children', unionId },
                  })
              }}
            />
          )
        })()}

      {ui.menu?.kind === 'pane' &&
        (() => {
          const menu = ui.menu
          return (
            <PaneMenu
              open
              anchorEl={menu.anchorEl}
              onClose={() => dispatch({ type: 'close-menu' })}
              onAction={(action) => {
                if (action === 'add-note') {
                  // The user picked an empty pane spot, but the note's
                  // bounding box may still encroach on a nearby element.
                  // findSafeNotePosition keeps the click position when
                  // it's clear and falls back to the band below the
                  // genogram's bounds otherwise.
                  const safe = findSafeNotePosition(menu.position, layout)
                  dispatch({
                    type: 'open-drawer',
                    drawer: { mode: 'add-note', position: safe },
                  })
                }
              }}
            />
          )
        })()}

      {ui.menu?.kind === 'annotation' &&
        (() => {
          const menu = ui.menu
          return (
            <AnnotationMenu
              open
              anchorEl={menu.anchorEl}
              onClose={() => dispatch({ type: 'close-menu' })}
              onAction={(action) => {
                if (action === 'edit') {
                  dispatch({
                    type: 'open-drawer',
                    drawer: { mode: 'edit-note', annotationId: menu.targetId },
                  })
                } else if (action === 'move') {
                  dispatch({ type: 'start-move-annotation', id: menu.targetId })
                } else if (action === 'delete') {
                  removeAnnotation(doc, menu.targetId)
                  dispatch({ type: 'close-menu' })
                }
              }}
            />
          )
        })()}

      <DrawerHost doc={doc} drawer={ui.drawer} onClose={() => dispatch({ type: 'cancel' })} />
    </DocContext.Provider>
  )
}

function isDocEmpty(doc: Y.Doc): boolean {
  const maps = getGenogramMaps(doc)
  return (
    maps.people.size === 0 &&
    maps.unions.size === 0 &&
    maps.childGroups.size === 0 &&
    maps.birthGroups.size === 0 &&
    maps.pregnancyLosses.size === 0 &&
    maps.annotations.size === 0
  )
}
