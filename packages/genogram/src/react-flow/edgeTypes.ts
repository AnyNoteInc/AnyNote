import type { EdgeTypes } from '@xyflow/react'
import {
  BirthDiagonalEdge,
  ChildEdge,
  TwinHorizontalEdge,
  UnionLineEdge,
  UnionTrunkEdge,
} from '../edges'

export const edgeTypes: EdgeTypes = {
  unionMarriage: UnionLineEdge,
  unionCohabitation: UnionLineEdge,
  unionTrunk: UnionTrunkEdge,
  child: ChildEdge,
  twinDiagonal: BirthDiagonalEdge,
  fraternalDiagonal: BirthDiagonalEdge,
  twinHorizontal: TwinHorizontalEdge,
}
