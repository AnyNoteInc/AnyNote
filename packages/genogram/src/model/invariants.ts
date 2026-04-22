import type { GenogramPageData, Person, PersonId } from "../types"
import type { ValidationIssue } from "./validators"

function issue(path: string[], message: string): ValidationIssue {
  return { path, message, code: "invariant" }
}

export function checkInvariants(data: GenogramPageData): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const { people, unions, childGroups, birthGroups, pregnancyLosses } = data.entities

  for (const u of Object.values(unions)) {
    const male = people[u.malePartnerId]
    const female = people[u.femalePartnerId]

    if (!male) {
      issues.push(issue(["unions", u.id, "malePartnerId"], `unknown person ${u.malePartnerId}`))
    } else if (male.sex !== "male") {
      issues.push(issue(["unions", u.id, "malePartnerId"], "male partner must have sex:'male'"))
    }

    if (!female) {
      issues.push(issue(["unions", u.id, "femalePartnerId"], `unknown person ${u.femalePartnerId}`))
    } else if (female.sex !== "female") {
      issues.push(issue(["unions", u.id, "femalePartnerId"], "female partner must have sex:'female'"))
    }

    if (u.childGroupId && !childGroups[u.childGroupId]) {
      issues.push(issue(["unions", u.id, "childGroupId"], `unknown child group ${u.childGroupId}`))
    }
  }

  // partnerOrder unique per direct person
  const ordersByDirect = new Map<PersonId, Set<number>>()
  for (const u of Object.values(unions)) {
    const male = people[u.malePartnerId]
    const female = people[u.femalePartnerId]
    if (!male || !female) continue
    const direct = pickDirect(male, female)
    const partner = pickPartner(male, female)
    if (!direct || !partner || partner.partnerOrder === undefined) continue
    let set = ordersByDirect.get(direct.id)
    if (!set) {
      set = new Set()
      ordersByDirect.set(direct.id, set)
    }
    if (set.has(partner.partnerOrder)) {
      issues.push(
        issue(
          ["people", partner.id, "partnerOrder"],
          `duplicate partnerOrder ${partner.partnerOrder} for direct ${direct.id}`,
        ),
      )
    }
    set.add(partner.partnerOrder)
  }

  for (const cg of Object.values(childGroups)) {
    if (!unions[cg.unionId]) {
      issues.push(issue(["childGroups", cg.id, "unionId"], `unknown union ${cg.unionId}`))
    }
    cg.children.forEach((entry, i) => {
      const path = ["childGroups", cg.id, "children", String(i)]
      if (entry.kind === "person") {
        if (!people[entry.personId]) {
          issues.push(issue(path, `unknown person ${entry.personId}`))
        }
        if (entry.birthGroupId && !birthGroups[entry.birthGroupId]) {
          issues.push(issue(path, `unknown birth group ${entry.birthGroupId}`))
        }
      } else if (!pregnancyLosses[entry.lossId]) {
        issues.push(issue(path, `unknown pregnancy loss ${entry.lossId}`))
      }
    })
  }

  for (const bg of Object.values(birthGroups)) {
    if (bg.memberIds.length < 2) {
      issues.push(issue(["birthGroups", bg.id, "memberIds"], "birth group requires at least 2 members"))
    }
    for (const mid of bg.memberIds) {
      if (!people[mid]) {
        issues.push(issue(["birthGroups", bg.id, "memberIds"], `unknown person ${mid}`))
      }
    }
    const containing = new Set<string>()
    for (const cg of Object.values(childGroups)) {
      for (const entry of cg.children) {
        if (entry.kind === "person" && entry.birthGroupId === bg.id) {
          containing.add(cg.id)
        }
      }
    }
    if (containing.size > 1) {
      issues.push(
        issue(
          ["birthGroups", bg.id],
          "birth group members must belong to a single child group",
        ),
      )
    }
  }

  for (const pl of Object.values(pregnancyLosses)) {
    if (!childGroups[pl.childGroupId]) {
      issues.push(issue(["pregnancyLosses", pl.id, "childGroupId"], `unknown child group ${pl.childGroupId}`))
    }
  }

  const owners = Object.values(people).filter((p) => p.role === "owner")
  if (owners.length > 1) {
    issues.push(
      issue(
        ["entities", "people"],
        `multiple owners declared: ${owners.map((o) => o.id).join(", ")}`,
      ),
    )
  }

  return issues
}

export function validateGenogram(data: GenogramPageData): ValidationIssue[] {
  return checkInvariants(data)
}

function pickDirect(a: Person, b: Person): Person | null {
  if (a.bloodRelation === "direct") return a
  if (b.bloodRelation === "direct") return b
  return null
}

function pickPartner(a: Person, b: Person): Person | null {
  if (a.bloodRelation === "partner") return a
  if (b.bloodRelation === "partner") return b
  return null
}
