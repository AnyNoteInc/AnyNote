import type * as Y from 'yjs'
import type { GenogramPageData } from '../types'
import { GENOGRAM_SCHEMA_VERSION } from '../types'
import { getGenogramMaps } from './schema'

/**
 * Snapshots every Y.Map into a plain GenogramPageData. Layout/viewport are
 * intentionally excluded — they live locally (per-client) and are never
 * synced through Y.Doc.
 */
export function assembleDomain(doc: Y.Doc): GenogramPageData {
  const maps = getGenogramMaps(doc)
  return {
    version: GENOGRAM_SCHEMA_VERSION,
    entities: {
      people: mapToRecord(maps.people),
      unions: mapToRecord(maps.unions),
      childGroups: mapToRecord(maps.childGroups),
      birthGroups: mapToRecord(maps.birthGroups),
      pregnancyLosses: mapToRecord(maps.pregnancyLosses),
    },
    annotations: mapToRecord(maps.annotations),
  }
}

function mapToRecord<T>(map: Y.Map<T>): Record<string, T> {
  const result: Record<string, T> = {}
  map.forEach((value, key) => {
    result[key] = value
  })
  return result
}
