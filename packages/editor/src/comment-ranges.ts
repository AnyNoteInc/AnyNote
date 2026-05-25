export type DecoRange = { from: number; to: number }

/**
 * Merge overlapping or touching `[from, to)` ranges into a minimal, sorted set
 * of non-overlapping ranges.
 *
 * Comment highlights are translucent, so when two threads cover intersecting
 * text ProseMirror nests the highlight spans and their backgrounds compound
 * into a darker patch (with doubled underlines). Flattening the ranges first
 * means every character is covered by exactly one `.comment-highlight` span, so
 * the colour stays uniform no matter how many threads overlap it.
 *
 * Pure and non-mutating: the input array and its members are left untouched.
 */
export function mergeRanges(ranges: DecoRange[]): DecoRange[] {
  const sorted = ranges
    .filter((r) => r.to > r.from)
    .sort((a, b) => a.from - b.from || a.to - b.to)

  const merged: DecoRange[] = []
  for (const r of sorted) {
    const last = merged[merged.length - 1]
    if (last && r.from <= last.to) {
      if (r.to > last.to) last.to = r.to
    } else {
      merged.push({ from: r.from, to: r.to })
    }
  }
  return merged
}

export type DecoSpec = { from: number; to: number; className: string }

/**
 * Decoration specs for the comments plugin: flat `comment-highlight` ranges for
 * all comment anchors (merged so translucent highlights never compound), plus
 * an optional `comment-highlight-active` emphasis for the currently selected
 * anchor — a separate, non-translucent layer so it can't darken the base.
 */
export function commentDecorationSpecs(base: DecoRange[], active: DecoRange | null): DecoSpec[] {
  const specs: DecoSpec[] = mergeRanges(base).map((r) => ({
    from: r.from,
    to: r.to,
    className: 'comment-highlight',
  }))
  if (active && active.to > active.from) {
    specs.push({ from: active.from, to: active.to, className: 'comment-highlight-active' })
  }
  return specs
}
