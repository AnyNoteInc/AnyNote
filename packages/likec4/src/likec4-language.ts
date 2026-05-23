import type * as monaco from 'monaco-editor'

export const LIKEC4_LANGUAGE_ID = 'likec4'

/**
 * Minimal Monarch tokenizer for LikeC4 DSL. Highlights structural keywords,
 * relationship arrows, strings and comments. No language server — the base
 * editor worker is enough (parsing/validation happens in the live preview).
 */
export const likec4MonarchLanguage: monaco.languages.IMonarchLanguage & { keywords: string[] } = {
  keywords: [
    'specification',
    'model',
    'views',
    'element',
    'tag',
    'relationship',
    'person',
    'system',
    'softwareSystem',
    'container',
    'component',
    'actor',
    'view',
    'viewof',
    'of',
    'extend',
    'extends',
    'include',
    'exclude',
    'style',
    'styles',
    'autoLayout',
    'group',
    'dynamic',
    'navigateTo',
    'title',
    'description',
    'technology',
    'link',
    'icon',
    'color',
    'shape',
    'with',
    'this',
    'it',
  ],
  tokenizer: {
    root: [
      [/\/\/.*$/, 'comment'],
      [/\/\*/, 'comment', '@comment'],
      [/(->|<-|-\[|\]->|\.\.>|--|::)/, 'operator'],
      [/"[^"]*"/, 'string'],
      [/'[^']*'/, 'string'],
      [/[a-zA-Z_$][\w$]*/, { cases: { '@keywords': 'keyword', '@default': 'identifier' } }],
      [/[{}()[\]]/, '@brackets'],
      [/[;,.]/, 'delimiter'],
    ],
    comment: [
      [/[^/*]+/, 'comment'],
      [/\*\//, 'comment', '@pop'],
      [/[/*]/, 'comment'],
    ],
  },
}

/** Register the likec4 language + tokenizer on a Monaco instance (idempotent). */
export function registerLikec4Language(m: typeof monaco): void {
  const exists = m.languages.getLanguages().some((l) => l.id === LIKEC4_LANGUAGE_ID)
  if (exists) return
  m.languages.register({ id: LIKEC4_LANGUAGE_ID })
  m.languages.setMonarchTokensProvider(LIKEC4_LANGUAGE_ID, likec4MonarchLanguage)
}
