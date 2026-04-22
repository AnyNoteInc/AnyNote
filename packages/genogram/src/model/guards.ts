import type {
  Annotation,
  BirthGroup,
  ChildGroup,
  Person,
  PregnancyLoss,
  Union,
} from "../types"

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null
}

export function isPerson(x: unknown): x is Person {
  return isObject(x) && "sex" in x && "bloodRelation" in x && "identity" in x
}

export function isUnion(x: unknown): x is Union {
  return isObject(x) && "malePartnerId" in x && "femalePartnerId" in x && "kind" in x
}

export function isChildGroup(x: unknown): x is ChildGroup {
  return isObject(x) && "unionId" in x && "children" in x && Array.isArray(x.children)
}

export function isBirthGroup(x: unknown): x is BirthGroup {
  return isObject(x) && "memberIds" in x && Array.isArray(x.memberIds) && "kind" in x
}

export function isPregnancyLoss(x: unknown): x is PregnancyLoss {
  return isObject(x) && "childGroupId" in x && "kind" in x && !("memberIds" in x)
}

export function isAnnotation(x: unknown): x is Annotation {
  return isObject(x) && "text" in x && typeof x.text === "string"
}
