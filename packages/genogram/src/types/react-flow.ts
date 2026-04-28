import type { Edge, Node } from '@xyflow/react'
import type {
  AnnotationId,
  BirthGroupId,
  ChildGroupId,
  EntityId,
  PersonId,
  PregnancyLossId,
  UnionId,
} from './ids'
import type {
  BirthKind,
  CustodySide,
  LifeStatus,
  LossKind,
  PersonSize,
  Sex,
  UnionKind,
} from './domain'
import type { RenderableLabel } from './labels'

export type GenogramNodeType =
  | 'person'
  | 'pregnancyLoss'
  | 'union'
  | 'childrenHub'
  | 'birthGroup'
  | 'annotation'
  | 'genogramCreationDate'

export type GenogramEdgeType =
  | 'unionMarriage'
  | 'unionCohabitation'
  | 'unionTrunk'
  | 'sibling'
  | 'child'
  | 'twinDiagonal'
  | 'twinHorizontal'
  | 'fraternalDiagonal'

export interface PersonNodeData {
  [key: string]: unknown
  personId: PersonId
  sex: Sex
  size: PersonSize
  isOwner: boolean
  isUnknown: boolean
  lifeStatus: LifeStatus
  showDeathCross: boolean
  shouldShowPartnerOrder: boolean
  partnerOrder?: number
  creationDate?: string
  label: RenderableLabel
}

export interface PregnancyLossNodeData {
  [key: string]: unknown
  lossId: PregnancyLossId
  kind: LossKind
  label: RenderableLabel
}

export interface UnionNodeData {
  [key: string]: unknown
  unionId: UnionId
  kind: UnionKind
  divorced: boolean
  custodySide?: CustodySide
}

export interface ChildrenHubNodeData {
  [key: string]: unknown
  childGroupId: ChildGroupId
  unionId: UnionId
  childCount: number
}

export interface BirthGroupNodeData {
  [key: string]: unknown
  birthGroupId: BirthGroupId
  kind: BirthKind
  memberIds: PersonId[]
}

export interface AnnotationNodeData {
  [key: string]: unknown
  annotationId: AnnotationId
  text: string
}

export interface OwnerCreationDateNodeData {
  [key: string]: unknown
  formattedDate: string
}

export type GenogramNode =
  | Node<PersonNodeData, 'person'>
  | Node<PregnancyLossNodeData, 'pregnancyLoss'>
  | Node<UnionNodeData, 'union'>
  | Node<ChildrenHubNodeData, 'childrenHub'>
  | Node<BirthGroupNodeData, 'birthGroup'>
  | Node<AnnotationNodeData, 'annotation'>
  | Node<OwnerCreationDateNodeData, 'genogramCreationDate'>

export type EdgeDecoration = 'divorceSlash' | 'diagonalConverge'

export interface GenogramEdgeData {
  [key: string]: unknown
  sourceEntityId: EntityId
  targetEntityId: EntityId
  decorations?: EdgeDecoration[]
  custodySide?: CustodySide
  pathHints?: {
    corner?: 'topLeft' | 'topRight'
  }
}

export type GenogramEdge = Edge<GenogramEdgeData, GenogramEdgeType>
