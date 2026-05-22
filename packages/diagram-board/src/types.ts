import type * as monaco from 'monaco-editor'
import type { DiagramRenderer } from './render-types'

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

export type DiagramConfig = {
  /** Y.Text root name (the collaborative source document). */
  docName: string
  /** Monaco language id set on the editor model. */
  languageId: string
  /** Registers the Monarch language on a Monaco instance (idempotent). */
  registerLanguage: (m: typeof monaco) => void
  /** Produces SVG from source — client-side (mermaid) or server-proxied (plantuml). */
  render: DiagramRenderer
  /** Prefix for render ids and data-testids (e.g. 'mermaid' | 'plantuml'). */
  idPrefix: string
  /** Optional Monaco placeholder shown when the source is empty. */
  placeholder?: string
}
