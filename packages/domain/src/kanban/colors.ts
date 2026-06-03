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

// Pick a readable text color (dark on light backgrounds, white on dark) for a
// label rendered with the given hex background. Lives with the palette so every
// label renderer shares one contrast rule.
export function readableTextColor(hex: string): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex)
  if (!m) return '#fff'
  const int = Number.parseInt(m[1]!, 16)
  const r = (int >> 16) & 0xff
  const g = (int >> 8) & 0xff
  const b = int & 0xff
  // Perceived luminance (sRGB) — dark text on light backgrounds.
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.6 ? 'rgba(0, 0, 0, 0.87)' : '#fff'
}
