'use client'

import { Box, Card, CardActionArea, Stack, StarIcon, Typography } from '@repo/ui/components'

type CardTemplate = {
  id: string
  title: string
  description: string | null
  icon: string | null
  previewColor: string | null
  averageRating: number
  usageCount: number
  author: { name: string }
}

/** Deterministic gradient from the template id (used when previewColor is null). */
function gradientFor(id: string): string {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) % 360
  const h2 = (hash + 40) % 360
  return `linear-gradient(135deg, hsl(${hash} 70% 92%), hsl(${h2} 70% 85%))`
}

export function TemplateCard({ template, onUse }: { template: CardTemplate; onUse: () => void }) {
  const bg = template.previewColor ?? gradientFor(template.id)
  return (
    <Card variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
      <CardActionArea onClick={onUse}>
        <Box
          sx={{
            height: 104,
            background: bg,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 30,
          }}
        >
          {template.icon ?? '📄'}
        </Box>
        <Box sx={{ p: 1.5 }}>
          <Typography variant="subtitle2" noWrap>
            {template.title}
          </Typography>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: 'block', height: 32, overflow: 'hidden' }}
          >
            {template.description ?? ''}
          </Typography>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1 }}>
            <Typography variant="caption" color="text.secondary" noWrap sx={{ maxWidth: 90 }}>
              {template.author.name}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              ·
            </Typography>
            <Stack direction="row" spacing={0.25} alignItems="center">
              <StarIcon sx={{ fontSize: 13, color: 'warning.main' }} />
              <Typography variant="caption" color="text.secondary">
                {template.averageRating.toFixed(1)}
              </Typography>
            </Stack>
            <Typography variant="caption" color="text.secondary">
              ·
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {template.usageCount} установок
            </Typography>
          </Stack>
        </Box>
      </CardActionArea>
    </Card>
  )
}
