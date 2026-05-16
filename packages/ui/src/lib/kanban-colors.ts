export const KANBAN_LABEL_COLORS = [
  { name: 'red', hex: '#EF4444' },
  { name: 'orange', hex: '#F97316' },
  { name: 'yellow', hex: '#EAB308' },
  { name: 'green', hex: '#22C55E' },
  { name: 'teal', hex: '#14B8A6' },
  { name: 'blue', hex: '#3B82F6' },
  { name: 'purple', hex: '#A855F7' },
  { name: 'pink', hex: '#EC4899' },
  { name: 'gray', hex: '#6B7280' },
] as const

export const KANBAN_LABEL_COLOR_HEXES: ReadonlySet<string> = new Set(
  KANBAN_LABEL_COLORS.map((c) => c.hex),
)
