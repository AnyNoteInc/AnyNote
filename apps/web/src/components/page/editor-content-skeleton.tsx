'use client'

import { Box, Skeleton, Stack } from '@repo/ui/components'

import { pageColumnSx } from './column-sx'

export function EditorSkeletonRows() {
  return (
    <Stack spacing={1.25}>
      <Skeleton variant="text" height={24} />
      <Skeleton variant="text" height={24} width="90%" />
      <Skeleton variant="text" height={24} width="75%" />
      <Skeleton variant="rectangular" height={160} sx={{ borderRadius: 1, mt: 2 }} />
      <Skeleton variant="text" height={24} />
      <Skeleton variant="text" height={24} width="85%" />
    </Stack>
  )
}

export function EditorContentSkeleton() {
  return (
    <Box sx={{ ...pageColumnSx, py: 2 }}>
      <EditorSkeletonRows />
    </Box>
  )
}
