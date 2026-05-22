import type * as monaco from 'monaco-editor'

export const PLANTUML_LANGUAGE_ID = 'plantuml'

/**
 * Minimal Monarch tokenizer for PlantUML source. Highlights @start/@end
 * directives, common diagram keywords, arrows, strings, and comments. No
 * language server — the base editor worker is enough.
 */
export const plantumlMonarchLanguage: monaco.languages.IMonarchLanguage & { keywords: string[] } = {
  keywords: [
    '@startuml', '@enduml', '@startmindmap', '@endmindmap', '@startgantt', '@endgantt',
    'participant', 'actor', 'boundary', 'control', 'entity', 'database', 'collections', 'queue',
    'class', 'interface', 'abstract', 'enum', 'package', 'namespace', 'component', 'node', 'folder',
    'note', 'left', 'right', 'over', 'of', 'end', 'activate', 'deactivate', 'destroy', 'create',
    'alt', 'else', 'opt', 'loop', 'par', 'break', 'critical', 'group', 'box',
    'if', 'then', 'elseif', 'endif', 'repeat', 'while', 'endwhile', 'fork', 'again',
    'start', 'stop', 'title', 'legend', 'skinparam', 'autonumber', 'hide', 'show', 'as',
  ],
  tokenizer: {
    root: [
      [/\/'/, 'comment', '@comment'],
      [/'.*$/, 'comment'],
      [/(<\|--|--\|>|<--|-->|<-|->|\.\.>|<\.\.|\*--|o--|--|\.\.)/, 'operator'],
      [/"[^"]*"/, 'string'],
      [/@\w+/, { cases: { '@keywords': 'keyword', '@default': 'annotation' } }],
      [/[a-zA-Z_]\w*/, { cases: { '@keywords': 'keyword', '@default': 'identifier' } }],
      [/[{}():,;]/, 'delimiter'],
    ],
    comment: [
      [/'\//, 'comment', '@pop'],
      [/[^']+/, 'comment'],
      [/'/, 'comment'],
    ],
  },
}

/** Register the plantuml language + tokenizer on a Monaco instance (idempotent). */
export function registerPlantumlLanguage(m: typeof monaco): void {
  const exists = m.languages.getLanguages().some((l) => l.id === PLANTUML_LANGUAGE_ID)
  if (exists) return
  m.languages.register({ id: PLANTUML_LANGUAGE_ID })
  m.languages.setMonarchTokensProvider(PLANTUML_LANGUAGE_ID, plantumlMonarchLanguage)
}
