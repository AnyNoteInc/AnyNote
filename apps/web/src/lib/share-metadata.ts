/**
 * Pure robots policy for a public share page. Indexing is opt-in and only ever
 * granted for a published SITE that explicitly enabled `allowIndexing`. Every
 * other case (LINK mode, unpublished site, indexing disabled) is noindex — so
 * the default for the public route is "do not index", fixing the previous
 * blanket layout-level noindex while still keeping link/draft pages out of
 * search engines.
 */
export function shareRobots(input: {
  mode: 'LINK' | 'SITE'
  published: boolean
  allowIndexing: boolean
}): { index: boolean } {
  return { index: input.mode === 'SITE' && input.published && input.allowIndexing }
}
