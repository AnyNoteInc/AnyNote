'use client'

import { Box, Stack, Typography } from '@repo/ui/components'
import type { FormSection } from '@repo/domain/database/forms'

interface FormSectionMapProps {
  readonly sections: readonly FormSection[]
  readonly activeSectionId?: string
  readonly onSelect?: (sectionId: string) => void
}

export function FormSectionMap({ sections, activeSectionId, onSelect }: FormSectionMapProps) {
  return (
    <Stack
      component="nav"
      aria-label="Разделы формы"
      sx={{ position: 'relative', gap: 0.5, py: 0.5 }}
    >
      <Box
        aria-hidden
        sx={{ position: 'absolute', left: 11, top: 18, bottom: 18, width: 1.5, bgcolor: 'divider' }}
      />
      {sections.map((section, index) => {
        const active = section.id === activeSectionId
        return (
          <Box
            component="button"
            type="button"
            key={section.id}
            onClick={() => onSelect?.(section.id)}
            aria-current={active ? 'step' : undefined}
            sx={{
              appearance: 'none',
              border: 0,
              bgcolor: active ? 'action.selected' : 'transparent',
              color: active ? 'text.primary' : 'text.secondary',
              cursor: onSelect ? 'pointer' : 'default',
              display: 'grid',
              gridTemplateColumns: '24px minmax(0, 1fr)',
              alignItems: 'center',
              gap: 1,
              minHeight: 44,
              px: 0.75,
              borderRadius: 1.5,
              textAlign: 'left',
              '&:focus-visible': {
                outline: '2px solid',
                outlineColor: 'primary.main',
                outlineOffset: 2,
              },
            }}
          >
            <Box
              aria-hidden
              sx={{
                zIndex: 1,
                width: 22,
                height: 22,
                borderRadius: '50%',
                display: 'grid',
                placeItems: 'center',
                bgcolor: active ? 'primary.main' : 'background.paper',
                color: active ? 'primary.contrastText' : 'text.secondary',
                border: 1,
                borderColor: active ? 'primary.main' : 'divider',
                fontSize: 11,
                fontWeight: 700,
              }}
            >
              {index + 1}
            </Box>
            <Typography variant="caption" sx={{ fontWeight: active ? 700 : 500 }} noWrap>
              {section.title}
            </Typography>
          </Box>
        )
      })}
    </Stack>
  )
}
