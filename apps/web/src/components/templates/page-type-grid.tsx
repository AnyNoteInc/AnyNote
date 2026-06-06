'use client'

import { Box, Card, CardActionArea, Typography } from '@repo/ui/components'

import { CREATABLE_PAGE_TYPES, type CreatablePageType } from './page-type-registry'

interface Props {
  onSelect: (type: CreatablePageType) => void
}

/**
 * Grid of creatable page types shown when the search box is empty. Mirrors the
 * old CreatePageMenu's options (Текст, Холст, Draw.io, Генограмма, Канбан,
 * MermaidJS, PlantUML, LikeC4) — no DATABASE/FORM, which have no editor.
 */
export function PageTypeGrid({ onSelect }: Props) {
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
          <Card key={type} variant="outlined" sx={{ boxShadow: 'none' }}>
            <CardActionArea
              aria-label={`Создать страницу: ${label}`}
              onClick={() => onSelect(type)}
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
        ))}
      </Box>
    </Box>
  )
}
