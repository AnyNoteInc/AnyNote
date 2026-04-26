import type * as Y from 'yjs'
import type { LayoutResult } from '../layout/types'
import type { GenogramPageData } from '../types'
import { useGenogramDomain } from './useGenogramDomain'
import { useGenogramLayout } from './useGenogramLayout'

export interface UseGenogramResult {
  domain: GenogramPageData
  layout: LayoutResult
}

/**
 * Composite: subscribes to the doc, derives layout in one memoized pass.
 * This is the primary entry point consumed by GenogramFlow.
 */
export function useGenogram(doc: Y.Doc): UseGenogramResult {
  const domain = useGenogramDomain(doc)
  const layout = useGenogramLayout(domain)
  return { domain, layout }
}
