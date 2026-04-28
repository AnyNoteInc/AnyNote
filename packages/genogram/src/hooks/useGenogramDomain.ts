import { useCallback, useRef, useSyncExternalStore } from 'react'
import type * as Y from 'yjs'
import type {
  Annotation,
  AnnotationId,
  BirthGroup,
  BirthGroupId,
  ChildGroup,
  ChildGroupId,
  GenogramPageData,
  Person,
  PersonId,
  PregnancyLoss,
  PregnancyLossId,
  Union,
  UnionId,
} from '../types'
import { GENOGRAM_SCHEMA_VERSION } from '../types'
import { getGenogramMaps } from '../yjs/schema'

/**
 * Reactive domain snapshot assembled from the six Y.Maps in the doc.
 *
 * Uses a SINGLE useSyncExternalStore subscription that observes all six maps
 * atomically. This prevents the tearing bug where people and unions update in
 * separate React renders (causing layout to compute with a partial view of the
 * doc — e.g. a new partner person exists but their union does not yet).
 */
export function useGenogramDomain(doc: Y.Doc): GenogramPageData {
  // Snapshot cache — invalidated whenever any map fires observeDeep.
  const cacheRef = useRef<{ doc: Y.Doc; snapshot: GenogramPageData | null }>({
    doc,
    snapshot: null,
  })

  // If the doc instance changes, reset the cache.
  if (cacheRef.current.doc !== doc) {
    cacheRef.current = { doc, snapshot: null }
  }

  const subscribe = useCallback(
    (onChange: () => void) => {
      const maps = getGenogramMaps(doc)
      const invalidate = () => {
        cacheRef.current.snapshot = null
        onChange()
      }
      // Subscribe to all six maps with a single invalidate handler.
      maps.people.observeDeep(invalidate)
      maps.unions.observeDeep(invalidate)
      maps.childGroups.observeDeep(invalidate)
      maps.birthGroups.observeDeep(invalidate)
      maps.pregnancyLosses.observeDeep(invalidate)
      maps.annotations.observeDeep(invalidate)
      return () => {
        maps.people.unobserveDeep(invalidate)
        maps.unions.unobserveDeep(invalidate)
        maps.childGroups.unobserveDeep(invalidate)
        maps.birthGroups.unobserveDeep(invalidate)
        maps.pregnancyLosses.unobserveDeep(invalidate)
        maps.annotations.unobserveDeep(invalidate)
      }
    },
    [doc],
  )

  const getSnapshot = useCallback((): GenogramPageData => {
    if (cacheRef.current.snapshot === null) {
      const maps = getGenogramMaps(doc)
      const people: Record<PersonId, Person> = {}
      maps.people.forEach((v, k) => { people[k as PersonId] = v })
      const unions: Record<UnionId, Union> = {}
      maps.unions.forEach((v, k) => { unions[k as UnionId] = v })
      const childGroups: Record<ChildGroupId, ChildGroup> = {}
      maps.childGroups.forEach((v, k) => { childGroups[k as ChildGroupId] = v })
      const birthGroups: Record<BirthGroupId, BirthGroup> = {}
      maps.birthGroups.forEach((v, k) => { birthGroups[k as BirthGroupId] = v })
      const pregnancyLosses: Record<PregnancyLossId, PregnancyLoss> = {}
      maps.pregnancyLosses.forEach((v, k) => { pregnancyLosses[k as PregnancyLossId] = v })
      const annotations: Record<AnnotationId, Annotation> = {}
      maps.annotations.forEach((v, k) => { annotations[k as AnnotationId] = v })

      cacheRef.current.snapshot = {
        version: GENOGRAM_SCHEMA_VERSION,
        entities: { people, unions, childGroups, birthGroups, pregnancyLosses },
        annotations,
      }
    }
    return cacheRef.current.snapshot
  }, [doc])

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
