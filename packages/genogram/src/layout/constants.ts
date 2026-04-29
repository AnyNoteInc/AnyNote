export const LAYOUT = {
  PERSON_BIG: 80,
  PERSON_SMALL: 48,
  // Pregnancy loss (abortion/miscarriage) shares the small-element footprint
  // so the diagonal cross renders at the same visual scale as small persons.
  LOSS: 48,
  GEN_HEIGHT: 180,
  PARTNER_GAP: 48,
  SIBLING_GAP: 32,
  /**
   * Vertical distance from a parent shape's bottom edge down to the
   * horizontal segment of the union bracket. The bracket's vertical legs
   * span this distance. Adding the larger parent's half-height gives the
   * bracket-bottom Y relative to parent.y; this same Y is used for the
   * children hub so the per-child verticals start on the bracket horizontal.
   */
  UNION_BRACKET_DROP: 50,
  /**
   * Vertical step between consecutive union brackets when one person has
   * multiple partners. Brackets stack downward in `partnerOrder` ascending
   * order: bracket 0 sits at the standard drop, bracket 1 at +1*STACK,
   * bracket 2 at +2*STACK, etc. This keeps the horizontals parallel rather
   * than collinear so each partner's connection is visually distinct.
   */
  MULTI_PARTNER_STACK_Y: 14,
  BIRTH_GROUP_OFFSET_Y: 30,
} as const

export function personWidth(size: 'big' | 'small'): number {
  return size === 'big' ? LAYOUT.PERSON_BIG : LAYOUT.PERSON_SMALL
}

/**
 * Vertical offset from parent.y down to the union bracket's horizontal
 * segment, given the partners' shape sizes. The hub for each ChildGroup is
 * placed at this Y so child verticals all start on the bracket horizontal.
 */
export function bracketDropFor(maleW: number, femaleW: number): number {
  return Math.max(maleW, femaleW) / 2 + LAYOUT.UNION_BRACKET_DROP
}
