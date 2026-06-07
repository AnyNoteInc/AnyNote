'use client'

import { Box } from '@repo/ui/components'

import { tiptapJsonToHtml } from '@/server/page-export/tiptap-to-html'

/** Deterministic gradient from the template id (used when there's no content). */
function gradientFor(id: string): string {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) % 360
  const h2 = (hash + 40) % 360
  return `linear-gradient(135deg, hsl(${hash} 70% 92%), hsl(${h2} 70% 85%))`
}

export function TemplatePreview({
  id,
  content,
  icon,
  previewColor,
}: {
  id: string
  content: unknown
  icon: string | null
  previewColor: string | null
}) {
  const html = tiptapJsonToHtml(content)
  if (!html) {
    // Fallback: icon on a colored box (previous behavior)
    return (
      <Box
        sx={{
          height: 140,
          background: previewColor ?? gradientFor(id),
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 34,
        }}
      >
        {icon ?? '📄'}
      </Box>
    )
  }
  return (
    <Box
      sx={{
        height: 140,
        overflow: 'hidden',
        position: 'relative',
        bgcolor: 'background.paper',
        borderBottom: '1px solid',
        borderColor: 'divider',
      }}
    >
      <Box
        aria-hidden
        sx={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '200%',
          transform: 'scale(0.5)',
          transformOrigin: 'top left',
          p: 1.5,
          pointerEvents: 'none',
          fontSize: 13,
          color: 'text.primary',
          '& h1,& h2,& h3': { fontSize: 16, m: 0, mb: 0.5 },
          '& p': { m: 0, mb: 0.5 },
          '& ul,& ol': { m: 0, pl: 2 },
          '& img': { maxWidth: '100%' },
        }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </Box>
  )
}
