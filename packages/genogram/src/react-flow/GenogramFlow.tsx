'use client'

import '@xyflow/react/dist/style.css'

import { useEffect, useMemo, useReducer, useRef, type CSSProperties } from 'react'
import * as Y from 'yjs'
import { Background, Controls, ReactFlow, ReactFlowProvider } from '@xyflow/react'
import type { GenogramEdge, GenogramNode, GenogramPageData } from '../types'
import type { PersonId, UnionId } from '../types/ids'
import { useGenogram } from '../hooks'
import { getGenogramMaps } from '../yjs/schema'
import { hydrateDoc } from '../yjs/hydrateDoc'
import { snapshotFromDoc } from '../yjs/snapshotFromDoc'
import { getMeta, addParents } from '../yjs/actions'
import { assembleDomain } from '../yjs/assembleDomain'
import { hasParents } from '../model/computed'
import { domainToFlow } from './domainToFlow'
import { DocContext } from './doc-context'
import { edgeTypes } from './edgeTypes'
import { nodeTypes } from './nodeTypes'
import { initialUiState, uiReducer } from '../ui/ui-state'
import { DrawerHost } from '../ui/DrawerHost'
import { ElementMenu } from '../ui/ElementMenu'
import { EdgeMenu } from '../ui/EdgeMenu'
import { EmptyState } from '../ui/EmptyState'

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

  const meta = getMeta(doc)

  const { nodes, edges } = useMemo(
    () => domainToFlow(domain, layout, meta),
    [domain, layout, meta],
  ) as {
    nodes: GenogramNode[]
    edges: GenogramEdge[]
  }

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

  const onNodeClick = (e: React.MouseEvent, node: { id: string }) => {
    if (readonly) return
    if (node.id === '__creation_date__') return
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
    setTimeout(() => document.body.removeChild(virtualEl), 5000)
    dispatch({ type: 'select-edge', id: edge.id, anchorEl: virtualEl })
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
      <div className={className} style={{ width: '100%', height: '100%', ...style }}>
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
        >
          <Background gap={24} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>

      {ui.menu?.kind === 'node' &&
        (() => {
          const domain = assembleDomain(doc)
          const person = domain.entities.people[ui.menu.targetId as PersonId]
          if (!person) return null
          return (
            <ElementMenu
              open
              anchorEl={ui.menu.anchorEl}
              personSize={person.size}
              personRole={person.role}
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

      {ui.menu?.kind === 'edge' && (
        <EdgeMenu
          open
          anchorEl={ui.menu.anchorEl}
          onClose={() => dispatch({ type: 'close-menu' })}
          onAction={(action) => {
            // Edge IDs are prefixed: "marriage:<uuid>" or "cohabitation:<uuid>".
            // Strip the prefix to get the raw union ID for DrawerHost lookups.
            const edgeId = ui.menu!.targetId
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
      )}

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
