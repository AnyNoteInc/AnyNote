import { ImageResponse } from 'next/og'

import { OgShell, OG_SIZE } from '@/lib/seo/og-shell'

export const runtime = 'edge'

export async function GET() {
  return new ImageResponse(
    (
      <OgShell background="linear-gradient(135deg, #1e293b 0%, #0f766e 60%, #f97316 100%)">
        <div style={{ fontSize: 28, opacity: 0.85 }}>Тарифы</div>
        <div style={{ fontSize: 84, fontWeight: 700, marginTop: 16, letterSpacing: -1.5 }}>
          От 0 ₽ в месяц
        </div>
        <div style={{ fontSize: 32, marginTop: 32, opacity: 0.9 }}>Персональный · ПРО · МАКС</div>
      </OgShell>
    ),
    OG_SIZE,
  )
}
