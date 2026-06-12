// Web-side CSS map for the page-cover gradient presets. The CANONICAL key
// whitelist lives in `@repo/domain/pages/dto/cover-presets.ts` (a pure leaf —
// deep-imported here per the client-import rule, never via the domain barrel);
// this map is keyed by the exact same names and drift-guarded by
// `apps/web/test/cover-presets.test.ts`, which imports both.
import {
  COVER_PRESET_KEYS,
  type CoverPresetKey,
} from '@repo/domain/pages/dto/cover-presets.ts'

export const COVER_PRESET_CSS: Record<CoverPresetKey, string> = {
  sunset: 'linear-gradient(135deg, #f6d365 0%, #fda085 100%)',
  ocean: 'linear-gradient(135deg, #2193b0 0%, #6dd5ed 100%)',
  forest: 'linear-gradient(135deg, #134e5e 0%, #71b280 100%)',
  lavender: 'linear-gradient(135deg, #b993d6 0%, #8ca6db 100%)',
  peach: 'linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%)',
  slate: 'linear-gradient(135deg, #485563 0%, #29323c 100%)',
  aurora: 'linear-gradient(135deg, #00c9ff 0%, #92fe9d 100%)',
  sand: 'linear-gradient(135deg, #ede5d8 0%, #cdb79a 100%)',
  berry: 'linear-gradient(135deg, #b24592 0%, #f15f79 100%)',
  midnight: 'linear-gradient(135deg, #232526 0%, #414345 100%)',
}

export { COVER_PRESET_KEYS, type CoverPresetKey }
