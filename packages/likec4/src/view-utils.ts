/** Minimal shape of a LikeC4 view model (subset of @likec4/core's LikeC4ViewModel). */
export type ViewLike = { id: string; title: string | null }

/**
 * Pick which view id to show: keep `current` if it still exists in `views`,
 * otherwise the first view's id (or undefined when there are no views).
 */
export function resolveSelectedViewId(views: ViewLike[], current: string | undefined): string | undefined {
  if (views.length === 0) return undefined
  if (current && views.some((v) => v.id === current)) return current
  return views[0]!.id
}

/** A single compile diagnostic, as returned by LikeC4Model's getErrors() (extra fields ignored). */
export type Likec4Error = { message: string; line: number }

/**
 * Render LikeC4 compile diagnostics as a single human-readable string for the
 * error chip. `line` from getErrors() is 0-based; display it 1-based. Returns
 * null when there are no errors.
 */
export function formatLikec4Errors(errors: Likec4Error[]): string | null {
  if (errors.length === 0) return null
  return errors.map((e) => `Line ${e.line + 1}: ${e.message}`).join('\n')
}
