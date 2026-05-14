import { ImageResponse } from 'next/og'

import { siteConfig } from '@/lib/seo/site-config'

export const runtime = 'edge'
export const alt = siteConfig.brandRu
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
            'linear-gradient(135deg, #0f766e 0%, #1e293b 50%, #f97316 100%)',
          color: 'white',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <div style={{ fontSize: 96, fontWeight: 700, letterSpacing: -2 }}>
          {siteConfig.brandRu}
        </div>
        <div
          style={{
            fontSize: 36,
            marginTop: 32,
            opacity: 0.92,
            lineHeight: 1.3,
          }}
        >
          {siteConfig.description}
        </div>
        <div
          style={{
            fontSize: 22,
            marginTop: 48,
            opacity: 0.7,
            display: 'flex',
          }}
        >
          {siteConfig.url.replace(/^https?:\/\//, '')}
        </div>
      </div>
    ),
    size,
  )
}
