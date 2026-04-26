export type LabelPosition = 'auto' | 'left' | 'right' | 'top' | 'bottom'

export type LabelField =
  | 'identity'
  | 'birthDate'
  | 'deathDate'
  | 'age'
  | 'birthPlace'
  | 'profession'
  | 'characters'
  | 'addictions'
  | 'diseases'

export type LabelFormat = 'brief' | 'full'

export interface PersonLabelConfig {
  position?: LabelPosition
  visibleFields?: LabelField[]
  format?: LabelFormat
  offset?: { x: number; y: number }
  hidden?: boolean
}

export interface RenderableLabel {
  lines: string[]
  position: 'left' | 'right' | 'top' | 'bottom'
  hidden: boolean
  offset?: { x: number; y: number }
}
