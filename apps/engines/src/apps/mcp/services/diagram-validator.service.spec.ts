import { describe, it, expect } from '@jest/globals'

import { DiagramValidationError } from '../errors/mcp.errors.js'
import { DiagramValidatorService } from './diagram-validator.service.js'

describe('DiagramValidatorService.validate', () => {
  const svc = new DiagramValidatorService()

  it('accepts valid mermaid', () => {
    expect(() => svc.validate('MERMAID', 'graph TD; A-->B')).not.toThrow()
  })

  it('rejects mermaid without a known diagram keyword', () => {
    expect(() => svc.validate('MERMAID', 'hello world')).toThrow(DiagramValidationError)
  })

  it('accepts balanced plantuml', () => {
    expect(() => svc.validate('PLANTUML', '@startuml\nA -> B\n@enduml')).not.toThrow()
  })

  it('rejects plantuml without matching @start/@end', () => {
    expect(() => svc.validate('PLANTUML', '@startuml\nA -> B')).toThrow(DiagramValidationError)
  })

  it('accepts likec4 with a known block', () => {
    expect(() => svc.validate('LIKEC4', 'specification { element system }')).not.toThrow()
  })

  it('rejects empty source', () => {
    expect(() => svc.validate('LIKEC4', '   ')).toThrow(DiagramValidationError)
  })
})
