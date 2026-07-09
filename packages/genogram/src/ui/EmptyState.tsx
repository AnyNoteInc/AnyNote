import { Button, Stack, Typography } from '@mui/material'
import { RU } from '../i18n/ru'

interface Props {
  mode: 'editor' | 'readonly'
  onCreate: () => void
}

export function EmptyState({ mode, onCreate }: Props) {
  return (
    <Stack
      spacing={2}
      sx={{
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        minHeight: 300,
      }}
    >
      <Typography variant="h5">{RU.emptyState.title}</Typography>
      <Typography
        variant="body2"
        sx={{
          color: 'text.secondary',
        }}
      >
        {RU.emptyState.subtitle}
      </Typography>
      {mode === 'editor' && (
        <Button variant="contained" size="large" onClick={onCreate}>
          {RU.emptyState.cta}
        </Button>
      )}
    </Stack>
  )
}
