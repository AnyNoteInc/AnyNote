'use client'

import { trpc } from '@/trpc/client'
import type { RouterOutputs } from '@/trpc/client'

import type { DatabaseRowView } from './types'

export type ListRowsResult = RouterOutputs['database']['listRows']

/** The infinite-query cache shape react-query stores for `listRows`. */
interface InfiniteListRows {
  pages: ListRowsResult[]
  pageParams: unknown[]
}

/** A page of rows is fetched at this size; the table shows a "Загрузить ещё". */
export const VIEW_ROWS_PAGE_SIZE = 100

/** The exact input the `listRows` infinite-query is keyed under (`pageId`+`viewId`+`limit`). */
function rowsInput(pageId: string, viewId: string | undefined) {
  return { pageId, viewId, limit: VIEW_ROWS_PAGE_SIZE }
}

/**
 * Fetch the active view's rows, view-aware and paginated. Wraps
 * `database.listRows.useInfiniteQuery` (server-applied filters/sorts/visibility
 * come baked into each page) and flattens the page list into a single `rows`
 * array. `viewId` keys the cache so each view caches independently; switching
 * tabs swaps cache entries rather than refetching the same one.
 */
export function useViewRows(pageId: string, viewId: string | undefined, enabled = true) {
  const query = trpc.database.listRows.useInfiniteQuery(rowsInput(pageId, viewId), {
    enabled,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  })

  const rows: DatabaseRowView[] = query.data?.pages.flatMap((p) => p.rows) ?? []

  return {
    rows,
    fetchNextPage: query.fetchNextPage,
    hasNextPage: query.hasNextPage,
    isLoading: query.isLoading,
    isFetchingNextPage: query.isFetchingNextPage,
    error: query.error,
  }
}

/**
 * Grouped rows for the BOARD layout (one bucket per the view's groupBy option +
 * a trailing empty bucket). No pagination — a focused board view is bounded.
 */
export function useGroupedRows(pageId: string, viewId: string) {
  const query = trpc.database.listGroupedRows.useQuery(
    { pageId, viewId },
    { retry: false },
  )
  return {
    groups: query.data?.groups ?? [],
    isLoading: query.isLoading,
    error: query.error,
  }
}

/**
 * Optimistic patch helpers for the ACTIVE view's rows. A cell/title edit patches
 * THIS view's `listRows` infinite-query cache in place (so the edit is instant),
 * then invalidates the OTHER views' `listRows` for the same source — a cell
 * change can move a row in/out of a sibling view's filter or reorder its sort, so
 * those refetch lazily on next focus. On the mutation's own error path the caller
 * invalidates this view to roll back to server truth.
 */
export function useOptimisticRows(pageId: string, viewId: string | undefined) {
  const utils = trpc.useUtils()

  const setData = utils.database.listRows.setInfiniteData as (
    input: ReturnType<typeof rowsInput>,
    updater: (prev: InfiniteListRows | undefined) => InfiniteListRows | undefined,
  ) => void

  function patchRows(updater: (row: DatabaseRowView) => DatabaseRowView) {
    setData(rowsInput(pageId, viewId), (current) => {
      if (!current) return current
      return {
        ...current,
        pages: current.pages.map((page) => ({
          ...page,
          rows: page.rows.map(updater),
        })),
      }
    })
  }

  /** Patch a single cell on the active view's cache, then invalidate siblings. */
  function patchCell(rowId: string, propertyId: string, value: unknown) {
    patchRows((row) =>
      row.rowId === rowId ? { ...row, cells: { ...row.cells, [propertyId]: value } } : row,
    )
    invalidateSiblings()
  }

  /** Patch a row's title on the active view's cache, then invalidate siblings. */
  function patchTitle(rowId: string, title: string) {
    patchRows((row) => (row.rowId === rowId ? { ...row, title } : row))
    invalidateSiblings()
  }

  /**
   * Invalidate every OTHER `listRows` query for this `pageId` (any `viewId`) so a
   * cross-view filter/sort move surfaces on next read. Predicate-scoped to leave
   * the active view's freshly-patched cache untouched.
   */
  function invalidateSiblings() {
    utils.database.listRows.invalidate(undefined, {
      predicate: (q) => {
        const input = (q.queryKey[1] as { input?: { pageId?: string; viewId?: string } } | undefined)
          ?.input
        return input?.pageId === pageId && input?.viewId !== viewId
      },
    })
  }

  /** Roll back to server truth for THIS view (used on a mutation error). */
  function invalidateActive() {
    return utils.database.listRows.invalidate({ pageId, viewId })
  }

  return { patchCell, patchTitle, invalidateActive }
}
