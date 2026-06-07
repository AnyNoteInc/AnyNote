'use client'

import { useState } from 'react'

import { useRouter } from 'next/navigation'

import { Box, Button, Stack, Typography } from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import { MarketplaceHeader } from './marketplace-header'
import { TagRow } from './tag-row'
import { TemplateCard } from './template-card'

type SectionKey = 'workspace' | 'popular' | 'all'

const SECTION_DEFAULT_LIMIT = 8
const SECTION_EXPANDED_LIMIT = 50

function Section({
  title,
  templates,
  onUse,
  onSeeAll,
}: {
  title: string
  templates: Parameters<typeof TemplateCard>[0]['template'][]
  onUse: (id: string) => void
  onSeeAll?: () => void
}) {
  if (templates.length === 0) return null
  return (
    <Box sx={{ mb: 4 }}>
      <Stack direction="row" alignItems="baseline" justifyContent="space-between" sx={{ mb: 1.5 }}>
        <Typography variant="h6">{title}</Typography>
        {onSeeAll && (
          <Button size="small" variant="text" onClick={onSeeAll}>
            Посмотреть все
          </Button>
        )}
      </Stack>
      <Box
        sx={{
          display: 'grid',
          gap: 1.5,
          gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: 'repeat(4, 1fr)' },
        }}
      >
        {templates.map((t) => (
          <TemplateCard key={t.id} template={t} onUse={() => onUse(t.id)} />
        ))}
      </Box>
    </Box>
  )
}

export function MarketplacePage({ workspaceId }: { workspaceId: string }) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [tagId, setTagId] = useState<string | null>(null)
  const [expandedSection, setExpandedSection] = useState<SectionKey | null>(null)

  const sectionLimit = expandedSection ? SECTION_EXPANDED_LIMIT : SECTION_DEFAULT_LIMIT

  const market = trpc.template.listMarketplace.useQuery({
    workspaceId,
    tagId,
    query: query.trim() || undefined,
    sectionLimit,
  })
  const useTemplate = trpc.template.createPageFromTemplate.useMutation({
    onSuccess: (res) => router.push(`/pages/${res.id}`),
  })

  const onUse = (templateId: string) =>
    useTemplate.mutate({ templateId, workspaceId, parentId: null })

  const handleSeeAll = (section: SectionKey) => () => {
    setExpandedSection((prev) => (prev === section ? null : section))
    // Clear tag filter so the full section is visible
    setTagId(null)
  }

  const data = market.data

  // In expanded mode, show only the expanded section's templates
  const workspaceTemplates = data?.workspaceTemplates ?? []
  const popularTemplates = data?.popularTemplates ?? []
  const allTemplates = data?.allTemplates ?? []

  return (
    <Box sx={{ maxWidth: 1100, mx: 'auto', p: { xs: 2, md: 4 } }}>
      <MarketplaceHeader query={query} onQuery={setQuery} />
      <TagRow tags={data?.tags ?? []} activeTagId={tagId} onSelect={setTagId} />
      {market.isLoading ? (
        <Typography color="text.secondary">Загрузка…</Typography>
      ) : expandedSection ? (
        <>
          {expandedSection === 'workspace' && (
            <Section
              title="Шаблоны пространства"
              templates={workspaceTemplates}
              onUse={onUse}
              onSeeAll={handleSeeAll('workspace')}
            />
          )}
          {expandedSection === 'popular' && (
            <Section
              title="Популярные шаблоны"
              templates={popularTemplates}
              onUse={onUse}
              onSeeAll={handleSeeAll('popular')}
            />
          )}
          {expandedSection === 'all' && (
            <Section
              title="Все шаблоны"
              templates={allTemplates}
              onUse={onUse}
              onSeeAll={handleSeeAll('all')}
            />
          )}
        </>
      ) : (
        <>
          <Section
            title="Шаблоны пространства"
            templates={workspaceTemplates}
            onUse={onUse}
            onSeeAll={handleSeeAll('workspace')}
          />
          <Section
            title="Популярные шаблоны"
            templates={popularTemplates}
            onUse={onUse}
            onSeeAll={handleSeeAll('popular')}
          />
          <Section
            title="Все шаблоны"
            templates={allTemplates}
            onUse={onUse}
            onSeeAll={handleSeeAll('all')}
          />
        </>
      )}
    </Box>
  )
}
