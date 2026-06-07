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
    <Box
      sx={{
        width: { xs: 160, sm: 280 },
        // Compact height to keep the top toolbar row slim.
        '& .MuiInputBase-root': { height: 32 },
        '& .MuiInputBase-input': { py: 0 },
      }}
    >
      <TemplateSearchInput value={q} onChange={onChange} />
    </Box>
  )
}
