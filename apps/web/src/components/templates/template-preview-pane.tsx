'use client'

import { Box, Button, Divider, Typography } from '@repo/ui/components'

import { pageTypeIcon, pageTypeLabel } from './page-type-registry'
import { TemplateCreatedAt, TemplateScopeBadge, TemplateUsageBadge } from './template-badges'
import type { TemplateSummary } from './types'

interface Props {
  template: TemplateSummary | null
  isCreating: boolean
  onUse: (template: TemplateSummary) => void
}

/**
 * Right-hand panel previewing the selected template. We deliberately avoid
 * mounting the full collaborative editor here (it needs a Yjs/Hocuspocus
 * connection); instead we show a compact metadata summary plus a type-aware
 * placeholder, and a primary action to create the page.
 */
export function TemplatePreviewPane({ template, isCreating, onUse }: Props) {
  if (!template) {
    return (
      <Box
        sx={{
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          p: 3,
          textAlign: 'center',
        }}
      >
        <Typography variant="body2" color="text.secondary">
          Выберите шаблон, чтобы увидеть описание
        </Typography>
      </Box>
    )
  }

  const Icon = pageTypeIcon(template.type)

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', p: 2, gap: 1.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Box sx={{ fontSize: 24, lineHeight: 1 }} aria-hidden>
          {template.icon ?? <Icon color="action" />}
        </Box>
        <Typography variant="h6" sx={{ flex: 1, minWidth: 0 }} noWrap>
          {template.title}
        </Typography>
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <TemplateScopeBadge scope={template.scope} />
      </Box>

      {template.description ? (
        <Typography variant="body2" color="text.secondary">
          {template.description}
        </Typography>
      ) : null}

      <Box
        sx={{
          flex: 1,
          minHeight: 80,
          borderRadius: 1,
          border: '1px dashed',
          borderColor: 'divider',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 0.5,
          color: 'text.disabled',
        }}
      >
        <Icon />
        <Typography variant="caption">{pageTypeLabel(template.type)}</Typography>
      </Box>

      <Divider />

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <TemplateUsageBadge count={template.usageCount} />
        <Box component="span" sx={{ color: 'text.disabled', fontSize: 12 }}>
          ·
        </Box>
        <TemplateCreatedAt date={template.createdAt} />
      </Box>

      <Button
        variant="contained"
        fullWidth
        disabled={isCreating}
        onClick={() => onUse(template)}
      >
        Использовать шаблон
      </Button>
    </Box>
  )
}
