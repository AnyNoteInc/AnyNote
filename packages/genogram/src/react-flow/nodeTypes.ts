import type { NodeTypes } from '@xyflow/react'
import {
  AnnotationNode,
  BirthGroupNode,
  ChildrenHubNode,
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
}
