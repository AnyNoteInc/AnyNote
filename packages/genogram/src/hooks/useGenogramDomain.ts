import { useMemo } from 'react'
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
import { useYMap } from './useYMap'

/**
 * Reactive domain snapshot assembled from the six Y.Maps in the doc.
 * Re-renders only when any underlying map mutates.
 */
export function useGenogramDomain(doc: Y.Doc): GenogramPageData {
  const maps = useMemo(() => getGenogramMaps(doc), [doc])

  const people = useYMap(maps.people)
  const unions = useYMap(maps.unions)
  const childGroups = useYMap(maps.childGroups)
  const birthGroups = useYMap(maps.birthGroups)
  const pregnancyLosses = useYMap(maps.pregnancyLosses)
  const annotations = useYMap(maps.annotations)

  return useMemo<GenogramPageData>(
    () => ({
      version: GENOGRAM_SCHEMA_VERSION,
      entities: {
        people: people as Record<PersonId, Person>,
        unions: unions as Record<UnionId, Union>,
        childGroups: childGroups as Record<ChildGroupId, ChildGroup>,
        birthGroups: birthGroups as Record<BirthGroupId, BirthGroup>,
        pregnancyLosses: pregnancyLosses as Record<PregnancyLossId, PregnancyLoss>,
      },
      annotations: annotations as Record<AnnotationId, Annotation>,
    }),
    [people, unions, childGroups, birthGroups, pregnancyLosses, annotations],
  )
}
