import type {
  BirthGroupId,
  ChildEntry,
  ChildGroupId,
  EntityId,
  GenogramPageData,
  PersonId,
  PregnancyLossId,
  UnionId,
} from '../types'
import { LAYOUT, personWidth } from './constants'
import type { Relations } from './relations'
import type { Point } from './types'

export interface PlacementContext {
  data: GenogramPageData
  relations: Relations
  generations: Map<PersonId, number>
  minGen: number
  positions: Map<EntityId, Point>
  /** Guard against cycles in the descend recursion. */
  visitedUnions: Set<UnionId>
}

function yForGen(gen: number, minGen: number): number {
  return (gen - minGen) * LAYOUT.GEN_HEIGHT
}

export function placeAll(ctx: PlacementContext): void {
  const roots = findRoots(ctx)
  let cursorX = 0
  for (const root of roots) {
    const w = placeUnit(root, cursorX, ctx)
    cursorX += w + LAYOUT.SIBLING_GAP * 2
  }
}

type Unit =
  | { kind: 'person'; personId: PersonId }
  | { kind: 'union'; unionId: UnionId }
  | { kind: 'multiUnion'; baseId: PersonId; unionIds: UnionId[] }

function findRoots(ctx: PlacementContext): Unit[] {
  const { data, generations, minGen, relations } = ctx
  const visited = new Set<PersonId>()
  const roots: Unit[] = []

  const topPersons: PersonId[] = []
  for (const [pid, gen] of generations) {
    if (gen === minGen) topPersons.push(pid)
  }
  topPersons.sort()

  /**
   * Emit a root unit for `pid`, marking all involved persons as visited.
   * Returns true if a root was emitted.
   */
  function emitRoot(pid: PersonId): void {
    if (visited.has(pid)) return
    const unions = relations.unionsByPerson.get(pid) ?? []
    // Unions where the other person is also at the top generation (i.e. partner unions)
    const topUnions = unions.filter((uid) => {
      const u = data.entities.unions[uid]
      if (!u) return false
      const other = u.malePartnerId === pid ? u.femalePartnerId : u.malePartnerId
      return generations.get(other) === minGen && !visited.has(other)
    })

    if (topUnions.length > 1) {
      // Multi-partner: base has more than one unvisited partner at same generation
      visited.add(pid)
      for (const uid of topUnions) {
        const u = data.entities.unions[uid]!
        const partnerId = u.malePartnerId === pid ? u.femalePartnerId : u.malePartnerId
        visited.add(partnerId)
      }
      roots.push({ kind: 'multiUnion', baseId: pid, unionIds: topUnions })
    } else if (topUnions.length === 1) {
      const rootUnionId = topUnions[0]!
      const u = data.entities.unions[rootUnionId]!
      visited.add(u.malePartnerId)
      visited.add(u.femalePartnerId)
      roots.push({ kind: 'union', unionId: rootUnionId })
    } else {
      visited.add(pid)
      roots.push({ kind: 'person', personId: pid })
    }
  }

  // First pass: emit roots for persons with multiple top-gen unions (multi-partner bases).
  // This ensures the base person is processed before its partners.
  for (const pid of topPersons) {
    if (visited.has(pid)) continue
    const unions = relations.unionsByPerson.get(pid) ?? []
    const topUnionCount = unions.filter((uid) => {
      const u = data.entities.unions[uid]
      if (!u) return false
      const other = u.malePartnerId === pid ? u.femalePartnerId : u.malePartnerId
      return generations.get(other) === minGen
    }).length
    if (topUnionCount > 1) emitRoot(pid)
  }

  // Second pass: emit roots for all remaining unvisited top-gen persons.
  for (const pid of topPersons) {
    if (!visited.has(pid)) emitRoot(pid)
  }

  return roots
}

function placeUnit(unit: Unit, leftX: number, ctx: PlacementContext): number {
  if (unit.kind === 'union') return placeUnionSubtree(unit.unionId, leftX, ctx)
  if (unit.kind === 'multiUnion') return placeMultiPartnerSubtree(unit.baseId, unit.unionIds, leftX, ctx)
  return placePersonSolo(unit.personId, leftX, ctx)
}

function placePersonSolo(personId: PersonId, leftX: number, ctx: PlacementContext): number {
  const p = ctx.data.entities.people[personId]
  if (!p) return 0
  const w = personWidth(p.size)
  const gen = ctx.generations.get(personId) ?? 0
  ctx.positions.set(personId, {
    x: leftX + w / 2,
    y: yForGen(gen, ctx.minGen),
  })
  return w
}

function placeUnionSubtree(unionId: UnionId, leftX: number, ctx: PlacementContext): number {
  if (ctx.visitedUnions.has(unionId)) return 0
  ctx.visitedUnions.add(unionId)

  const u = ctx.data.entities.unions[unionId]
  if (!u) return 0
  const male = ctx.data.entities.people[u.malePartnerId]
  const female = ctx.data.entities.people[u.femalePartnerId]
  if (!male || !female) return 0

  const maleW = personWidth(male.size)
  const femaleW = personWidth(female.size)
  const coupleWidth = maleW + LAYOUT.PARTNER_GAP + femaleW

  const cg = u.childGroupId ? ctx.data.entities.childGroups[u.childGroupId] : undefined
  const childrenWidth = cg ? measureChildren(cg, ctx) : 0
  const totalWidth = Math.max(coupleWidth, childrenWidth)

  const gen = ctx.generations.get(male.id) ?? 0
  const y = yForGen(gen, ctx.minGen)

  const coupleStart = leftX + (totalWidth - coupleWidth) / 2
  const maleCenter = coupleStart + maleW / 2
  const femaleCenter = coupleStart + maleW + LAYOUT.PARTNER_GAP + femaleW / 2
  ctx.positions.set(male.id, { x: maleCenter, y })
  ctx.positions.set(female.id, { x: femaleCenter, y })

  const unionX = (maleCenter + femaleCenter) / 2
  ctx.positions.set(unionId, { x: unionX, y })

  if (cg && cg.children.length > 0) {
    const hubX = unionX
    const hubY = y + LAYOUT.HUB_OFFSET_Y
    ctx.positions.set(cg.id, { x: hubX, y: hubY })

    const childrenStart = leftX + (totalWidth - childrenWidth) / 2
    placeChildren(cg.id, childrenStart, ctx)
  }

  return totalWidth
}

/**
 * Place a base person who has multiple partners (multi-union).
 *
 * Layout rule:
 *   Sort partners by partnerOrder ascending. Base sits at slot floor(N/2) in
 *   the N+1 entity sequence — i.e. between the two middle partners for even N,
 *   or after the first half for odd N. Examples:
 *     N=2: [p1] [BASE] [p2]
 *     N=3: [p1] [BASE] [p2] [p3]
 *     N=4: [p1] [p2] [BASE] [p3] [p4]
 *
 * Union anchor: midpoint between base and its specific partner.
 * Children: placed below each union's anchor.
 */
function placeMultiPartnerSubtree(
  baseId: PersonId,
  unionIds: UnionId[],
  leftX: number,
  ctx: PlacementContext,
): number {
  const { data, generations, minGen, positions, visitedUnions } = ctx

  const base = data.entities.people[baseId]
  if (!base) return 0
  const baseGen = generations.get(baseId) ?? 0
  const baseY = yForGen(baseGen, minGen)
  const baseW = personWidth(base.size)

  // Resolve each union → partner, with partnerOrder for sorting
  const entries: Array<{ uid: UnionId; partnerId: PersonId; partnerOrder: number }> = []
  for (const uid of unionIds) {
    const u = data.entities.unions[uid]
    if (!u) continue
    const partnerId = u.malePartnerId === baseId ? u.femalePartnerId : u.malePartnerId
    const partner = data.entities.people[partnerId]
    if (!partner) continue
    entries.push({ uid, partnerId, partnerOrder: partner.partnerOrder ?? 999 })
  }

  // Sort by partnerOrder ascending (left-to-right)
  entries.sort((a, b) => a.partnerOrder - b.partnerOrder)

  // Base slot: floor(N/2), where N = entries.length.
  // Build a linear sequence of (N+1) slots: partners[0..K-1], base, partners[K..N-1].
  const N = entries.length
  const baseSlot = Math.floor(N / 2) // index in the N+1 sequence where base sits

  // Measure per-union children widths for layout
  const childrenWidths = entries.map(({ uid }) => {
    const u = data.entities.unions[uid]
    const cg = u?.childGroupId ? data.entities.childGroups[u.childGroupId] : undefined
    return cg ? measureChildren(cg, ctx) : 0
  })

  // Build the sequence of slot widths. Each partner slot width = max(partnerW, childrenW).
  // Base slot width = baseW (no children attached directly to the base node itself).
  const slotWidths: number[] = []
  let partnerSlot = 0 // tracks which entries[] index maps to the current slot
  for (let slot = 0; slot <= N; slot++) {
    if (slot === baseSlot) {
      slotWidths.push(baseW)
    } else {
      const e = entries[partnerSlot]!
      const partner = data.entities.people[e.partnerId]!
      const pw = personWidth(partner.size)
      const cw = childrenWidths[partnerSlot]!
      slotWidths.push(Math.max(pw, cw))
      partnerSlot++
    }
  }

  const totalWidth = slotWidths.reduce((s, w) => s + w, 0) + N * LAYOUT.PARTNER_GAP

  // Assign x-centers for each slot (left to right)
  const slotCenters: number[] = []
  let cursor = leftX
  for (let slot = 0; slot <= N; slot++) {
    const w = slotWidths[slot]!
    slotCenters.push(cursor + w / 2)
    cursor += w + LAYOUT.PARTNER_GAP
  }

  // Place base
  const baseCenterX = slotCenters[baseSlot]!
  positions.set(baseId, { x: baseCenterX, y: baseY })

  // Place partners and union anchors; then place children
  partnerSlot = 0
  for (let slot = 0; slot <= N; slot++) {
    if (slot === baseSlot) continue

    const e = entries[partnerSlot]!
    const { uid, partnerId } = e
    const partner = data.entities.people[partnerId]!
    const pw = personWidth(partner.size)
    const slotCenter = slotCenters[slot]!
    const slotLeft = slotCenter - slotWidths[slot]! / 2

    // Partner is centered within its slot
    const partnerX = slotCenter - slotWidths[slot]! / 2 + pw / 2
    positions.set(partnerId, { x: partnerX, y: baseY })
    visitedUnions.add(uid)

    // Fix 3: union anchor = midpoint between base and this partner
    const unionX = (baseCenterX + partnerX) / 2
    positions.set(uid, { x: unionX, y: baseY })

    // Fix 2: place children below the union anchor
    const u = data.entities.unions[uid]
    const cg = u?.childGroupId ? data.entities.childGroups[u.childGroupId] : undefined
    if (cg && cg.children.length > 0) {
      const cw = childrenWidths[partnerSlot]!
      const hubX = unionX
      const hubY = baseY + LAYOUT.HUB_OFFSET_Y
      ctx.positions.set(cg.id, { x: hubX, y: hubY })

      const childrenStart = slotLeft + (slotWidths[slot]! - cw) / 2
      placeChildren(cg.id, childrenStart, ctx)
    }

    partnerSlot++
  }

  return totalWidth
}

function placeChildren(childGroupId: ChildGroupId, leftX: number, ctx: PlacementContext): number {
  const cg = ctx.data.entities.childGroups[childGroupId]
  if (!cg) return 0

  let cursorX = leftX
  let i = 0
  while (i < cg.children.length) {
    const entry = cg.children[i]!
    if (entry.kind === 'person' && entry.birthGroupId) {
      const run = collectBirthGroupRun(cg.children, i, entry.birthGroupId)
      const width = placeBirthGroupCluster(entry.birthGroupId, run, cursorX, ctx)
      cursorX += width + LAYOUT.SIBLING_GAP
      i += run.length
    } else {
      const w = placeChildEntry(entry, cursorX, ctx)
      cursorX += w + LAYOUT.SIBLING_GAP
      i++
    }
  }
  return Math.max(0, cursorX - leftX - LAYOUT.SIBLING_GAP)
}

function collectBirthGroupRun(
  entries: ChildEntry[],
  startIndex: number,
  birthGroupId: BirthGroupId,
): Array<{ kind: 'person'; personId: PersonId; birthGroupId: BirthGroupId }> {
  const run: Array<{
    kind: 'person'
    personId: PersonId
    birthGroupId: BirthGroupId
  }> = []
  for (let i = startIndex; i < entries.length; i++) {
    const e = entries[i]!
    if (e.kind !== 'person' || e.birthGroupId !== birthGroupId) break
    run.push({ kind: 'person', personId: e.personId, birthGroupId })
  }
  return run
}

function placeChildEntry(entry: ChildEntry, leftX: number, ctx: PlacementContext): number {
  if (entry.kind === 'loss') {
    return placeLoss(entry.lossId, leftX, ctx)
  }
  const personUnions = ctx.relations.unionsByPerson.get(entry.personId) ?? []
  const downwardUnion = personUnions.find((uid) => !ctx.visitedUnions.has(uid))
  if (downwardUnion) {
    return placeUnionSubtree(downwardUnion, leftX, ctx)
  }
  return placePersonSolo(entry.personId, leftX, ctx)
}

function placeLoss(lossId: PregnancyLossId, leftX: number, ctx: PlacementContext): number {
  const loss = ctx.data.entities.pregnancyLosses[lossId]
  if (!loss) return 0
  const cg = ctx.data.entities.childGroups[loss.childGroupId]
  if (!cg) return 0
  const u = ctx.data.entities.unions[cg.unionId]
  if (!u) return 0
  const parentGen = ctx.generations.get(u.malePartnerId) ?? 0
  const y = yForGen(parentGen + 1, ctx.minGen)
  const w = LAYOUT.LOSS
  ctx.positions.set(lossId, { x: leftX + w / 2, y })
  return w
}

function placeBirthGroupCluster(
  birthGroupId: BirthGroupId,
  members: Array<{ kind: 'person'; personId: PersonId; birthGroupId: BirthGroupId }>,
  leftX: number,
  ctx: PlacementContext,
): number {
  let cursorX = leftX
  for (const m of members) {
    const w = placePersonSolo(m.personId, cursorX, ctx)
    cursorX += w + LAYOUT.SIBLING_GAP
  }
  const width = Math.max(0, cursorX - leftX - LAYOUT.SIBLING_GAP)

  const first = ctx.positions.get(members[0]!.personId)
  const last = ctx.positions.get(members[members.length - 1]!.personId)
  if (first && last) {
    ctx.positions.set(birthGroupId, {
      x: (first.x + last.x) / 2,
      y: first.y - LAYOUT.BIRTH_GROUP_OFFSET_Y,
    })
  }

  return width
}

// ── measurement (bottom-up) ───────────────────────────────

export function measureChildren(cg: { children: ChildEntry[] }, ctx: PlacementContext): number {
  let width = 0
  let i = 0
  while (i < cg.children.length) {
    const entry = cg.children[i]!
    if (entry.kind === 'person' && entry.birthGroupId) {
      const run = collectBirthGroupRun(cg.children, i, entry.birthGroupId)
      width += measureBirthGroupCluster(run, ctx) + LAYOUT.SIBLING_GAP
      i += run.length
    } else {
      width += measureChildEntry(entry, ctx) + LAYOUT.SIBLING_GAP
      i++
    }
  }
  return Math.max(0, width - LAYOUT.SIBLING_GAP)
}

function measureChildEntry(entry: ChildEntry, ctx: PlacementContext): number {
  if (entry.kind === 'loss') return LAYOUT.LOSS
  const personUnions = ctx.relations.unionsByPerson.get(entry.personId) ?? []
  const uid = personUnions.find((id) => !ctx.visitedUnions.has(id))
  if (uid) return measureUnion(uid, ctx)
  const p = ctx.data.entities.people[entry.personId]
  return p ? personWidth(p.size) : 0
}

function measureUnion(unionId: UnionId, ctx: PlacementContext): number {
  const u = ctx.data.entities.unions[unionId]
  if (!u) return 0
  const male = ctx.data.entities.people[u.malePartnerId]
  const female = ctx.data.entities.people[u.femalePartnerId]
  if (!male || !female) return 0
  const coupleWidth = personWidth(male.size) + LAYOUT.PARTNER_GAP + personWidth(female.size)
  const cg = u.childGroupId ? ctx.data.entities.childGroups[u.childGroupId] : undefined
  const childrenWidth = cg ? measureChildren(cg, ctx) : 0
  return Math.max(coupleWidth, childrenWidth)
}

function measureBirthGroupCluster(
  members: Array<{ kind: 'person'; personId: PersonId }>,
  ctx: PlacementContext,
): number {
  let width = 0
  for (const m of members) {
    const p = ctx.data.entities.people[m.personId]
    if (!p) continue
    width += personWidth(p.size) + LAYOUT.SIBLING_GAP
  }
  return Math.max(0, width - LAYOUT.SIBLING_GAP)
}
