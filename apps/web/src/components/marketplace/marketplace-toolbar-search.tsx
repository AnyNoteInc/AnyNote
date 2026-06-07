'use client'

import { useRouter, useSearchParams } from 'next/navigation'

import { Box } from '@repo/ui/components'

import { TemplateSearchInput } from '@/components/templates/template-search-input'

export function MarketplaceToolbarSearch() {
  const router = useRouter()
  const params = useSearchParams()
  const q = params.get('q') ?? ''
  const onChange = (v: string) => {
    const next = v.trim() ? `/marketplace?q=${encodeURIComponent(v)}` : '/marketplace'
    router.replace(next, { scroll: false })
  }
  return (
    <Box sx={{ width: { xs: 160, sm: 280 } }}>
      <TemplateSearchInput value={q} onChange={onChange} />
    </Box>
  )
}
