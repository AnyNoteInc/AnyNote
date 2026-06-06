'use client'

import { Box, Card, CardActionArea, Typography } from '@repo/ui/components'

import { pageTypeIcon } from './page-type-registry'
import { TemplateCreatedAt, TemplateScopeBadge, TemplateUsageBadge } from './template-badges'
import type { TemplateSummary } from './types'

interface Props {
  template: TemplateSummary
  selected?: boolean
  onSelect: (template: TemplateSummary) => void
  onActivate: (template: TemplateSummary) => void
}

/**
 * A single template result rendered as an activatable card. Clicking selects it
 * (updates the preview); a second click — or Enter — activates it (creates the
 * page). The CardActionArea gives us a real button with keyboard support.
 */
export function TemplateCard({ template, selected, onSelect, onActivate }: Props) {
  const Icon = pageTypeIcon(template.type)
  return (
    <Card
      variant="outlined"
      sx={{
        borderColor: selected ? 'primary.main' : 'divider',
        boxShadow: 'none',
      }}
    >
      <CardActionArea
        aria-label={`Создать страницу из шаблона: ${template.title}`}
        onClick={() => {
          onSelect(template)
          onActivate(template)
        }}
        sx={{ p: 1.5, display: 'block' }}
      >
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.25 }}>
          <Box
            sx={{
              flexShrink: 0,
              width: 32,
              height: 32,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 20,
              lineHeight: 1,
            }}
            aria-hidden
          >
            {template.icon ?? <Icon fontSize="small" color="action" />}
          </Box>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.25 }}>
              <Typography variant="subtitle2" noWrap sx={{ flex: 1, minWidth: 0 }}>
                {template.title}
              </Typography>
              <TemplateScopeBadge scope={template.scope} />
            </Box>
            {template.description ? (
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }}
              >
                {template.description}
              </Typography>
            ) : null}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mt: 0.75 }}>
              <TemplateUsageBadge count={template.usageCount} />
              <Box component="span" sx={{ color: 'text.disabled', fontSize: 12 }}>
                ·
              </Box>
              <TemplateCreatedAt date={template.createdAt} />
            </Box>
          </Box>
        </Box>
      </CardActionArea>
    </Card>
  )
}
