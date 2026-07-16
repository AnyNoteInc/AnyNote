/**
 * Port for creating a database item page without coupling a feature module's
 * service to the pages module internals. `PageRepository.createItemPageTx`
 * structurally satisfies this; the DI module wires the concrete repository in.
 * Keeping the dependency on this shared port (not `pages/repositories/...`)
 * preserves domain-module isolation (see `.dependency-cruiser.cjs`).
 */
export interface SubmissionPageAuthorityMetadata {
  id: string
  collectionId: string | null
  parentId: string | null
  parentCollectionId: string | null
}

export interface ItemPageCreator {
  findAccessiblePageIds(
    actorUserId: string,
    workspaceId: string,
    pageIds: readonly string[],
  ): Promise<Set<string>>
  findAccessiblePageLinkIds(
    actorUserId: string,
    workspaceId: string,
    pageIds: readonly string[],
  ): Promise<Set<string>>
  findSubmissionAuthorityPageMetadata(
    workspaceId: string,
    pageIds: readonly string[],
  ): Promise<Map<string, SubmissionPageAuthorityMetadata>>
  createItemPageTx(
    parentPageId: string,
    workspaceId: string,
    actorUserId: string | null,
  ): Promise<{ id: string }>
}
