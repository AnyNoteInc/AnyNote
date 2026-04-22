export const LAYOUT = {
  PERSON_BIG: 80,
  PERSON_SMALL: 48,
  LOSS: 24,
  GEN_HEIGHT: 180,
  PARTNER_GAP: 48,
  SIBLING_GAP: 32,
  HUB_OFFSET_Y: 90,
  BIRTH_GROUP_OFFSET_Y: 30,
} as const

export function personWidth(size: "big" | "small"): number {
  return size === "big" ? LAYOUT.PERSON_BIG : LAYOUT.PERSON_SMALL
}
