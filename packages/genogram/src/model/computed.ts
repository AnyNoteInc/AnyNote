import type {
  BloodRelation,
  Person,
  PersonSize,
  RenderableLabel,
} from "../types"
import { computeAge as computeAgeFromDates } from "../utils/dates"

export function resolveSize(bloodRelation: BloodRelation): PersonSize {
  return bloodRelation === "direct" || bloodRelation === "partner" ? "big" : "small"
}

export function resolveLabelPosition(p: Person): RenderableLabel["position"] {
  if (p.label.position && p.label.position !== "auto") {
    return p.label.position
  }
  return p.size === "big" ? "left" : "bottom"
}

export function computeAge(p: Person, now: Date = new Date()): number | undefined {
  return computeAgeFromDates(p.lifeDates.birthDate, p.lifeDates.deathDate, now)
}

export function showDeathCross(p: Person): boolean {
  if (!p.lifeDates.isDeceased) return false
  const kind = p.lifeDates.deathKind
  return kind === "early" || kind === "tragic"
}

export function isDirectBlood(p: Person): boolean {
  return p.bloodRelation === "direct"
}

export function isPartnerPerson(p: Person): boolean {
  return p.bloodRelation === "partner"
}

export function isOwner(p: Person): boolean {
  return p.role === "owner"
}
