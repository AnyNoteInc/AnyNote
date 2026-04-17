import { Box, Skeleton, Stack } from "@repo/ui/components"

import { pageColumnSx } from "@/components/page/column-sx"

export default function PageLoading() {
  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <Box sx={{ ...pageColumnSx, pt: 4, pb: 2 }}>
        <Stack direction="row" spacing={1.5} alignItems="center">
          <Skeleton variant="rounded" width={40} height={40} />
          <Skeleton variant="text" width={280} height={44} />
        </Stack>
      </Box>
      <Box sx={{ ...pageColumnSx, py: 2 }}>
        <Stack spacing={1.25}>
          <Skeleton variant="text" height={24} />
          <Skeleton variant="text" height={24} width="90%" />
          <Skeleton variant="text" height={24} width="75%" />
          <Skeleton variant="rectangular" height={160} sx={{ borderRadius: 1, mt: 2 }} />
          <Skeleton variant="text" height={24} />
          <Skeleton variant="text" height={24} width="85%" />
        </Stack>
      </Box>
    </Box>
  )
}
