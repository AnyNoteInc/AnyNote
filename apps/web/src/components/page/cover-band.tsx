import type { ReactNode } from 'react'

import { Box } from '@repo/ui/components'

import { COVER_PRESET_CSS } from './cover-presets'

/*
 * The page cover band (Phase 9A, spec §3): an uploaded/linked image rendered
 * `object-fit: cover`, or a CSS gradient for preset covers. Presentational and
 * hook-free so server components (the public share view) can render it; edit
 * affordances arrive via `actions` (hover-revealed, bottom-right — always
 * visible on touch widths where hover does not exist).
 *
 * Renders nothing when neither a cover URL nor a KNOWN preset key is set, so
 * callers can pass fields straight through without their own guard.
 */

type Props = {
  coverUrl: string | null
  coverPreset: string | null
  /** Band height in px; the default is the spec's ~200 desktop / 120 mobile. */
  height?: number | { xs: number; md: number }
  rounded?: boolean
  actions?: ReactNode
}

export function CoverBand({
  coverUrl,
  coverPreset,
  height = { xs: 120, md: 200 },
  rounded = true,
  actions,
}: Props) {
  // Unknown keys (future presets viewed by an old client) degrade to "no cover"
  // rather than an empty band.
  const presetCss = coverPreset
    ? (COVER_PRESET_CSS as Record<string, string | undefined>)[coverPreset]
    : undefined
  if (!coverUrl && !presetCss) return null

  return (
    <Box
      data-testid="page-cover"
      sx={{
        position: 'relative',
        height,
        borderRadius: rounded ? 1 : 0,
        overflow: 'hidden',
        flexShrink: 0,
        '&:hover .cover-band__actions': { opacity: 1 },
      }}
    >
      {coverUrl ? (
        <Box
          component="img"
          src={coverUrl}
          alt=""
          sx={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            display: 'block',
          }}
        />
      ) : (
        <Box sx={{ position: 'absolute', inset: 0, background: presetCss }} />
      )}
      {actions ? (
        <Box
          className="cover-band__actions"
          sx={{
            position: 'absolute',
            right: 8,
            bottom: 8,
            display: 'flex',
            gap: 1,
            opacity: { xs: 1, md: 0 },
            transition: 'opacity .15s',
            '&:focus-within': { opacity: 1 },
          }}
        >
          {actions}
        </Box>
      ) : null}
    </Box>
  )
}
