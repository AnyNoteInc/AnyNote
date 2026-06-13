import { ImageResponse } from 'next/og'

import { renderBrandIconArt } from '@/lib/brand-icon'
import { PWA_BACKGROUND_COLOR } from '@/lib/pwa'

// A plain route handler (not the `icon.tsx` metadata convention) so the URL is
// stable (`/icon-maskable`) for the manifest. Convention files with multiple
// icons get hash-suffixed URLs; this one must be addressable from manifest.ts.
export const dynamic = 'force-static'

const size = { width: 512, height: 512 }

// Maskable icons are cropped by the platform mask: fill the full canvas with
// the brand dark-neutral and keep the art inside the ~80% safe zone.
const SAFE_ZONE_RATIO = 0.8

export function GET() {
  const padding = (size.width * (1 - SAFE_ZONE_RATIO)) / 2
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          background: PWA_BACKGROUND_COLOR,
          padding: `${padding}px`,
        }}
      >
        {renderBrandIconArt(Math.round(size.width * SAFE_ZONE_RATIO))}
      </div>
    ),
    size,
  )
}
