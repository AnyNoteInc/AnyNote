import { Box, CircularProgress, Stack, Typography } from '@repo/ui/components'

export type PageLoadingProps = {
  label?: string
}

export function PageLoading({ label = 'Загрузка…' }: PageLoadingProps) {
  return (
    <Box
      sx={{
        minHeight: '60vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Stack spacing={2} alignItems="center">
        <CircularProgress size={32} />
        <Typography variant="body2" color="text.secondary">
          {label}
        </Typography>
      </Stack>
    </Box>
  )
}
