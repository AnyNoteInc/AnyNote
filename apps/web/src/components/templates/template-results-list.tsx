'use client'

import { Alert, Box, CircularProgress, Skeleton, Typography } from '@repo/ui/components'

import { TemplateCard } from './template-card'
import { TemplateEmptyState } from './template-empty-state'
import type { TemplateSummary } from './types'

interface Props {
  query: string
  isLoading: boolean
  isError: boolean
  workspaceTemplates: TemplateSummary[]
  globalTemplates: TemplateSummary[]
  selectedId: string | null
  onSelect: (template: TemplateSummary) => void
  onActivate: (template: TemplateSummary) => void
}

function Section({
  title,
  templates,
  selectedId,
  onSelect,
  onActivate,
}: {
  title: string
  templates: TemplateSummary[]
  selectedId: string | null
  onSelect: (t: TemplateSummary) => void
  onActivate: (t: TemplateSummary) => void
}) {
  if (templates.length === 0) return null
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Typography
        variant="overline"
        sx={{ color: 'text.secondary', letterSpacing: '0.06em', px: 0.5 }}
      >
        {title}
      </Typography>
      {templates.map((t) => (
        <TemplateCard
          key={t.id}
          template={t}
          selected={t.id === selectedId}
          onSelect={onSelect}
          onActivate={onActivate}
        />
      ))}
    </Box>
  )
}

/**
 * Results for a non-empty query: workspace templates first, then global ones,
 * with loading / error / empty fallbacks following the app's patterns.
 */
export function TemplateResultsList({
  query,
  isLoading,
  isError,
  workspaceTemplates,
  globalTemplates,
  selectedId,
  onSelect,
  onActivate,
}: Props) {
  if (isError) {
    return (
      <Alert severity="error" sx={{ mt: 1 }}>
        Не удалось загрузить шаблоны. Попробуйте ещё раз.
      </Alert>
    )
  }

  const hasResults = workspaceTemplates.length > 0 || globalTemplates.length > 0

  if (isLoading && !hasResults) {
    return (
      <Box
        role="status"
        aria-label="Загрузка шаблонов"
        sx={{ display: 'flex', flexDirection: 'column', gap: 1, mt: 1 }}
      >
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} variant="rounded" height={72} />
        ))}
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 1 }}>
          <CircularProgress size={18} />
        </Box>
      </Box>
    )
  }

  if (!hasResults) {
    return <TemplateEmptyState query={query} />
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Section
        title="Шаблоны пространства"
        templates={workspaceTemplates}
        selectedId={selectedId}
        onSelect={onSelect}
        onActivate={onActivate}
      />
      <Section
        title="Глобальные шаблоны"
        templates={globalTemplates}
        selectedId={selectedId}
        onSelect={onSelect}
        onActivate={onActivate}
      />
    </Box>
  )
}
