'use client'

import { Box, Card, CardActionArea, DescriptionIcon, Typography } from '@repo/ui/components'

import {
  CREATABLE_PAGE_TYPES,
  SPECIAL_CREATE_TILES,
  type CreatablePageType,
  type SpecialCreateType,
} from './page-type-registry'

type IconComponent = typeof DescriptionIcon

interface Props {
  onSelect: (type: CreatablePageType) => void
  /** Selecting a special tile (Дашборд / Загрузить встречу) — those don't use page.create. */
  onSelectSpecial: (type: SpecialCreateType) => void
  /** Whether the workspace plan allows meeting transcription; gates the MEETING tile. */
  meetingsEnabled: boolean
}

function TypeTile({
  label,
  Icon,
  onClick,
}: {
  label: string
  Icon: IconComponent
  onClick: () => void
}) {
  return (
    <Card variant="outlined" sx={{ boxShadow: 'none' }}>
      <CardActionArea
        aria-label={`Создать страницу: ${label}`}
        onClick={onClick}
        sx={{
          p: 1.5,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 0.75,
        }}
      >
        <Icon fontSize="small" color="action" />
        <Typography variant="body2" noWrap>
          {label}
        </Typography>
      </CardActionArea>
    </Card>
  )
}

/**
 * Grid of creatable page types shown when the search box is empty. Mirrors the
 * old CreatePageMenu's options (Текст, Холст, Draw.io, Генограмма, Канбан,
 * MermaidJS, PlantUML, LikeC4) plus the special create actions (Дашборд and —
 * plan permitting — Загрузить встречу), which the dialog routes to their own
 * create paths rather than the generic page.create.
 */
export function PageTypeGrid({ onSelect, onSelectSpecial, meetingsEnabled }: Props) {
  const specialTiles = SPECIAL_CREATE_TILES.filter(
    (tile) => tile.type !== 'MEETING' || meetingsEnabled,
  )

  return (
    <Box>
      <Typography
        variant="overline"
        sx={{ color: 'text.secondary', letterSpacing: '0.06em', px: 0.5 }}
      >
        Типы страниц
      </Typography>
      <Box
        sx={{
          mt: 1,
          display: 'grid',
          gridTemplateColumns: { xs: '1fr 1fr', sm: '1fr 1fr 1fr 1fr' },
          gap: 1,
        }}
      >
        {CREATABLE_PAGE_TYPES.map(({ type, label, Icon }) => (
          <TypeTile key={type} label={label} Icon={Icon} onClick={() => onSelect(type)} />
        ))}
        {specialTiles.map(({ type, label, Icon }) => (
          <TypeTile key={type} label={label} Icon={Icon} onClick={() => onSelectSpecial(type)} />
        ))}
      </Box>
    </Box>
  )
}
