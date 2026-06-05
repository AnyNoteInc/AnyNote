/**
 * Title font-weight for a Kanban task: heavier when the task is a parent
 * (has ≥1 child). `base` is the non-parent weight a given view uses for its
 * titles (board cards are already semibold at 600, table rows are normal so
 * pass `undefined`), and parents step one level up from there.
 */
export function parentTitleFontWeight(
  isParent: boolean,
  base: number | undefined,
): number | undefined {
  if (!isParent) return base
  return base === undefined ? 600 : base + 100
}
