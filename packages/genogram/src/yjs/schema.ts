import type * as Y from "yjs"
import type {
  Annotation,
  BirthGroup,
  ChildGroup,
  Person,
  PregnancyLoss,
  Union,
} from "../types"

export const GENOGRAM_MAP_NAMES = {
  people: "genogram.people",
  unions: "genogram.unions",
  childGroups: "genogram.childGroups",
  birthGroups: "genogram.birthGroups",
  pregnancyLosses: "genogram.pregnancyLosses",
  annotations: "genogram.annotations",
} as const

export interface GenogramYMaps {
  people: Y.Map<Person>
  unions: Y.Map<Union>
  childGroups: Y.Map<ChildGroup>
  birthGroups: Y.Map<BirthGroup>
  pregnancyLosses: Y.Map<PregnancyLoss>
  annotations: Y.Map<Annotation>
}

export function getGenogramMaps(doc: Y.Doc): GenogramYMaps {
  return {
    people: doc.getMap(GENOGRAM_MAP_NAMES.people),
    unions: doc.getMap(GENOGRAM_MAP_NAMES.unions),
    childGroups: doc.getMap(GENOGRAM_MAP_NAMES.childGroups),
    birthGroups: doc.getMap(GENOGRAM_MAP_NAMES.birthGroups),
    pregnancyLosses: doc.getMap(GENOGRAM_MAP_NAMES.pregnancyLosses),
    annotations: doc.getMap(GENOGRAM_MAP_NAMES.annotations),
  }
}
