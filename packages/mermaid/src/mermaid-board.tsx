'use client'

import { DiagramBoard, type DiagramConfig } from '@repo/diagram-board'

import { renderMermaid } from './render-mermaid'
import { MERMAID_LANGUAGE_ID, registerMermaidLanguage } from './mermaid-language'
import type { MermaidBoardProps } from './types'

const mermaidConfig: DiagramConfig = {
  docName: 'mermaid',
  languageId: MERMAID_LANGUAGE_ID,
  registerLanguage: registerMermaidLanguage,
  render: renderMermaid,
  idPrefix: 'mermaid',
  placeholder: 'graph TD;\n  A --> B;',
}

export function MermaidBoard(props: MermaidBoardProps) {
  return <DiagramBoard config={mermaidConfig} {...props} />
}
