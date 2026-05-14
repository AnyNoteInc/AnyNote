import { ImageResponse } from 'next/og'

import { siteConfig } from '@/lib/seo/site-config'

export const runtime = 'edge'
export const alt = `Тарифы · ${siteConfig.brandRu}`
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default async function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          height: '100%',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: 80,
          background:
            'linear-gradient(135deg, #1e293b 0%, #0f766e 60%, #f97316 100%)',
          color: 'white',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <div style={{ fontSize: 28, opacity: 0.85 }}>Тарифы</div>
        <div
          style={{
            fontSize: 84,
            fontWeight: 700,
            marginTop: 16,
            letterSpacing: -1.5,
          }}
        >
          От 0 ₽ в месяц
        </div>
        <div style={{ fontSize: 32, marginTop: 32, opacity: 0.9 }}>
          Персональный · ПРО · МАКС
        </div>
        <div
          style={{ fontSize: 22, marginTop: 56, opacity: 0.7, display: 'flex' }}
        >
          {siteConfig.brandRu} · {siteConfig.url.replace(/^https?:\/\//, '')}
        </div>
      </div>
    ),
    size,
  )
}
