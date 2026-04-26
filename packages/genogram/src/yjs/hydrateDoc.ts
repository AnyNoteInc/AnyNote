import type * as Y from 'yjs'
import type { GenogramPageData } from '../types'
import { getGenogramMaps } from './schema'

/**
 * Populate a Y.Doc from a JSON snapshot. Used on initial document load
 * (e.g. when the user opens a Page whose Y.Doc bytes haven't been streamed
 * from the server yet, and we want to seed from Page.content).
 *
 * Clears any existing entries first — caller should only call this on an
 * empty doc or when intentionally overwriting local state.
 */
export function hydrateDoc(doc: Y.Doc, data: GenogramPageData): void {
  const maps = getGenogramMaps(doc)
  doc.transact(() => {
    hydrateMap(maps.people, data.entities.people)
    hydrateMap(maps.unions, data.entities.unions)
    hydrateMap(maps.childGroups, data.entities.childGroups)
    hydrateMap(maps.birthGroups, data.entities.birthGroups)
    hydrateMap(maps.pregnancyLosses, data.entities.pregnancyLosses)
    hydrateMap(maps.annotations, data.annotations)
  })
}

function hydrateMap<T>(map: Y.Map<T>, record: Record<string, T>): void {
  map.clear()
  for (const [key, value] of Object.entries(record)) {
    map.set(key, value)
  }
}
