import type {
  BirthGroup,
  ChildGroup,
  GenogramEdge,
  GenogramNode,
  GenogramPageData,
  Person,
  PregnancyLoss,
  Union,
} from '../types'
import type { LayoutResult } from '../layout/types'
import { LAYOUT, personWidth } from '../layout/constants'
import { resolveLabelPosition } from '../model/computed'
import { formatPersonLabelLines } from '../utils/labels'

const ANCHOR_SIZE = 1

export interface FlowSnapshot {
  nodes: GenogramNode[]
  edges: GenogramEdge[]
}

export function domainToFlow(data: GenogramPageData, layout: LayoutResult): FlowSnapshot {
  const nodes: GenogramNode[] = []
  const edges: GenogramEdge[] = []

  pushPersonNodes(data, layout, nodes)
  pushPregnancyLossNodes(data, layout, nodes)
  pushUnionNodesAndEdges(data, layout, nodes, edges)
  pushChildrenHubs(data, layout, nodes, edges)
  pushBirthGroupNodesAndEdges(data, layout, nodes, edges)
  pushAnnotations(data, nodes)

  return { nodes, edges }
}

function pushPersonNodes(data: GenogramPageData, layout: LayoutResult, out: GenogramNode[]): void {
  for (const person of Object.values(data.entities.people) as Person[]) {
    const pos = layout.positions[person.id]
    if (!pos) continue
    const w = personWidth(person.size)
    out.push({
      id: person.id,
      type: 'person',
      position: { x: pos.x - w / 2, y: pos.y - w / 2 },
      data: {
        personId: person.id,
        sex: person.sex,
        size: person.size,
        isOwner: person.role === 'owner',
        isUnknown: !!person.identity.isUnknown,
        isDeceased: person.lifeDates.isDeceased,
        deathKind: person.lifeDates.deathKind,
        partnerOrder: person.partnerOrder,
        label: {
          lines: formatPersonLabelLines(person),
          position: resolveLabelPosition(person),
          hidden: !!person.label.hidden,
          offset: person.label.offset,
        },
      },
    })
  }
}

function pushPregnancyLossNodes(
  data: GenogramPageData,
  layout: LayoutResult,
  out: GenogramNode[],
): void {
  for (const loss of Object.values(data.entities.pregnancyLosses) as PregnancyLoss[]) {
    const pos = layout.positions[loss.id]
    if (!pos) continue
    const w = LAYOUT.LOSS
    const labelLines = loss.note ? [loss.note] : []
    out.push({
      id: loss.id,
      type: 'pregnancyLoss',
      position: { x: pos.x - w / 2, y: pos.y - w / 2 },
      data: {
        lossId: loss.id,
        kind: loss.kind,
        label: {
          lines: labelLines,
          position: 'bottom',
          hidden: labelLines.length === 0,
        },
      },
    })
  }
}

function pushUnionNodesAndEdges(
  data: GenogramPageData,
  layout: LayoutResult,
  nodes: GenogramNode[],
  edges: GenogramEdge[],
): void {
  for (const union of Object.values(data.entities.unions) as Union[]) {
    const pos = layout.positions[union.id]
    if (!pos) continue
    nodes.push({
      id: union.id,
      type: 'union',
      position: { x: pos.x - ANCHOR_SIZE / 2, y: pos.y - ANCHOR_SIZE / 2 },
      data: {
        unionId: union.id,
        kind: union.kind,
        divorced: !!union.divorce,
        custodySide: union.divorce?.custodySide,
      },
    })

    edges.push({
      id: `marriage:${union.id}`,
      source: union.malePartnerId,
      target: union.femalePartnerId,
      sourceHandle: 'right',
      targetHandle: 'left',
      type: union.kind === 'marriage' ? 'unionMarriage' : 'unionCohabitation',
      data: {
        sourceEntityId: union.malePartnerId,
        targetEntityId: union.femalePartnerId,
        decorations: union.divorce ? ['divorceSlash'] : undefined,
        custodySide: union.divorce?.custodySide,
      },
    })
  }
}

function pushChildrenHubs(
  data: GenogramPageData,
  layout: LayoutResult,
  nodes: GenogramNode[],
  edges: GenogramEdge[],
): void {
  for (const cg of Object.values(data.entities.childGroups) as ChildGroup[]) {
    const pos = layout.positions[cg.id]
    if (!pos) continue
    nodes.push({
      id: cg.id,
      type: 'childrenHub',
      position: { x: pos.x - ANCHOR_SIZE / 2, y: pos.y - ANCHOR_SIZE / 2 },
      data: {
        childGroupId: cg.id,
        unionId: cg.unionId,
        childCount: cg.children.length,
      },
    })

    edges.push({
      id: `trunk:${cg.unionId}:${cg.id}`,
      source: cg.unionId,
      target: cg.id,
      type: 'unionTrunk',
      data: {
        sourceEntityId: cg.unionId,
        targetEntityId: cg.id,
      },
    })

    for (const entry of cg.children) {
      const targetId = entry.kind === 'person' ? entry.personId : entry.lossId
      edges.push({
        id: `child:${cg.id}:${targetId}`,
        source: cg.id,
        target: targetId,
        sourceHandle: 'bottom',
        targetHandle: 'top',
        type: 'child',
        data: {
          sourceEntityId: cg.id,
          targetEntityId: targetId,
        },
      })
    }
  }
}

function pushBirthGroupNodesAndEdges(
  data: GenogramPageData,
  layout: LayoutResult,
  nodes: GenogramNode[],
  edges: GenogramEdge[],
): void {
  for (const bg of Object.values(data.entities.birthGroups) as BirthGroup[]) {
    const pos = layout.positions[bg.id]
    if (!pos) continue
    nodes.push({
      id: bg.id,
      type: 'birthGroup',
      position: { x: pos.x - ANCHOR_SIZE / 2, y: pos.y - ANCHOR_SIZE / 2 },
      data: {
        birthGroupId: bg.id,
        kind: bg.kind,
        memberIds: bg.memberIds,
      },
    })

    const edgeType = bg.kind === 'twins' ? 'twinDiagonal' : 'fraternalDiagonal'
    for (const memberId of bg.memberIds) {
      edges.push({
        id: `bg:${bg.id}:${memberId}`,
        source: bg.id,
        target: memberId,
        targetHandle: 'top',
        type: edgeType,
        data: {
          sourceEntityId: bg.id,
          targetEntityId: memberId,
          decorations: ['diagonalConverge'],
        },
      })
    }

    if (bg.kind === 'twins' && bg.memberIds.length >= 2) {
      for (let i = 0; i < bg.memberIds.length - 1; i++) {
        const a = bg.memberIds[i]!
        const b = bg.memberIds[i + 1]!
        edges.push({
          id: `twinh:${bg.id}:${i}`,
          source: a,
          target: b,
          sourceHandle: 'right',
          targetHandle: 'left',
          type: 'twinHorizontal',
          data: {
            sourceEntityId: a,
            targetEntityId: b,
          },
        })
      }
    }
  }
}

function pushAnnotations(data: GenogramPageData, out: GenogramNode[]): void {
  for (const a of Object.values(data.annotations)) {
    if (!a.position) continue
    out.push({
      id: a.id,
      type: 'annotation',
      position: { x: a.position.x, y: a.position.y },
      data: {
        annotationId: a.id,
        text: a.text,
      },
    })
  }
}
