"use client"

import { Stack } from "@repo/ui/components"

import { trpc } from "@/trpc/client"

import { FavoriteStar } from "./favorite-star"
import { PageActionsMenu } from "./page-actions-menu"

type Props = {
  pageId: string
  workspaceId: string
}

export function PageActionsToolbar({ pageId, workspaceId }: Props) {
  const pageQ = trpc.page.getById.useQuery({ id: pageId })
  const favoritesQ = trpc.page.listFavorites.useQuery({ workspaceId })

  const title = pageQ.data?.title ?? null
  const pageType = pageQ.data?.type === "EXCALIDRAW" ? "EXCALIDRAW" : "TEXT"
  const isFavorite = (favoritesQ.data ?? []).some((p) => p.id === pageId)

  return (
    <Stack direction="row" spacing={0.5} alignItems="center" className="page-actions-toolbar">
      <FavoriteStar
        pageId={pageId}
        pageTitle={title}
        workspaceId={workspaceId}
        isFavorite={isFavorite}
      />
      <PageActionsMenu
        pageId={pageId}
        pageTitle={title}
        workspaceId={workspaceId}
        pageType={pageType}
        isFavorite={isFavorite}
      />
    </Stack>
  )
}
