import type {
  BirthGroup,
  ChildGroup,
  GenogramEdge,
  GenogramMeta,
  GenogramNode,
  GenogramPageData,
  Person,
  PersonId,
  PregnancyLoss,
  Union,
  UnionId,
} from '../types'
import type { LayoutResult } from '../layout/types'
import { LAYOUT, personWidth } from '../layout/constants'
import {
  resolveLabelPosition,
  shouldShowDeathCross,
  shouldShowPartnerOrder,
} from '../model/computed'
import { formatPersonLabelLines } from '../utils/labels'

const ANCHOR_SIZE = 1

export interface FlowSnapshot {
  nodes: GenogramNode[]
  edges: GenogramEdge[]
}

export function domainToFlow(
  data: GenogramPageData,
  layout: LayoutResult,
  meta?: GenogramMeta | null,
): FlowSnapshot {
  const nodes: GenogramNode[] = []
  const edges: GenogramEdge[] = []

  const unionOffsets = computeUnionFanOutOffsets(data)

  pushPersonNodes(data, layout, nodes, meta ?? null)
  pushPregnancyLossNodes(data, layout, nodes)
  pushUnionNodesAndEdges(data, layout, nodes, edges, unionOffsets)
  pushChildrenHubs(data, layout, nodes, edges)
  pushBirthGroupNodesAndEdges(data, layout, nodes, edges)
  pushAnnotations(data, nodes)
  // Creation date is no longer pushed as a canvas node — GenogramFlow
  // surfaces it in the Panel beside the zoom controls instead.

  return { nodes, edges }
}

interface UnionEdgeOffsets {
  sourceXOffset: number
  targetXOffset: number
  bracketYOffset: number
}

/**
 * For each multi-partner base (a person in more than one union):
 *   - distribute the connection points across that person's bottom edge so
 *     each union's bracket emerges from a distinct x (fan-out)
 *   - stack the bracket horizontals at different Y so they stay parallel
 *     instead of collinear (Y offset proportional to partnerOrder rank)
 *
 * Single-partner unions get all zero offsets and render with the default
 * straight bottom-handle bracket at the standard drop.
 */
function computeUnionFanOutOffsets(data: GenogramPageData): Map<UnionId, UnionEdgeOffsets> {
  const result = new Map<UnionId, UnionEdgeOffsets>()
  const personUnions = new Map<PersonId, UnionId[]>()
  for (const u of Object.values(data.entities.unions) as Union[]) {
    pushTo(personUnions, u.malePartnerId, u.id)
    pushTo(personUnions, u.femalePartnerId, u.id)
  }

  for (const [personId, unionIds] of personUnions) {
    if (unionIds.length <= 1) continue
    const person = data.entities.people[personId]
    if (!person) continue

    const sorted = unionIds
      .map((uid) => {
        const u = data.entities.unions[uid]!
        const otherId = u.malePartnerId === personId ? u.femalePartnerId : u.malePartnerId
        const other = data.entities.people[otherId]
        return { uid, order: other?.partnerOrder ?? 999 }
      })
      .sort((a, b) => a.order - b.order)

    const N = sorted.length
    const personW = personWidth(person.size)

    sorted.forEach(({ uid }, i) => {
      const offset = -personW / 2 + (personW * (i + 0.5)) / N
      const yStack = i * LAYOUT.MULTI_PARTNER_STACK_Y
      const u = data.entities.unions[uid]!
      const isSource = u.malePartnerId === personId
      const existing = result.get(uid) ?? { sourceXOffset: 0, targetXOffset: 0, bracketYOffset: 0 }
      if (isSource) existing.sourceXOffset = offset
      else existing.targetXOffset = offset
      // If both partners are multi-partner bases, take the larger stack
      // index so the bracket clears both stacks.
      existing.bracketYOffset = Math.max(existing.bracketYOffset, yStack)
      result.set(uid, existing)
    })
  }
  return result
}

function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const existing = map.get(key)
  if (existing) existing.push(value)
  else map.set(key, [value])
}

function pushPersonNodes(
  data: GenogramPageData,
  layout: LayoutResult,
  out: GenogramNode[],
  meta: GenogramMeta | null,
): void {
  const creationDate = meta?.createdAt
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
        lifeStatus: person.lifeDates.lifeStatus,
        showDeathCross: shouldShowDeathCross(person),
        shouldShowPartnerOrder: shouldShowPartnerOrder(
          person.id,
          data.entities.people,
          data.entities.unions,
        ),
        partnerOrder: person.partnerOrder,
        creationDate,
        label: {
          lines: formatPersonLabelLines(person, creationDate),
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
  unionOffsets: Map<UnionId, UnionEdgeOffsets>,
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

    // "Ended" state covers both marriage divorce and cohabitation with an
    // explicit endDate — both render with the same slash decoration and
    // share drag/persist behavior via DivorceMarker + setUnionEndMark.
    const isEnded = union.kind === 'marriage' ? !!union.divorce : !!union.endDate
    const markPosition =
      union.kind === 'marriage' ? union.divorce?.markPosition : union.endMarkPosition
    const custodySide = union.kind === 'marriage' ? union.divorce?.custodySide : undefined
    const offsets = unionOffsets.get(union.id)

    edges.push({
      id: `marriage:${union.id}`,
      source: union.malePartnerId,
      target: union.femalePartnerId,
      sourceHandle: 'bottom',
      targetHandle: 'bottom-target',
      type: union.kind === 'marriage' ? 'unionMarriage' : 'unionCohabitation',
      data: {
        sourceEntityId: union.malePartnerId,
        targetEntityId: union.femalePartnerId,
        decorations: isEnded ? ['divorceSlash'] : undefined,
        custodySide,
        unionId: union.id,
        markPosition,
        sourceXOffset: offsets?.sourceXOffset ?? 0,
        targetXOffset: offsets?.targetXOffset ?? 0,
        bracketYOffset: offsets?.bracketYOffset ?? 0,
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

    // No trunk edge: the children hub sits on the bracket horizontal, so each
    // child edge can drop straight from the bracket Y at child.x without a
    // separate vertical between union anchor and hub.
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

