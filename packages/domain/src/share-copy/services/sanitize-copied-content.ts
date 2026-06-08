import type { Prisma } from '@repo/db'

// Text shown in place of an embedded database when a TEXT page is publicly
// copied (cl2 "Duplicate as template"). The embed references a `DatabaseSource`
// that is NOT copied, so a live render would be broken/leaky; we drop it for a
// clear, inert placeholder paragraph instead.
export const EMBEDDED_DATABASE_COPY_PLACEHOLDER = 'Встроенная база данных недоступна в копии'

type TiptapNode = {
  type?: string
  content?: unknown
  [key: string]: unknown
}

function placeholderParagraph(): TiptapNode {
  return {
    type: 'paragraph',
    content: [{ type: 'text', text: EMBEDDED_DATABASE_COPY_PLACEHOLDER }],
  }
}

function isNode(value: unknown): value is TiptapNode {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Recursively transform a single Tiptap JSON node: any `embeddedDatabase` node
 * becomes the unsupported placeholder paragraph; every other node is rebuilt
 * with its children transformed. Pure — never mutates the input.
 */
function transformNode(node: TiptapNode): TiptapNode {
  if (node.type === 'embeddedDatabase') {
    return placeholderParagraph()
  }
  if (Array.isArray(node.content)) {
    return {
      ...node,
      content: node.content.map((child) => (isNode(child) ? transformNode(child) : child)),
    }
  }
  return node
}

/**
 * Replace every `embeddedDatabase` node in a copied page's `content` JSON with a
 * readonly/unsupported placeholder paragraph. Returns the value unchanged when
 * it is null or not a Tiptap doc object.
 *
 * NOTE: this transforms only the `content` JSON snapshot. The authoritative
 * `contentYjs` bytes are NOT rewritten here (that would require a Yjs decode),
 * so a copied page's `contentYjs` may still carry the embed node — but it has no
 * resolvable source in the new workspace, so the editor renders the node's own
 * placeholder card (no broken/leaky live data). The JSON snapshot is what export
 * / preview / non-editor surfaces read, so sanitizing it is the load-bearing step.
 */
export function sanitizeCopiedContent(content: Prisma.JsonValue | null): Prisma.JsonValue | null {
  if (!isNode(content)) return content
  return transformNode(content) as Prisma.JsonValue
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
