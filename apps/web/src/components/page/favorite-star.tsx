"use client"

import { IconButton, StarBorderIcon, StarIcon } from "@repo/ui/components"

import { usePageActions } from "@/hooks/use-page-actions"

type Props = {
  pageId: string
  pageTitle: string | null
  workspaceId: string
  isFavorite: boolean
}

export function FavoriteStar({ pageId, pageTitle, workspaceId, isFavorite }: Props) {
  const { toggleFavorite } = usePageActions(
    { id: pageId, title: pageTitle },
    workspaceId,
    isFavorite,
  )
  return (
    <IconButton
      size="small"
      onClick={toggleFavorite}
      aria-label={isFavorite ? "Убрать из избранного" : "Добавить в избранное"}
      sx={{ color: "text.secondary" }}
    >
      {isFavorite ? (
        <StarIcon sx={{ color: "warning.main", fontSize: 20 }} />
      ) : (
        <StarBorderIcon sx={{ fontSize: 20 }} />
      )}
    </IconButton>
  )
}
