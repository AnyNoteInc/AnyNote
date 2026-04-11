import type { Block, Page } from "@repo/db"

import { Box, Stack, Typography } from "@repo/ui/components"

import { BlockRenderer } from "./block-renderer"

type Props = {
  page: Page
  blocks: Array<Block & { depth: number }>
}

export function PageView({ page, blocks }: Props) {
  return (
    <Box sx={{ maxWidth: 720, mx: "auto", px: 3, py: 6 }}>
      <Stack spacing={1} sx={{ mb: 4 }}>
        {page.icon ? (
          <Typography sx={{ fontSize: 40, lineHeight: 1 }}>{page.icon}</Typography>
        ) : null}
        <Typography variant="h3">{page.title ?? "Untitled"}</Typography>
      </Stack>
      {blocks.map((block) => (
        <BlockRenderer key={block.id} block={block} />
      ))}
    </Box>
  )
}
