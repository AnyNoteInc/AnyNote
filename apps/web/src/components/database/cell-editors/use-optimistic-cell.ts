'use client'

import { trpc } from '@/trpc/client'
import type { RouterOutputs } from '@/trpc/client'

import { defaultRowsInput } from '../types'

export type ListRowsResult = RouterOutputs['database']['listRows']

/**
 * Shared optimistic-update helper for cell editors. Mirrors the kanban
 * table-view pattern: patch the `database.listRows` query cache in place (rows
 * moved out of `getByPage` in the Phase-4A fetch split), then invalidate on error
 * so a failed write rolls back to server truth.
 */
export function useCellUpdate(pageId: string) {
  const utils = trpc.useUtils()

  const setData = utils.database.listRows.setData as (
    input: ReturnType<typeof defaultRowsInput>,
    updater: (prev: ListRowsResult | undefined) => ListRowsResult | undefined,
  ) => void

  function patchCellOptimistic(rowId: string, propertyId: string, value: unknown) {
    setData(defaultRowsInput(pageId), (current) => {
      if (!current) return current
      return {
        ...current,
        rows: current.rows.map((row) =>
          row.rowId === rowId
            ? { ...row, cells: { ...row.cells, [propertyId]: value } }
            : row,
        ),
      }
    })
  }

  const mutation = trpc.database.updateCellValue.useMutation({
    onError: () => utils.database.listRows.invalidate({ pageId }),
  })

  /**
   * Optimistically write a cell then persist. `value` is the stored shape
   * (string/number/boolean/string[]/null); DATE editors pass an ISO string and
   * the domain re-coerces it via z.preprocess (no superjson on the browser
   * client). The optimistic patch uses the same stored shape the view-model
   * holds so reads stay consistent.
   */
  function commit(rowId: string, propertyId: string, value: unknown) {
    patchCellOptimistic(rowId, propertyId, value)
    mutation.mutate({ pageId, rowId, propertyId, value })
  }

  return { commit, isPending: mutation.isPending }
}
