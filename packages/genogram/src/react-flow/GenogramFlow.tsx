'use client'

import '@xyflow/react/dist/style.css'

import { useEffect, useMemo, useRef, type CSSProperties } from 'react'
import * as Y from 'yjs'
import { Background, Controls, ReactFlow, ReactFlowProvider } from '@xyflow/react'
import type { GenogramEdge, GenogramNode, GenogramPageData } from '../types'
import { useGenogram } from '../hooks'
import { getGenogramMaps } from '../yjs/schema'
import { hydrateDoc } from '../yjs/hydrateDoc'
import { snapshotFromDoc } from '../yjs/snapshotFromDoc'
import { domainToFlow } from './domainToFlow'
import { edgeTypes } from './edgeTypes'
import { nodeTypes } from './nodeTypes'

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

  const { nodes, edges } = useMemo(() => domainToFlow(domain, layout), [domain, layout]) as {
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

  return (
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
      >
        <Background gap={24} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
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
