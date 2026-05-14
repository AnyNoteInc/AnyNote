import { ImageResponse } from 'next/og'

import { legalDocLabels, type LegalDocumentSlug } from '@/lib/legal-doc-labels'
import { OgShell, OG_SIZE } from '@/lib/seo/og-shell'

export const runtime = 'edge'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ document: string }> },
) {
  const { document } = await params
  const meta = legalDocLabels[document as LegalDocumentSlug]
  const eyebrow = meta?.eyebrow ?? 'Документ'
  const title = meta?.title ?? 'Юридический документ'

  return new ImageResponse(
    (
      <OgShell background="linear-gradient(135deg, #1e293b 0%, #0f172a 100%)">
        <div style={{ fontSize: 26, opacity: 0.8, letterSpacing: 1.5 }}>{eyebrow.toUpperCase()}</div>
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
      </OgShell>
    ),
    OG_SIZE,
  )
}
