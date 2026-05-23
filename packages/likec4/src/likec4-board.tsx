'use client'

import { DiagramBoard, type DiagramConfig } from '@repo/diagram-board'

import { LIKEC4_LANGUAGE_ID, registerLikec4Language } from './likec4-language'
import { Likec4PagePreview } from './likec4-page-preview'
import type { Likec4BoardProps } from './types'

const PLACEHOLDER = `specification {
  element system
  element person
}
model {
  user = person 'User'
  app  = system 'App'
  user -> app 'uses'
}
views {
  view index {
    include *
  }
}`

const likec4Config: DiagramConfig = {
  docName: 'likec4',
  languageId: LIKEC4_LANGUAGE_ID,
  registerLanguage: registerLikec4Language,
  idPrefix: 'likec4',
  Preview: Likec4PagePreview,
  placeholder: PLACEHOLDER,
}

export function Likec4Board(props: Likec4BoardProps) {
  return <DiagramBoard config={likec4Config} {...props} />
}
