'use client'

import { Stack } from '@repo/ui/components'

import { trpc } from '@/trpc/client'
import type { PageItem } from '@/components/workspace/types'

import { FavoriteStar } from './favorite-star'
import { PageActionsMenu } from './page-actions-menu'

type Props = {
  pageId: string
  workspaceId: string
}

export function PageActionsToolbar({ pageId, workspaceId }: Props) {
  // Single source of truth for page metadata used across FavoriteStar +
  // PageActionsMenu + MovePageDialog; dedupe happens via React Query cache,
  // so sibling components read from the same entry.
  const pageQ = trpc.page.getById.useQuery({ id: pageId })
  const favoritesQ = trpc.page.listFavorites.useQuery({ workspaceId })
  const pagesQ = trpc.page.listByWorkspace.useQuery({ workspaceId })

  const title = pageQ.data?.title ?? null
  const rawType = pageQ.data?.type
  const pageType: 'TEXT' | 'EXCALIDRAW' | 'GENOGRAM' | 'MERMAID' | 'PLANTUML' | 'LIKEC4' | 'KANBAN' =
    rawType === 'EXCALIDRAW' ||
    rawType === 'GENOGRAM' ||
    rawType === 'MERMAID' ||
    rawType === 'PLANTUML' ||
    rawType === 'LIKEC4' ||
    rawType === 'KANBAN'
      ? rawType
      : 'TEXT'
  const isFavorite = (favoritesQ.data ?? []).some((p) => p.id === pageId)
  const pages: PageItem[] = pagesQ.data ?? []
  const movedPage = pages.find((p) => p.id === pageId)

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
        movedPage={movedPage}
        pages={pages}
      />
    </Stack>
  )
}
