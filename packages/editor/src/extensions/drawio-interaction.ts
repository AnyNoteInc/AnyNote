export type DrawioClickTarget = 'editor' | 'viewer'

export function getDrawioClickTarget({ isEditable }: { isEditable: boolean }): DrawioClickTarget {
  return isEditable ? 'editor' : 'viewer'
}
