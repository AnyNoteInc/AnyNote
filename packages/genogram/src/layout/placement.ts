import type {
  BirthGroupId,
  ChildEntry,
  ChildGroupId,
  EntityId,
  GenogramPageData,
  PersonId,
  PregnancyLossId,
  UnionId,
} from "../types"
import { LAYOUT, personWidth } from "./constants"
import type { Relations } from "./relations"
import type { Point } from "./types"

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
  | { kind: "person"; personId: PersonId }
  | { kind: "union"; unionId: UnionId }

function findRoots(ctx: PlacementContext): Unit[] {
  const { data, generations, minGen, relations } = ctx
  const visited = new Set<PersonId>()
  const roots: Unit[] = []

  const topPersons: PersonId[] = []
  for (const [pid, gen] of generations) {
    if (gen === minGen) topPersons.push(pid)
  }
  topPersons.sort()

  for (const pid of topPersons) {
    if (visited.has(pid)) continue
    const unions = relations.unionsByPerson.get(pid) ?? []
    const rootUnionId = unions.find((uid) => {
      const u = data.entities.unions[uid]
      if (!u) return false
      const other = u.malePartnerId === pid ? u.femalePartnerId : u.malePartnerId
      return generations.get(other) === minGen
    })
    if (rootUnionId) {
      const u = data.entities.unions[rootUnionId]!
      visited.add(u.malePartnerId)
      visited.add(u.femalePartnerId)
      roots.push({ kind: "union", unionId: rootUnionId })
    } else {
      visited.add(pid)
      roots.push({ kind: "person", personId: pid })
    }
  }

  return roots
}

function placeUnit(unit: Unit, leftX: number, ctx: PlacementContext): number {
  return unit.kind === "union"
    ? placeUnionSubtree(unit.unionId, leftX, ctx)
    : placePersonSolo(unit.personId, leftX, ctx)
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

function placeChildren(
  childGroupId: ChildGroupId,
  leftX: number,
  ctx: PlacementContext,
): number {
  const cg = ctx.data.entities.childGroups[childGroupId]
  if (!cg) return 0

  let cursorX = leftX
  let i = 0
  while (i < cg.children.length) {
    const entry = cg.children[i]!
    if (entry.kind === "person" && entry.birthGroupId) {
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
): Array<{ kind: "person"; personId: PersonId; birthGroupId: BirthGroupId }> {
  const run: Array<{
    kind: "person"
    personId: PersonId
    birthGroupId: BirthGroupId
  }> = []
  for (let i = startIndex; i < entries.length; i++) {
    const e = entries[i]!
    if (e.kind !== "person" || e.birthGroupId !== birthGroupId) break
    run.push({ kind: "person", personId: e.personId, birthGroupId })
  }
  return run
}

function placeChildEntry(
  entry: ChildEntry,
  leftX: number,
  ctx: PlacementContext,
): number {
  if (entry.kind === "loss") {
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
  members: Array<{ kind: "person"; personId: PersonId; birthGroupId: BirthGroupId }>,
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

export function measureChildren(
  cg: { children: ChildEntry[] },
  ctx: PlacementContext,
): number {
  let width = 0
  let i = 0
  while (i < cg.children.length) {
    const entry = cg.children[i]!
    if (entry.kind === "person" && entry.birthGroupId) {
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
  if (entry.kind === "loss") return LAYOUT.LOSS
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
  const coupleWidth =
    personWidth(male.size) + LAYOUT.PARTNER_GAP + personWidth(female.size)
  const cg = u.childGroupId ? ctx.data.entities.childGroups[u.childGroupId] : undefined
  const childrenWidth = cg ? measureChildren(cg, ctx) : 0
  return Math.max(coupleWidth, childrenWidth)
}

function measureBirthGroupCluster(
  members: Array<{ kind: "person"; personId: PersonId }>,
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
