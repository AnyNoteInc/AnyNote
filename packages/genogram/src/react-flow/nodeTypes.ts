import type { NodeTypes } from '@xyflow/react'
import {
  AnnotationNode,
  BirthGroupNode,
  ChildrenHubNode,
  OwnerCreationDateNode,
  PersonNode,
  PregnancyLossNode,
  UnionNode,
} from '../nodes'

export const nodeTypes: NodeTypes = {
  person: PersonNode,
  pregnancyLoss: PregnancyLossNode,
  union: UnionNode,
  childrenHub: ChildrenHubNode,
  birthGroup: BirthGroupNode,
  annotation: AnnotationNode,
  genogramCreationDate: OwnerCreationDateNode,
}
