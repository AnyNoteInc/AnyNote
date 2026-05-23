import type { ComponentType } from 'react'
import type * as Y from 'yjs'
import type * as monaco from 'monaco-editor'
import type { ColorMode, DiagramRenderer } from './render-types'

export type DiagramUser = {
  id: string
  name: string
  color: string
}

export type DiagramBoardProps = {
  pageId: string
  yjsUrl: string
  yjsToken: () => Promise<string>
  initialContentYjs?: string | null
  user?: DiagramUser
  editable?: boolean
  className?: string
}

/** Props a custom diagram preview component receives from the board. */
export type DiagramPreviewProps = {
  ytext: Y.Text
  mode: ColorMode
  idPrefix: string
}

type DiagramConfigBase = {
  /** Y.Text root name (the collaborative source document). */
  docName: string
  /** Monaco language id set on the editor model. */
  languageId: string
  /** Registers the Monarch language on a Monaco instance (idempotent). */
  registerLanguage: (m: typeof monaco) => void
  /** Prefix for render ids and data-testids (e.g. 'mermaid' | 'plantuml' | 'likec4'). */
  idPrefix: string
  /** Optional Monaco placeholder shown when the source is empty. */
  placeholder?: string
}

/**
 * A diagram board is parametrised by EXACTLY ONE preview backend (enforced by the
 * union):
 * - `render`: SVG path (mermaid, plantuml) — produces SVG markup injected into the preview.
 * - `Preview`: custom React preview (likec4) — renders a component tree instead of SVG.
 */
export type DiagramConfig = DiagramConfigBase &
  (
    | { render: DiagramRenderer; Preview?: never }
    | { render?: never; Preview: ComponentType<DiagramPreviewProps> }
  )
