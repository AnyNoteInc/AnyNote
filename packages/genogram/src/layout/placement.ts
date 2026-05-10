import type {
  BirthGroupId,
  ChildEntry,
  ChildGroupId,
  EntityId,
  GenogramPageData,
  Person,
  PersonId,
  PregnancyLossId,
  UnionId,
} from '../types'
import { LAYOUT, bracketDropFor, personWidth } from './constants'
import type { Relations } from './relations'
import type { Point } from './types'
import { rightLabelExtensionPx } from '../utils/labels'

/**
 * The horizontal pixels reserved on the right of an entry's subtree for
 * the rightmost person's right-aligned label, so the next sibling can be
 * placed without covering the text.
 */
function entryRightLabelExtension(entry: ChildEntry, ctx: PlacementContext): number {
  if (entry.kind !== 'person') return 0
  const p = ctx.data.entities.people[entry.personId]
  if (!p) return 0

  const unions = ctx.relations.unionsByPerson.get(p.id) ?? []
  if (unions.length === 0) return rightLabelExtensionPx(p)

  const partners: Person[] = []
  for (const uid of unions) {
    const u = ctx.data.entities.unions[uid]
    if (!u) continue
    const partnerId = u.malePartnerId === p.id ? u.femalePartnerId : u.malePartnerId
    const partner = ctx.data.entities.people[partnerId]
    if (partner) partners.push(partner)
  }
  if (partners.length === 0) return rightLabelExtensionPx(p)

  // Rightmost slot is the partner with the highest partnerOrder
  partners.sort((a, b) => (a.partnerOrder ?? 999) - (b.partnerOrder ?? 999))
  return rightLabelExtensionPx(partners[partners.length - 1]!)
}

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
  // Sort top-gen roots so subtrees that produce a *male* partner of a
  // cross-subtree union land on the left and *female*-producing subtrees
  // land on the right. Insertion-order alone (the previous behaviour) put
  // whichever set of grandparents the user added first on the left, which
  // could leave father's lineage on the right and break the
  // "men on the left, women on the right" rule.
  const order: Record<RootLeaning, number> = { left: 0, neutral: 1, right: 2 }
  roots.sort((a, b) => order[rootLeaning(a, ctx)] - order[rootLeaning(b, ctx)])
  let cursorX = 0
  for (const root of roots) {
    const w = placeUnit(root, cursorX, ctx)
    cursorX += w + LAYOUT.SIBLING_GAP * 2
  }
  // Cross-subtree unions get their non-base partner overwritten by a later
  // root's processing. Re-centre every union's children on its final
  // partner midpoint so child verticals stay inside the rendered bracket.
  reconcileCrossSubtreeChildren(ctx)
}

type RootLeaning = 'left' | 'neutral' | 'right'

/**
 * Determine whether a root subtree should be placed on the left, the right,
 * or doesn't matter ('neutral'). A subtree leans LEFT when it has a male
 * descendant who is a partner in a union with someone OUTSIDE this root —
 * because that male partner needs to sit on the left side of his union.
 * Symmetric logic for female partners ⇒ 'right'.
 */
function rootLeaning(unit: Unit, ctx: PlacementContext): RootLeaning {
  if (unit.kind !== 'union') return 'neutral'
  const u = ctx.data.entities.unions[unit.unionId]
  if (!u || !u.childGroupId) return 'neutral'
  const cg = ctx.data.entities.childGroups[u.childGroupId]
  if (!cg) return 'neutral'

  for (const entry of cg.children) {
    if (entry.kind !== 'person') continue
    const childUnions = ctx.relations.unionsByPerson.get(entry.personId) ?? []
    for (const cuid of childUnions) {
      const cu = ctx.data.entities.unions[cuid]
      if (!cu) continue
      const otherId =
        cu.malePartnerId === entry.personId ? cu.femalePartnerId : cu.malePartnerId
      if (isDescendantOfUnion(otherId, unit.unionId, ctx)) continue
      return cu.malePartnerId === entry.personId ? 'left' : 'right'
    }
  }
  return 'neutral'
}

function isDescendantOfUnion(
  personId: PersonId,
  rootUnionId: UnionId,
  ctx: PlacementContext,
): boolean {
  const seen = new Set<UnionId>()
  const walk = (pid: PersonId): boolean => {
    const parentUnion = ctx.relations.parentUnionByPerson.get(pid)
    if (!parentUnion || seen.has(parentUnion)) return false
    if (parentUnion === rootUnionId) return true
    seen.add(parentUnion)
    const u = ctx.data.entities.unions[parentUnion]
    if (!u) return false
    return walk(u.malePartnerId) || walk(u.femalePartnerId)
  }
  return walk(personId)
}

/**
 * Cross-subtree partners — for example, the owner's father and mother when
 * each has their own grandparent root — get their X coordinates set by
 * whichever root is processed last (the second root's `placePersonSolo`
 * overwrites the partner that the first root had positioned via
 * `placeUnionSubtree`). The children placed during the first root then
 * end up off-centre relative to the now-final bracket, sometimes outside
 * its horizontal span entirely.
 *
 * This pass walks every union top-down and:
 *   - re-derives the union anchor and hub X as the midpoint of the two
 *     partners' final X coordinates,
 *   - re-runs `placeChildren` so child verticals start at the actual
 *     bracket midpoint, AND
 *   - shifts each moved child's *floating* relatives (partners with no
 *     own parents and any descendants of theirs) by the same delta so
 *     couple distance and downstream layout are preserved.
 *
 * Floating subtrees can't be re-laid-out independently — their absolute
 * positions came from the parent's `placeUnionSubtree` call — so shifting
 * is the only way to keep them coupled to the moved child.
 */
function reconcileCrossSubtreeChildren(ctx: PlacementContext): void {
  const unionsByGen = Object.values(ctx.data.entities.unions)
    .map((u) => ({
      union: u,
      gen: ctx.generations.get(u.malePartnerId) ?? 0,
    }))
    .sort((a, b) => a.gen - b.gen)

  for (const { union } of unionsByGen) {
    const cg = union.childGroupId
      ? ctx.data.entities.childGroups[union.childGroupId]
      : undefined
    if (!cg || cg.children.length === 0) continue

    const malePos = ctx.positions.get(union.malePartnerId)
    const femalePos = ctx.positions.get(union.femalePartnerId)
    if (!malePos || !femalePos) continue

    const newUnionX = (malePos.x + femalePos.x) / 2
    const oldUnionPos = ctx.positions.get(union.id)
    if (oldUnionPos && oldUnionPos.x !== newUnionX) {
      ctx.positions.set(union.id, { x: newUnionX, y: oldUnionPos.y })
    }
    const oldHubPos = ctx.positions.get(cg.id)
    if (oldHubPos && oldHubPos.x !== newUnionX) {
      ctx.positions.set(cg.id, { x: newUnionX, y: oldHubPos.y })
    }

    // Capture child positions before re-layout so we can compute deltas.
    const oldChildX = new Map<PersonId, number>()
    for (const entry of cg.children) {
      if (entry.kind !== 'person') continue
      const pos = ctx.positions.get(entry.personId)
      if (pos) oldChildX.set(entry.personId, pos.x)
    }

    const childrenWidth = measureChildren(cg, ctx)
    placeChildren(cg.id, newUnionX - childrenWidth / 2, ctx)

    // Shift floating relatives (partners without own parents + their
    // descendants) by the same delta the child moved by.
    for (const entry of cg.children) {
      if (entry.kind !== 'person') continue
      const oldX = oldChildX.get(entry.personId)
      const newX = ctx.positions.get(entry.personId)?.x
      if (oldX === undefined || newX === undefined) continue
      const delta = newX - oldX
      if (Math.abs(delta) < 0.001) continue
      shiftFloatingRelatives(entry.personId, delta, ctx)
    }
  }
}

/**
 * Shift `personId`'s floating partner(s) — those with no own parent union,
 * meaning they were placed inline with `personId` rather than as a
 * separate root subtree — and the descendants of those floating unions
 * by `delta` along the X axis. Walks transitively so a floating partner's
 * own floating couple (and so on) all move together.
 *
 * Doesn't touch `personId` itself because the caller already updated
 * their position via `placeChildren`.
 */
function shiftFloatingRelatives(
  personId: PersonId,
  delta: number,
  ctx: PlacementContext,
): void {
  const visitedPersons = new Set<PersonId>([personId])
  const visitedUnions = new Set<UnionId>()
  const queue: PersonId[] = [personId]

  const shiftEntity = (id: EntityId) => {
    const pos = ctx.positions.get(id)
    if (pos) ctx.positions.set(id, { x: pos.x + delta, y: pos.y })
  }

  while (queue.length > 0) {
    const pid = queue.shift()!
    const personUnions = ctx.relations.unionsByPerson.get(pid) ?? []
    for (const uid of personUnions) {
      if (visitedUnions.has(uid)) continue
      visitedUnions.add(uid)
      const u = ctx.data.entities.unions[uid]
      if (!u) continue
      const otherId = u.malePartnerId === pid ? u.femalePartnerId : u.malePartnerId
      // Only follow unions where the partner is "floating" — has no parent
      // union of their own. A partner with their own parents is in a
      // separate subtree and was placed with its own coordinate frame; we
      // must NOT drag them along.
      if (ctx.relations.parentUnionByPerson.has(otherId)) continue
      if (!visitedPersons.has(otherId)) {
        visitedPersons.add(otherId)
        shiftEntity(otherId)
      }
      shiftEntity(uid)
      if (u.childGroupId) {
        const cg = ctx.data.entities.childGroups[u.childGroupId]
        if (cg) {
          shiftEntity(cg.id)
          for (const entry of cg.children) {
            if (entry.kind !== 'person') continue
            if (visitedPersons.has(entry.personId)) continue
            visitedPersons.add(entry.personId)
            shiftEntity(entry.personId)
            queue.push(entry.personId)
          }
        }
      }
    }
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
  if (unit.kind === 'multiUnion')
    return placeMultiPartnerSubtree(unit.baseId, unit.unionIds, leftX, ctx)
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

  // Couple gap must clear the male's right-aligned label so the female shape
  // doesn't overlap the text. partnerGap stays at PARTNER_GAP when male has
  // no right label or when the label fits within the default gap.
  const partnerGap = Math.max(LAYOUT.PARTNER_GAP, rightLabelExtensionPx(male))
  const coupleMin = maleW + partnerGap + femaleW

  const cg = u.childGroupId ? ctx.data.entities.childGroups[u.childGroupId] : undefined
  const childrenWidth = cg ? measureChildren(cg, ctx) : 0

  // Bracket span (parent bottom-handle distance) must cover the children row
  // plus a sibling-gap margin on each side, so each child's vertical drop
  // starts on the bracket horizontal rather than dangling outside it.
  const coupleWidth = Math.max(coupleMin, childrenWidth + 2 * LAYOUT.SIBLING_GAP)
  const totalWidth = coupleWidth

  const gen = ctx.generations.get(male.id) ?? 0
  const y = yForGen(gen, ctx.minGen)

  // Spread parents to the edges of coupleWidth so the bracket spans the row.
  const maleCenter = leftX + maleW / 2
  const femaleCenter = leftX + coupleWidth - femaleW / 2
  ctx.positions.set(male.id, { x: maleCenter, y })
  ctx.positions.set(female.id, { x: femaleCenter, y })

  const unionX = (maleCenter + femaleCenter) / 2
  ctx.positions.set(unionId, { x: unionX, y })

  if (cg && cg.children.length > 0) {
    const hubX = unionX
    const hubY = y + bracketDropFor(maleW, femaleW)
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

  // Each between-slot gap must clear the right-aligned label of any base or
  // partner sitting on its left side. Using a single uniform gap (max across
  // base + partners) keeps the row visually balanced.
  const partnerExtensions = [
    rightLabelExtensionPx(base),
    ...entries.map((e) => rightLabelExtensionPx(data.entities.people[e.partnerId]!)),
  ]
  const partnerGap = Math.max(LAYOUT.PARTNER_GAP, ...partnerExtensions)

  // Base sits opposite to its partners: a male base anchors the left end of
  // the row (slot 0) so each new female partner is added on its right; a
  // female base anchors the right end (slot N) so each new male partner is
  // inserted to her left, just past the previous partner.
  const N = entries.length
  const baseSlot = base.sex === 'male' ? 0 : N

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

  const totalWidth = slotWidths.reduce((s, w) => s + w, 0) + N * partnerGap

  // Assign x-centers for each slot (left to right)
  const slotCenters: number[] = []
  let cursor = leftX
  for (let slot = 0; slot <= N; slot++) {
    const w = slotWidths[slot]!
    slotCenters.push(cursor + w / 2)
    cursor += w + partnerGap
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

    // Partner is centered within its slot
    const partnerX = slotCenter - slotWidths[slot]! / 2 + pw / 2
    positions.set(partnerId, { x: partnerX, y: baseY })
    visitedUnions.add(uid)

    // Fix 3: union anchor = midpoint between base and this partner
    const unionX = (baseCenterX + partnerX) / 2
    positions.set(uid, { x: unionX, y: baseY })

    // Fix 2: place children below the union midpoint
    const u = data.entities.unions[uid]
    const cg = u?.childGroupId ? data.entities.childGroups[u.childGroupId] : undefined
    if (cg && cg.children.length > 0) {
      const cw = childrenWidths[partnerSlot]!
      const hubX = unionX
      // Multi-partner stack: each subsequent union's bracket sits one
      // STACK_Y deeper, so hub.y must follow so ChildEdge verticals start
      // on the actual bracket horizontal of THIS union.
      const hubY = baseY + bracketDropFor(baseW, pw) + partnerSlot * LAYOUT.MULTI_PARTNER_STACK_Y
      ctx.positions.set(cg.id, { x: hubX, y: hubY })

      // Centre children on the union anchor instead of the partner's slot.
      // Slot-centering would put a solo child at partner.x, making the
      // child's vertical leg collinear with the partner's bracket leg —
      // visually the line then extends straight from the partner shape
      // down through the child, which breaks the "child line should not
      // continue from a parent element" rule.
      const childrenStart = unionX - cw / 2
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
  let placedCount = 0
  let lastLabelExt = 0

  while (i < cg.children.length) {
    const entry = cg.children[i]!

    // Inter-sibling gap accounts for the previous entry's right-aligned label
    // so it never gets covered by the next sibling.
    if (placedCount > 0) {
      cursorX += Math.max(LAYOUT.SIBLING_GAP, lastLabelExt)
    }

    if (entry.kind === 'person' && entry.birthGroupId) {
      const run = collectBirthGroupRun(cg.children, i, entry.birthGroupId)
      const w = placeBirthGroupCluster(entry.birthGroupId, run, cursorX, ctx)
      cursorX += w
      const lastTwin = run[run.length - 1]
      const lastTwinPerson = lastTwin ? ctx.data.entities.people[lastTwin.personId] : null
      lastLabelExt = lastTwinPerson ? rightLabelExtensionPx(lastTwinPerson) : 0
      i += run.length
    } else {
      const w = placeChildEntry(entry, cursorX, ctx)
      cursorX += w
      lastLabelExt = entryRightLabelExtension(entry, ctx)
      i++
    }
    placedCount++
  }

  // Effective span includes the last sibling's right-label extension so the
  // parent layout reserves enough room for the trailing label.
  return cursorX - leftX + lastLabelExt
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
  const unvisitedUnions = personUnions.filter((uid) => !ctx.visitedUnions.has(uid))
  if (unvisitedUnions.length > 1) {
    // Child has multiple partnerships — use multi-partner placement
    return placeMultiPartnerSubtree(entry.personId, unvisitedUnions, leftX, ctx)
  }
  if (unvisitedUnions.length === 1) {
    return placeUnionSubtree(unvisitedUnions[0]!, leftX, ctx)
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
  let placedCount = 0
  let lastLabelExt = 0
  for (const m of members) {
    if (placedCount > 0) {
      cursorX += Math.max(LAYOUT.SIBLING_GAP, lastLabelExt)
    }
    const w = placePersonSolo(m.personId, cursorX, ctx)
    cursorX += w
    const person = ctx.data.entities.people[m.personId]
    lastLabelExt = person ? rightLabelExtensionPx(person) : 0
    placedCount++
  }
  // Effective span (cursor reflects no trailing gap; add last twin's label
  // extension so the surrounding row reserves room for the trailing label).
  const width = cursorX - leftX + lastLabelExt

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
  let placedCount = 0
  let lastLabelExt = 0
  while (i < cg.children.length) {
    const entry = cg.children[i]!
    if (placedCount > 0) {
      width += Math.max(LAYOUT.SIBLING_GAP, lastLabelExt)
    }
    if (entry.kind === 'person' && entry.birthGroupId) {
      const run = collectBirthGroupRun(cg.children, i, entry.birthGroupId)
      width += measureBirthGroupCluster(run, ctx)
      const lastTwin = run[run.length - 1]
      const lastTwinPerson = lastTwin ? ctx.data.entities.people[lastTwin.personId] : null
      lastLabelExt = lastTwinPerson ? rightLabelExtensionPx(lastTwinPerson) : 0
      i += run.length
    } else {
      width += measureChildEntry(entry, ctx)
      lastLabelExt = entryRightLabelExtension(entry, ctx)
      i++
    }
    placedCount++
  }
  // Mirror placeChildren: include the last sibling's right-label extension.
  return width + lastLabelExt
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
  // Mirrors placeUnionSubtree: partner gap clears male's right label; couple
  // width must also fit children + sibling-gap margins.
  const partnerGap = Math.max(LAYOUT.PARTNER_GAP, rightLabelExtensionPx(male))
  const coupleWidth = personWidth(male.size) + partnerGap + personWidth(female.size)
  const cg = u.childGroupId ? ctx.data.entities.childGroups[u.childGroupId] : undefined
  const childrenWidth = cg ? measureChildren(cg, ctx) : 0
  return Math.max(coupleWidth, childrenWidth + 2 * LAYOUT.SIBLING_GAP)
}

function measureBirthGroupCluster(
  members: Array<{ kind: 'person'; personId: PersonId }>,
  ctx: PlacementContext,
): number {
  let width = 0
  let placedCount = 0
  let lastLabelExt = 0
  for (const m of members) {
    const p = ctx.data.entities.people[m.personId]
    if (!p) continue
    if (placedCount > 0) {
      width += Math.max(LAYOUT.SIBLING_GAP, lastLabelExt)
    }
    width += personWidth(p.size)
    lastLabelExt = rightLabelExtensionPx(p)
    placedCount++
  }
  return width + lastLabelExt
}
