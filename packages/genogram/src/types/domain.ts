import type {
  AnnotationId,
  BirthGroupId,
  ChildGroupId,
  EntityId,
  PersonId,
  PregnancyLossId,
  UnionId,
} from "./ids"
import type { PersonLabelConfig } from "./labels"

export type Sex = "male" | "female"

export type BloodRelation = "direct" | "partner" | "sibling" | "unknown"

export type PersonRole = "owner" | "regular"

export type PersonSize = "big" | "small"

export type DeathKind = "natural" | "tragic" | "early"

export interface PersonIdentity {
  firstName?: string
  lastName?: string
  middleName?: string
  maidenName?: string
  nickname?: string
  isUnknown?: boolean
}

export interface LifeDates {
  birthDate?: string
  birthDateApprox?: boolean
  deathDate?: string
  deathDateApprox?: boolean
  isDeceased: boolean
  deathKind?: DeathKind
}

export type CharacterTag =
  | { kind: "text"; value: string }
  | { kind: "tag"; value: string }

export interface PersonProfile {
  birthPlace?: string
  profession?: string
  characters?: CharacterTag[]
  addictions?: string[]
  diseases?: string[]
  notes?: string
}

export interface Person {
  id: PersonId
  sex: Sex
  role: PersonRole
  size: PersonSize
  bloodRelation: BloodRelation
  partnerOrder?: number
  identity: PersonIdentity
  lifeDates: LifeDates
  profile: PersonProfile
  label: PersonLabelConfig
}

export type UnionKind = "marriage" | "cohabitation"

export type CustodySide = "left" | "right" | "shared"

export interface UnionDivorce {
  date?: string
  custodySide?: CustodySide
}

export interface Union {
  id: UnionId
  kind: UnionKind
  malePartnerId: PersonId
  femalePartnerId: PersonId
  startDate?: string
  endDate?: string
  divorce?: UnionDivorce
  childGroupId?: ChildGroupId
}

export type ChildEntry =
  | { kind: "person"; personId: PersonId; birthGroupId?: BirthGroupId }
  | { kind: "loss"; lossId: PregnancyLossId }

export interface ChildGroup {
  id: ChildGroupId
  unionId: UnionId
  children: ChildEntry[]
}

export type BirthKind = "twins" | "fraternal"

export interface BirthGroup {
  id: BirthGroupId
  kind: BirthKind
  memberIds: PersonId[]
}

export type LossKind = "abortion" | "miscarriage"

export interface PregnancyLoss {
  id: PregnancyLossId
  kind: LossKind
  childGroupId: ChildGroupId
  date?: string
  note?: string
}

export interface Annotation {
  id: AnnotationId
  targetId?: EntityId
  position?: { x: number; y: number }
  text: string
}
