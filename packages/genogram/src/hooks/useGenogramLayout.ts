import { useMemo } from 'react'
import type { GenogramPageData } from '../types'
import { computeLayout } from '../layout/computeLayout'
import type { LayoutResult } from '../layout/types'

/**
 * Memoized layout computation. Recomputes only when the domain reference
 * changes, which happens when any Y.Map mutates (see useGenogramDomain).
 */
export function useGenogramLayout(data: GenogramPageData): LayoutResult {
  return useMemo(() => computeLayout(data), [data])
}
