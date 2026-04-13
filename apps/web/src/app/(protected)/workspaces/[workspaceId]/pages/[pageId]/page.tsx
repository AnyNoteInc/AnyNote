"use client"

import { use } from "react"

import { Box, Typography } from "@repo/ui/components"

import { trpc } from "@/trpc/client"

type Props = {
  params: Promise<{ workspaceId: string; pageId: string }>
}

export default function PageView({ params }: Props) {
  const { pageId } = use(params)
  const page = trpc.page.getById.useQuery({ id: pageId })

  if (!page.data) return null

  return (
    <Box sx={{ p: 4, maxWidth: 710, mx: "auto" }}>
      <Typography variant="h4">{page.data.title ?? "Untitled"}</Typography>
    </Box>
  )
}
