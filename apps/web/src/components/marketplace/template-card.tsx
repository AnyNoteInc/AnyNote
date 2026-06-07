'use client'

import { Box, Card, CardActionArea, Stack, StarIcon, Typography } from '@repo/ui/components'

import { TemplatePreview } from './template-preview'

type CardTemplate = {
  id: string
  title: string
  description: string | null
  icon: string | null
  previewColor: string | null
  previewContent: unknown
  averageRating: number
  usageCount: number
  author: { name: string }
}

export function TemplateCard({ template, onOpen }: { template: CardTemplate; onOpen: () => void }) {
  return (
    <Card variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
      <CardActionArea onClick={onOpen}>
        <TemplatePreview
          id={template.id}
          content={template.previewContent}
          icon={template.icon}
          previewColor={template.previewColor}
        />
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
