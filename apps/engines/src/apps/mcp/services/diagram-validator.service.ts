import { Injectable } from '@nestjs/common'

import { DiagramValidationError } from '../errors/mcp.errors.js'

export type DiagramKind = 'MERMAID' | 'PLANTUML' | 'LIKEC4'

const MERMAID_KEYWORD =
  /^(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram(-v2)?|erDiagram|gantt|pie|mindmap|journey|gitGraph|quadrantChart|timeline|sankey(-beta)?|xychart(-beta)?|block(-beta)?|requirementDiagram|c4context)\b/i

@Injectable()
export class DiagramValidatorService {
  validate(kind: DiagramKind, source: string): void {
    const trimmed = source.trim()
    if (!trimmed) throw new DiagramValidationError(kind, ['source is empty'])

    if (kind === 'MERMAID') {
      const firstLine = trimmed.split('\n')[0]?.trim() ?? ''
      if (!MERMAID_KEYWORD.test(firstLine)) {
        throw new DiagramValidationError(kind, [
          'first line must declare a Mermaid diagram type (e.g. "graph TD", "sequenceDiagram", "classDiagram")',
        ])
      }
      return
    }

    if (kind === 'PLANTUML') {
      const starts = (trimmed.match(/@start\w+/g) ?? []).length
      const ends = (trimmed.match(/@end\w+/g) ?? []).length
      if (starts === 0 || ends === 0) {
        throw new DiagramValidationError(kind, ['must contain a @start.../@end... block (e.g. @startuml ... @enduml)'])
      }
      if (starts !== ends) {
        throw new DiagramValidationError(kind, [`unbalanced @start (${starts}) and @end (${ends}) markers`])
      }
      return
    }

    // LIKEC4
    if (!/\b(specification|model|views)\b/.test(trimmed)) {
      throw new DiagramValidationError(kind, ['must contain at least one of: specification, model, views block'])
    }
  }
}
