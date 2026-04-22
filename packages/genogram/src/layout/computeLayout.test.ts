import { describe, expect, it } from "vitest"
import { computeLayout } from "./computeLayout"
import { LAYOUT } from "./constants"
import {
  newGenogram,
  scenarioCouple,
  scenarioNuclearFamily,
  scenarioSolo,
  scenarioThreeGenerations,
  scenarioTwins,
  scenarioWithLoss,
} from "./__fixtures__/scenarios"

describe("computeLayout", () => {
  it("empty genogram produces empty layout", () => {
    const result = computeLayout(newGenogram())
    expect(result.positions).toEqual({})
    expect(result.generations).toEqual({})
    expect(result.bounds).toEqual({ x: 0, y: 0, width: 0, height: 0 })
  })

  it("single person sits at (w/2, 0) with gen 0", () => {
    const { data, ownerId } = scenarioSolo()
    const result = computeLayout(data)
    expect(result.generations[ownerId]).toBe(0)
    expect(result.positions[ownerId]).toEqual({ x: LAYOUT.PERSON_BIG / 2, y: 0 })
  })

  it("couple: male left, female right, union anchor in the middle", () => {
    const { data, maleId, femaleId, unionId } = scenarioCouple()
    const result = computeLayout(data)
    const male = result.positions[maleId]!
    const female = result.positions[femaleId]!
    const union = result.positions[unionId]!

    expect(male.y).toBe(0)
    expect(female.y).toBe(0)
    expect(union.y).toBe(0)
    expect(male.x).toBeLessThan(female.x)
    expect(union.x).toBe((male.x + female.x) / 2)
    // distance between partner centers is PERSON_BIG/2 + PARTNER_GAP + PERSON_BIG/2
    expect(female.x - male.x).toBe(LAYOUT.PERSON_BIG + LAYOUT.PARTNER_GAP)
  })

  it("nuclear family: children below, hub between", () => {
    const { data, unionId, childGroupId, child1Id, child2Id, maleId } =
      scenarioNuclearFamily()
    const result = computeLayout(data)

    const union = result.positions[unionId]!
    const hub = result.positions[childGroupId]!
    const c1 = result.positions[child1Id]!
    const c2 = result.positions[child2Id]!

    // children a generation below parents
    expect(result.generations[maleId]).toBe(0)
    expect(result.generations[child1Id]).toBe(1)
    expect(c1.y).toBe(LAYOUT.GEN_HEIGHT)
    expect(c2.y).toBe(LAYOUT.GEN_HEIGHT)

    // hub between union and child row
    expect(hub.y).toBe(union.y + LAYOUT.HUB_OFFSET_Y)
    expect(hub.x).toBeCloseTo(union.x, 5)

    // siblings ordered and spaced
    expect(c1.x).toBeLessThan(c2.x)
    expect(c2.x - c1.x).toBe(LAYOUT.PERSON_BIG + LAYOUT.SIBLING_GAP)

    // children row centered under union
    expect((c1.x + c2.x) / 2).toBeCloseTo(union.x, 5)
  })

  it("twins share a birth group anchor above them", () => {
    const { data, unionId, twin1Id, twin2Id, birthGroupId } = scenarioTwins()
    const result = computeLayout(data)

    const t1 = result.positions[twin1Id]!
    const t2 = result.positions[twin2Id]!
    const bg = result.positions[birthGroupId]!
    const union = result.positions[unionId]!

    expect(t1.y).toBe(LAYOUT.GEN_HEIGHT)
    expect(t2.y).toBe(LAYOUT.GEN_HEIGHT)
    expect(bg.y).toBe(t1.y - LAYOUT.BIRTH_GROUP_OFFSET_Y)
    expect(bg.x).toBeCloseTo((t1.x + t2.x) / 2, 5)
    expect(bg.x).toBeCloseTo(union.x, 5)
  })

  it("pregnancy loss sits between siblings on the child row", () => {
    const { data, lossId, child1Id, child2Id } = scenarioWithLoss()
    const result = computeLayout(data)

    const c1 = result.positions[child1Id]!
    const loss = result.positions[lossId]!
    const c2 = result.positions[child2Id]!

    expect(loss.y).toBe(LAYOUT.GEN_HEIGHT)
    expect(c1.x).toBeLessThan(loss.x)
    expect(loss.x).toBeLessThan(c2.x)
  })

  it("three generations: grandparents above, pivot/spouse below parent", () => {
    const { data, grandpaId, parentId, pivotId, pivotSpouseId } =
      scenarioThreeGenerations()
    const result = computeLayout(data)

    const gp = result.positions[grandpaId]!
    const parent = result.positions[parentId]!
    const pivot = result.positions[pivotId]!
    const spouse = result.positions[pivotSpouseId]!

    // generations assigned correctly
    expect(result.generations[grandpaId]).toBe(-2)
    expect(result.generations[parentId]).toBe(-1)
    expect(result.generations[pivotId]).toBe(0)

    // Y monotonically increases with generation
    expect(gp.y).toBeLessThan(parent.y)
    expect(parent.y).toBeLessThan(pivot.y)
    expect(pivot.y).toBe(spouse.y)

    // pivot is male (left), spouse female (right) in their union
    expect(pivot.x).toBeLessThan(spouse.x)
  })
})
