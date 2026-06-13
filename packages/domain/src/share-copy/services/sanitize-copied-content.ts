import type { Prisma } from '@repo/db'

// Text shown in place of an embedded database when a TEXT page is publicly
// copied (cl2 "Duplicate as template"). The embed references a `DatabaseSource`
// that is NOT copied, so a live render would be broken/leaky; we drop it for a
// clear, inert placeholder paragraph instead.
export const EMBEDDED_DATABASE_COPY_PLACEHOLDER = 'Встроенная база данных недоступна в копии'

// Text shown in place of a synced block when a page is copied into a DIFFERENT
// workspace (Phase 9C). The `SyncedBlock` entity lives in the source workspace
// and is NOT copied, so a cross-workspace reference would dangle and (without
// the runtime access backstop) could leak content. We DETACH: replace the node
// with an inert placeholder paragraph so no `blockId` reference crosses the
// workspace boundary. A same-workspace copy keeps the node (the reference still
// resolves; the runtime `syncedBlock.getById` access check is the backstop).
export const SYNCED_BLOCK_COPY_PLACEHOLDER = 'Синхронизированный блок недоступен в копии'

type TiptapNode = {
  type?: string
  content?: unknown
  [key: string]: unknown
}

/** Options that steer the copy transform. */
export interface SanitizeCopiedContentOptions {
  /**
   * True when the copy stays inside the SAME workspace (e.g. page duplicate).
   * Then synced-block references survive (the canonical block is still
   * reachable). When false/omitted (the cross-workspace default — e.g.
   * copy-to-workspace / duplicate-as-template), synced blocks DETACH into the
   * placeholder so no cross-workspace reference leaks. Default: false (the
   * safe, leak-free choice).
   */
  sameWorkspace?: boolean
}

function placeholderParagraph(text: string): TiptapNode {
  return {
    type: 'paragraph',
    content: [{ type: 'text', text }],
  }
}

function isNode(value: unknown): value is TiptapNode {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Recursively transform a single Tiptap JSON node: any `embeddedDatabase` node
 * becomes the unsupported placeholder paragraph (always — its source is never
 * copied); a `syncedBlock` node is KEPT when the copy stays in the same
 * workspace, otherwise DETACHED into the synced-block placeholder; every other
 * node is rebuilt with its children transformed. Pure — never mutates the input.
 */
function transformNode(node: TiptapNode, sameWorkspace: boolean): TiptapNode {
  if (node.type === 'embeddedDatabase') {
    return placeholderParagraph(EMBEDDED_DATABASE_COPY_PLACEHOLDER)
  }
  if (node.type === 'syncedBlock' && !sameWorkspace) {
    // Cross-workspace: the pure transform cannot resolve the block's content
    // (the node carries only a blockId), so we replace it with an inert
    // placeholder rather than leak the id. Inlining the canonical content is a
    // runtime concern (the «отсоединить» action); the copy snapshot stays inert.
    return placeholderParagraph(SYNCED_BLOCK_COPY_PLACEHOLDER)
  }
  if (Array.isArray(node.content)) {
    return {
      ...node,
      content: node.content.map((child) =>
        isNode(child) ? transformNode(child, sameWorkspace) : child,
      ),
    }
  }
  return node
}

/**
 * Sanitize a copied page's `content` JSON snapshot:
 * - every `embeddedDatabase` node becomes a placeholder paragraph (its source
 *   is never copied);
 * - a `syncedBlock` node is KEPT when `options.sameWorkspace` is true (the
 *   reference still resolves), otherwise DETACHED into a placeholder paragraph
 *   (the cross-workspace default — no dangling cross-workspace reference).
 *
 * Returns the value unchanged when it is null or not a Tiptap doc object.
 *
 * NOTE: this transforms only the `content` JSON snapshot. The authoritative
 * `contentYjs` bytes are NOT rewritten here (that would require a Yjs decode),
 * so a copied page's `contentYjs` may still carry the embed/synced node — but it
 * has no resolvable source in the new workspace, so the editor renders the
 * node's own placeholder card and, for synced blocks, the runtime
 * `syncedBlock.getById` access check is the backstop (a cross-workspace viewer
 * hits 'no_access' → placeholder, never leaking content). The JSON snapshot is
 * what export / preview / non-editor surfaces read, so sanitizing it is the
 * load-bearing step.
 */
export function sanitizeCopiedContent(
  content: Prisma.JsonValue | null,
  options: SanitizeCopiedContentOptions = {},
): Prisma.JsonValue | null {
  if (!isNode(content)) return content
  return transformNode(content, options.sameWorkspace === true) as Prisma.JsonValue
}

/** True when the JSON content contains at least one `embeddedDatabase` node. */
export function contentHasEmbeddedDatabase(content: Prisma.JsonValue | null): boolean {
  if (!isNode(content)) return false
  if (content.type === 'embeddedDatabase') return true
  if (Array.isArray(content.content)) {
    return content.content.some(
      (child) => isNode(child) && contentHasEmbeddedDatabase(child as Prisma.JsonValue),
    )
  }
  return false
}
