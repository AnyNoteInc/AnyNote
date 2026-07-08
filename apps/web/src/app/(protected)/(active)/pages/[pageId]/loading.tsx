import { Box, Skeleton, Stack } from '@repo/ui/components'

import { pageColumnSx } from '@/components/page/column-sx'
import { EditorSkeletonRows } from '@/components/page/editor-content-skeleton'

export default function PageLoading() {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <Box sx={{ ...pageColumnSx, pt: 4, pb: 2 }}>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
          <Skeleton variant="rounded" width={40} height={40} />
          <Skeleton variant="text" width={280} height={44} />
        </Stack>
      </Box>
      <Box sx={{ ...pageColumnSx, py: 2 }}>
        <EditorSkeletonRows />
      </Box>
    </Box>
  )
}
