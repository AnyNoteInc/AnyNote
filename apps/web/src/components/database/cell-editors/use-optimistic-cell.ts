'use client'

import { createContext, useContext } from 'react'

import { trpc } from '@/trpc/client'

import { useOptimisticRows } from '../use-view-rows'

/**
 * The active view's id, provided by the renderer/table so the shared cell editors
 * patch the RIGHT `listRows` cache entry (keyed by `pageId+viewId`). `undefined`
 * means the default view (no explicit `viewId`), which the embedded-database embed
 * uses. Cell editors read it via `useActiveViewId()` so their prop interface stays
 * unchanged across the Phase-4A fetch split.
 */
const ActiveViewIdContext = createContext<string | undefined>(undefined)

export const ActiveViewIdProvider = ActiveViewIdContext.Provider

export function useActiveViewId(): string | undefined {
  return useContext(ActiveViewIdContext)
}

/**
 * Shared optimistic-update helper for cell editors. Patches the active view's
 * `database.listRows` infinite-query cache in place (rows moved out of
 * `getByPage` in the Phase-4A fetch split + per-view in Phase E), invalidates
 * sibling views (a cell change can move a row across another view's filter/sort),
 * then persists; on error it rolls the active view back to server truth.
 */
export function useCellUpdate(pageId: string) {
  const viewId = useActiveViewId()
  const { patchCell, invalidateActive } = useOptimisticRows(pageId, viewId)

  const mutation = trpc.database.updateCellValue.useMutation({
    onError: () => invalidateActive(),
  })

  /**
   * Optimistically write a cell then persist. `value` is the stored shape
   * (string/number/boolean/string[]/null); DATE editors pass an ISO string and
   * the domain re-coerces it via z.preprocess (no superjson on the browser
   * client). The optimistic patch uses the same stored shape the view-model
   * holds so reads stay consistent.
   */
  function commit(rowId: string, propertyId: string, value: unknown) {
    patchCell(rowId, propertyId, value)
    mutation.mutate({ pageId, rowId, propertyId, value })
  }

  return { commit, isPending: mutation.isPending }
}
