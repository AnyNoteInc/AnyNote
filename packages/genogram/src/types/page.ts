import type {
  AnnotationId,
  BirthGroupId,
  ChildGroupId,
  EntityId,
  PersonId,
  PregnancyLossId,
  UnionId,
} from "./ids"
import type {
  Annotation,
  BirthGroup,
  ChildGroup,
  Person,
  PregnancyLoss,
  Union,
} from "./domain"

export interface Viewport {
  x: number
  y: number
  zoom: number
}

export type LayoutMode = "auto" | "manual" | "mixed"

export interface LayoutMetadata {
  mode: LayoutMode
  positions?: Record<EntityId, { x: number; y: number }>
  generations?: Record<PersonId, number>
  pinned?: EntityId[]
}

export interface GenogramEntities {
  people: Record<PersonId, Person>
  unions: Record<UnionId, Union>
  childGroups: Record<ChildGroupId, ChildGroup>
  birthGroups: Record<BirthGroupId, BirthGroup>
  pregnancyLosses: Record<PregnancyLossId, PregnancyLoss>
}

export interface GenogramPageData {
  version: 1
  entities: GenogramEntities
  annotations: Record<AnnotationId, Annotation>
  layout?: LayoutMetadata
  viewport?: Viewport
}

export const GENOGRAM_SCHEMA_VERSION = 1 as const
