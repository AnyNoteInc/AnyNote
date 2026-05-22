'use client'

import { DiagramBoard, type DiagramConfig } from '@repo/diagram-board'

import { renderPlantuml } from './render-plantuml'
import { PLANTUML_LANGUAGE_ID, registerPlantumlLanguage } from './plantuml-language'
import type { PlantumlBoardProps } from './types'

const plantumlConfig: DiagramConfig = {
  docName: 'plantuml',
  languageId: PLANTUML_LANGUAGE_ID,
  registerLanguage: registerPlantumlLanguage,
  render: renderPlantuml,
  idPrefix: 'plantuml',
  placeholder: '@startuml\n\n@enduml',
}

export function PlantumlBoard(props: PlantumlBoardProps) {
  return <DiagramBoard config={plantumlConfig} {...props} />
}
