import { ImageResponse } from 'next/og'

import { legalDocumentBySlug, type LegalDocumentSlug } from '@/lib/legal-documents'
import { siteConfig } from '@/lib/seo/site-config'

export const runtime = 'nodejs'
export const alt = `Документ · ${siteConfig.brandRu}`
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default async function OpenGraphImage({
  params,
}: {
  params: Promise<{ document: string }>
}) {
  const { document } = await params
  const meta = legalDocumentBySlug[document as LegalDocumentSlug]
  const eyebrow = meta?.eyebrow ?? 'Документ'
  const title = meta?.title ?? 'Юридический документ'

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
            'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
          color: 'white',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <div style={{ fontSize: 26, opacity: 0.8, letterSpacing: 1.5 }}>
          {eyebrow.toUpperCase()}
        </div>
        <div
          style={{
            fontSize: 72,
            fontWeight: 700,
            marginTop: 20,
            letterSpacing: -1,
            lineHeight: 1.1,
          }}
        >
          {title}
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
