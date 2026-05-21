import type * as monaco from 'monaco-editor'

export const MERMAID_LANGUAGE_ID = 'mermaid'

/**
 * Minimal Monarch tokenizer for Mermaid source. Highlights diagram-type
 * keywords, arrows/links, and comments. No language server — the base editor
 * worker is enough.
 */
export const mermaidMonarchLanguage: monaco.languages.IMonarchLanguage & { keywords: string[] } = {
  keywords: [
    'graph',
    'flowchart',
    'sequenceDiagram',
    'classDiagram',
    'stateDiagram',
    'stateDiagram-v2',
    'erDiagram',
    'journey',
    'gantt',
    'pie',
    'gitGraph',
    'mindmap',
    'timeline',
    'subgraph',
    'end',
    'participant',
    'actor',
    'class',
    'state',
    'note',
    'loop',
    'alt',
    'opt',
    'par',
    'TD',
    'TB',
    'BT',
    'RL',
    'LR',
  ],
  tokenizer: {
    root: [
      [/%%.*$/, 'comment'],
      [/(-->|---|==>|===|-\.->|--x|--o|::|:::)/, 'operator'],
      [/"[^"]*"/, 'string'],
      [/\|[^|]*\|/, 'string'],
      [/\[[^\]]*\]/, 'string'],
      [/\{[^}]*\}/, 'string'],
      [
        /[a-zA-Z_$][\w$-]*/,
        { cases: { '@keywords': 'keyword', '@default': 'identifier' } },
      ],
      [/[;,.]/, 'delimiter'],
    ],
  },
}

/** Register the mermaid language + tokenizer on a Monaco instance (idempotent). */
export function registerMermaidLanguage(m: typeof monaco): void {
  const exists = m.languages.getLanguages().some((l) => l.id === MERMAID_LANGUAGE_ID)
  if (exists) return
  m.languages.register({ id: MERMAID_LANGUAGE_ID })
  m.languages.setMonarchTokensProvider(MERMAID_LANGUAGE_ID, mermaidMonarchLanguage)
}
