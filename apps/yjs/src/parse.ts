/**
 * The Hocuspocus `documentName` is polymorphic (Phase 9C). A bare name is a page
 * id (the historical contract: `documentName === pageId`); a `syncedBlock:<id>`
 * name addresses a SyncedBlock's own collaborative document.
 */
export const SYNCED_BLOCK_PREFIX = 'syncedBlock:'

export type ParsedDocumentName =
  | { kind: 'page'; id: string }
  | { kind: 'syncedBlock'; id: string }

/**
 * Total, defensive parser: every documentName resolves to exactly one kind.
 * `syncedBlock:<id>` → the synced-block document (id is everything after the
 * first prefix); anything else → a page document whose id is the raw name. The
 * page branch leaves the historical pageId handling byte-for-byte unchanged.
 */
export function parseDocumentName(documentName: string): ParsedDocumentName {
  if (documentName.startsWith(SYNCED_BLOCK_PREFIX)) {
    return { kind: 'syncedBlock', id: documentName.slice(SYNCED_BLOCK_PREFIX.length) }
  }
  return { kind: 'page', id: documentName }
}
