import type {
  AnnotationId,
  BirthGroupId,
  ChildGroupId,
  EntityId,
  PersonId,
  PregnancyLossId,
  UnionId,
} from './ids'
import type { PersonLabelConfig } from './labels'

export type Sex = 'male' | 'female'

export type BloodRelation = 'direct' | 'partner' | 'sibling' | 'unknown'

export type PersonRole = 'owner' | 'regular'

export type PersonSize = 'big' | 'small'

export type LifeStatus = 'alive' | 'deceased' | 'unknown'

export type BirthMode = 'date' | 'approximate'

export type ApproximateAge =
  | { kind: 'value'; value: number }
  | { kind: 'range'; from: number; to: number }

export interface PartialDate {
  year?: number
  month?: number
  day?: number
}

export interface PersonIdentity {
  firstName?: string
  lastName?: string
  middleName?: string
  maidenName?: string
  nickname?: string
  isUnknown?: boolean
}

export interface LifeDates {
  birthDate?: PartialDate
  deathDate?: PartialDate
  birthMode: BirthMode
  approximateAge?: ApproximateAge
  lifeStatus: LifeStatus
  tragically?: boolean
}

export type CharacterTag = { kind: 'text'; value: string } | { kind: 'tag'; value: string }

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

export type UnionKind = 'marriage' | 'cohabitation'

export type CustodySide = 'left' | 'right' | 'shared'

export interface UnionDivorce {
  date?: PartialDate
  custodySide?: CustodySide
  markPosition?: number
}

export interface Union {
  id: UnionId
  kind: UnionKind
  malePartnerId: PersonId
  femalePartnerId: PersonId
  startDate?: PartialDate
  endDate?: PartialDate
  divorce?: UnionDivorce
  childGroupId?: ChildGroupId
}

export type ChildEntry =
  | { kind: 'person'; personId: PersonId; birthGroupId?: BirthGroupId }
  | { kind: 'loss'; lossId: PregnancyLossId }

export interface ChildGroup {
  id: ChildGroupId
  unionId: UnionId
  children: ChildEntry[]
}

export type BirthKind = 'twins' | 'fraternal'

export interface BirthGroup {
  id: BirthGroupId
  kind: BirthKind
  memberIds: PersonId[]
}

export type LossKind = 'abortion' | 'miscarriage'

export interface PregnancyLoss {
  id: PregnancyLossId
  kind: LossKind
  childGroupId: ChildGroupId
  date?: PartialDate
  note?: string
}

export interface Annotation {
  id: AnnotationId
  targetId?: EntityId
  position?: { x: number; y: number }
  text: string
}

export interface GenogramMeta {
  createdAt: string
  ownerId: PersonId
}
