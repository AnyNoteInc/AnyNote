const COMMENT_HASH_RE = /^#comment-(.+)$/

/** Extract a thread id from a `#comment-<id>` URL hash, or null when absent. */
export function parseCommentHash(hash: string): string | null {
  const id = COMMENT_HASH_RE.exec(hash)?.[1]?.trim()
  return id ? id : null
}
