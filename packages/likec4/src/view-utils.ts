/** Minimal shape of a LikeC4 view model (subset of @likec4/core's LikeC4ViewModel). */
export type ViewLike = { id: string; title: string | null }

/** Display label for a view: its title, or its id when the title is empty/absent. */
export function viewLabel(view: ViewLike): string {
  return view.title && view.title.length > 0 ? view.title : view.id
}

/**
 * Pick which view id to show: keep `current` if it still exists in `views`,
 * otherwise the first view's id (or undefined when there are no views).
 */
export function resolveSelectedViewId(views: ViewLike[], current: string | undefined): string | undefined {
  if (views.length === 0) return undefined
  if (current && views.some((v) => v.id === current)) return current
  return views[0]!.id
}
