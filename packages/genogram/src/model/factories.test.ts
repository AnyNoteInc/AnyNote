import { describe, expect, it } from "vitest"
import {
  createEmptyGenogram,
  createPerson,
  createUnion,
} from "./factories"
import type { PersonId } from "../types"

describe("factories", () => {
  it("createEmptyGenogram produces a valid empty shell", () => {
    const g = createEmptyGenogram()
    expect(g.version).toBe(1)
    expect(g.entities.people).toEqual({})
    expect(g.entities.unions).toEqual({})
    expect(g.annotations).toEqual({})
    expect(g.layout).toBeUndefined()
  })

  it("createPerson defaults role, size, isDeceased", () => {
    const p = createPerson({ sex: "male", bloodRelation: "direct" })
    expect(p.sex).toBe("male")
    expect(p.role).toBe("regular")
    expect(p.size).toBe("big")
    expect(p.lifeDates.isDeceased).toBe(false)
  })

  it("size defaults to small for sibling/unknown", () => {
    expect(createPerson({ sex: "male", bloodRelation: "sibling" }).size).toBe("small")
    expect(createPerson({ sex: "female", bloodRelation: "unknown" }).size).toBe("small")
  })

  it("size can be overridden explicitly", () => {
    const p = createPerson({ sex: "male", bloodRelation: "sibling", size: "big" })
    expect(p.size).toBe("big")
  })

  it("createUnion defaults to marriage", () => {
    const male = createPerson({ sex: "male", bloodRelation: "direct" })
    const female = createPerson({ sex: "female", bloodRelation: "partner" })
    const u = createUnion({ malePartnerId: male.id, femalePartnerId: female.id })
    expect(u.kind).toBe("marriage")
    expect(u.divorce).toBeUndefined()
  })

  it("ids are unique uuid-shaped strings", () => {
    const a = createPerson({ sex: "male", bloodRelation: "direct" })
    const b = createPerson({ sex: "male", bloodRelation: "direct" })
    expect(a.id).not.toBe(b.id)
    expect(a.id as unknown as string).toMatch(/^[0-9a-f-]{36}$/i)
  })

  it("explicit id is respected", () => {
    const id = "00000000-0000-0000-0000-000000000001" as PersonId
    const p = createPerson({ sex: "male", bloodRelation: "direct", id })
    expect(p.id).toBe(id)
  })
})
