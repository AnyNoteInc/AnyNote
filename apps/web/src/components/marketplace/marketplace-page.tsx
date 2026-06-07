'use client'

import { useState } from 'react'

import { useRouter } from 'next/navigation'

import { Box, Button, Stack, Typography } from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import { MarketplaceHeader } from './marketplace-header'
import { TagRow } from './tag-row'
import { TemplateCard } from './template-card'

function Section({
  title,
  templates,
  onUse,
}: {
  title: string
  templates: Parameters<typeof TemplateCard>[0]['template'][]
  onUse: (id: string) => void
}) {
  if (templates.length === 0) return null
  return (
    <Box sx={{ mb: 4 }}>
      <Stack direction="row" alignItems="baseline" justifyContent="space-between" sx={{ mb: 1.5 }}>
        <Typography variant="h6">{title}</Typography>
        <Button size="small" variant="text">
          Посмотреть все
        </Button>
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

  const market = trpc.template.listMarketplace.useQuery({
    workspaceId,
    tagId,
    query: query.trim() || undefined,
  })
  const useTemplate = trpc.template.createPageFromTemplate.useMutation({
    onSuccess: (res) => router.push(`/workspaces/${workspaceId}/pages/${res.id}`),
  })

  const onUse = (templateId: string) =>
    useTemplate.mutate({ templateId, workspaceId, parentId: null })

  const data = market.data

  return (
    <Box sx={{ maxWidth: 1100, mx: 'auto', p: { xs: 2, md: 4 } }}>
      <MarketplaceHeader query={query} onQuery={setQuery} />
      <TagRow tags={data?.tags ?? []} activeTagId={tagId} onSelect={setTagId} />
      {market.isLoading ? (
        <Typography color="text.secondary">Загрузка…</Typography>
      ) : (
        <>
          <Section
            title="Шаблоны пространства"
            templates={data?.workspaceTemplates ?? []}
            onUse={onUse}
          />
          <Section
            title="Популярные шаблоны"
            templates={data?.popularTemplates ?? []}
            onUse={onUse}
          />
          <Section title="Все шаблоны" templates={data?.allTemplates ?? []} onUse={onUse} />
        </>
      )}
    </Box>
  )
}
