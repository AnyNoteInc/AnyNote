// Page cover gradient presets (Phase 9A). This is the CANONICAL whitelist —
// the server validates `coverPreset ∈ COVER_PRESET_KEYS`; the web-side CSS
// gradient map is keyed by the same names and drift-guarded by a unit test
// importing both. Pure leaf (no imports) so client components may deep-import
// it (`@repo/domain/pages/dto/cover-presets.ts`) without touching the barrel.
export const COVER_PRESET_KEYS = [
  'sunset',
  'ocean',
  'forest',
  'lavender',
  'peach',
  'slate',
  'aurora',
  'sand',
  'berry',
  'midnight',
] as const

export type CoverPresetKey = (typeof COVER_PRESET_KEYS)[number]
