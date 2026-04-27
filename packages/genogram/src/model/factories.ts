import type {
  Annotation,
  AnnotationId,
  BirthGroup,
  BirthGroupId,
  BirthKind,
  BloodRelation,
  ChildEntry,
  ChildGroup,
  ChildGroupId,
  EntityId,
  GenogramPageData,
  LifeDates,
  LossKind,
  PartialDate,
  Person,
  PersonId,
  PersonIdentity,
  PersonLabelConfig,
  PersonProfile,
  PersonRole,
  PersonSize,
  PregnancyLoss,
  PregnancyLossId,
  Sex,
  Union,
  UnionDivorce,
  UnionId,
  UnionKind,
} from '../types'
import { GENOGRAM_SCHEMA_VERSION } from '../types'
import { createId } from '../utils/id'

function defaultSize(bloodRelation: BloodRelation): PersonSize {
  return bloodRelation === 'direct' || bloodRelation === 'partner' ? 'big' : 'small'
}

export interface CreatePersonInput {
  sex: Sex
  bloodRelation: BloodRelation
  role?: PersonRole
  size?: PersonSize
  partnerOrder?: number
  identity?: PersonIdentity
  lifeDates?: Partial<LifeDates>
  profile?: PersonProfile
  label?: PersonLabelConfig
  id?: PersonId
}

export function createPerson(input: CreatePersonInput): Person {
  return {
    id: input.id ?? createId<PersonId>(),
    sex: input.sex,
    role: input.role ?? 'regular',
    size: input.size ?? defaultSize(input.bloodRelation),
    bloodRelation: input.bloodRelation,
    partnerOrder: input.partnerOrder,
    identity: input.identity ?? {},
    lifeDates: {
      birthMode: 'date',
      lifeStatus: 'unknown',
      ...input.lifeDates,
    },
    profile: input.profile ?? {},
    label: input.label ?? {},
  }
}

export interface CreateUnionInput {
  malePartnerId: PersonId
  femalePartnerId: PersonId
  kind?: UnionKind
  startDate?: PartialDate
  endDate?: PartialDate
  divorce?: UnionDivorce
  childGroupId?: ChildGroupId
  id?: UnionId
}

export function createUnion(input: CreateUnionInput): Union {
  return {
    id: input.id ?? createId<UnionId>(),
    kind: input.kind ?? 'marriage',
    malePartnerId: input.malePartnerId,
    femalePartnerId: input.femalePartnerId,
    startDate: input.startDate,
    endDate: input.endDate,
    divorce: input.divorce,
    childGroupId: input.childGroupId,
  }
}

export interface CreateChildGroupInput {
  unionId: UnionId
  children?: ChildEntry[]
  id?: ChildGroupId
}

export function createChildGroup(input: CreateChildGroupInput): ChildGroup {
  return {
    id: input.id ?? createId<ChildGroupId>(),
    unionId: input.unionId,
    children: input.children ?? [],
  }
}

export interface CreateBirthGroupInput {
  kind: BirthKind
  memberIds: PersonId[]
  id?: BirthGroupId
}

export function createBirthGroup(input: CreateBirthGroupInput): BirthGroup {
  return {
    id: input.id ?? createId<BirthGroupId>(),
    kind: input.kind,
    memberIds: input.memberIds,
  }
}

export interface CreatePregnancyLossInput {
  kind: LossKind
  childGroupId: ChildGroupId
  date?: PartialDate
  note?: string
  id?: PregnancyLossId
}

export function createPregnancyLoss(input: CreatePregnancyLossInput): PregnancyLoss {
  return {
    id: input.id ?? createId<PregnancyLossId>(),
    kind: input.kind,
    childGroupId: input.childGroupId,
    date: input.date,
    note: input.note,
  }
}

export interface CreateAnnotationInput {
  text: string
  targetId?: EntityId
  position?: { x: number; y: number }
  id?: AnnotationId
}

export function createAnnotation(input: CreateAnnotationInput): Annotation {
  return {
    id: input.id ?? createId<AnnotationId>(),
    text: input.text,
    targetId: input.targetId,
    position: input.position,
  }
}

export function createDefaultParent(sex: Sex): Person {
  return createPerson({
    sex,
    bloodRelation: 'direct',
    identity: { isUnknown: true },
  })
}

export function createDefaultUnion(maleId: PersonId, femaleId: PersonId): Omit<Union, 'id'> {
  return {
    kind: 'marriage',
    malePartnerId: maleId,
    femalePartnerId: femaleId,
  }
}

export function createEmptyGenogram(): GenogramPageData {
  return {
    version: GENOGRAM_SCHEMA_VERSION,
    entities: {
      people: {},
      unions: {},
      childGroups: {},
      birthGroups: {},
      pregnancyLosses: {},
    },
    annotations: {},
  }
}
