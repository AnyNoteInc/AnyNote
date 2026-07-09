'use client'

import { Chip, Stack } from '@repo/ui/components'

import { TagIcon } from './tag-icon'

type Tag = { id: string; name: string; icon: string }

export function TagRow({
  tags,
  activeTagId,
  onSelect,
}: {
  tags: Tag[]
  activeTagId: string | null
  onSelect: (tagId: string | null) => void
}) {
  return (
    <Stack direction="row" spacing={1} useFlexGap sx={{ mb: 3, flexWrap: 'wrap' }}>
      <Chip
        label="Все"
        clickable
        color={activeTagId === null ? 'primary' : 'default'}
        variant={activeTagId === null ? 'filled' : 'outlined'}
        onClick={() => onSelect(null)}
      />
      {tags.map((t) => (
        <Chip
          key={t.id}
          icon={<TagIcon name={t.icon} fontSize="small" />}
          label={t.name}
          clickable
          color={activeTagId === t.id ? 'primary' : 'default'}
          variant={activeTagId === t.id ? 'filled' : 'outlined'}
          onClick={() => onSelect(t.id)}
        />
      ))}
    </Stack>
  )
}
