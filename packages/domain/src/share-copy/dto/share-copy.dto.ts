/** Arguments to deep-copy a public page (and optionally its visible subtree)
 *  into a workspace the actor belongs to ("duplicate as template"). */
export interface CopyTreeInput {
  /** The public page being copied (the share's root, or a published subpage). */
  rootPageId: string
  /** Destination workspace (the actor must be a member). */
  targetWorkspaceId: string
  /** Destination collection (caller resolves a default, e.g. PERSONAL). */
  targetCollectionId: string | null
  /** Who is performing the copy (becomes createdBy/updatedBy of the copies). */
  actorUserId: string
  /** Copy descendants too (default true at the API layer). */
  includeSubtree: boolean
  /** The share the copy originated from — recorded as provenance on each copy. */
  fromShareId: string | null
}

export interface CopyTreeResult {
  /** Id of the newly-created copy of `rootPageId`. */
  rootPageId: string
}
