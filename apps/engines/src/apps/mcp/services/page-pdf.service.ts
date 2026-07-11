import { Inject, Injectable } from '@nestjs/common'
import type { PrismaClient } from '@repo/db'
import {
  embedImagesAndRewriteLinks,
  htmlToPdf,
  wrapHtmlDocument,
} from '@repo/page-export'
import type { StorageClient } from '@repo/storage'
import { getSchema } from '@tiptap/core'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import Image from '@tiptap/extension-image'
import { Table } from '@tiptap/extension-table'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import TableRow from '@tiptap/extension-table-row'
import TaskItem from '@tiptap/extension-task-item'
import TaskList from '@tiptap/extension-task-list'
import { generateHTML } from '@tiptap/html'
import StarterKit from '@tiptap/starter-kit'
import { common, createLowlight } from 'lowlight'

import { PRISMA } from '../../../infra/db/db.providers.js'
import { STORAGE } from './file-uploader.service.js'

// The engines-side PDF render. The FULL-fidelity Tiptap→HTML render lives in
// apps/web (its server-extensions pull @repo/editor, whose Bundler-resolved
// extensionless imports the engines Node runtime cannot load), so this service
// renders with the published-extension subset below and SANITIZES the page
// JSON first: generateHTML throws on any node type missing from the schema,
// and real pages carry callouts/columns/mentions/etc. Unknown blocks degrade
// gracefully (children hoisted, url-bearing leaves become links) instead of
// failing the whole export.

const lowlight = createLowlight(common)

/** Published-extension subset shared with the live editor's core nodes. */
export const PDF_EXTENSIONS = [
  StarterKit.configure({ undoRedo: false, codeBlock: false }),
  CodeBlockLowlight.configure({ lowlight }),
  Image,
  TaskList,
  TaskItem.configure({ nested: true }),
  Table.configure({ resizable: false }),
  TableRow,
  TableHeader,
  TableCell,
]

type PdfSchema = ReturnType<typeof getSchema>

type JsonMark = { type: string; attrs?: Record<string, unknown> }

type JsonNode = {
  type?: string
  text?: string
  marks?: JsonMark[]
  attrs?: Record<string, unknown>
  content?: JsonNode[]
}

const nonEmptyString = (v: unknown): string | null =>
  typeof v === 'string' && v.trim().length > 0 ? v : null

const sanitizeMarks = (marks: JsonMark[] | undefined, schema: PdfSchema): JsonMark[] | undefined => {
  const kept = (marks ?? []).filter((m) => m && typeof m.type === 'string' && m.type in schema.marks)
  return kept.length > 0 ? kept : undefined
}

const isInlineJson = (node: JsonNode, schema: PdfSchema): boolean => {
  if (node.type === 'text') return true
  const t = node.type ? schema.nodes[node.type] : undefined
  return Boolean(t?.isInline)
}

/** Group loose inline nodes (hoisted out of unknown containers) into paragraphs. */
const wrapInlineRuns = (nodes: JsonNode[], schema: PdfSchema): JsonNode[] => {
  const out: JsonNode[] = []
  let run: JsonNode[] = []
  const flush = () => {
    if (run.length > 0) {
      out.push({ type: 'paragraph', content: run })
      run = []
    }
  }
  for (const node of nodes) {
    if (isInlineJson(node, schema)) run.push(node)
    else {
      flush()
      out.push(node)
    }
  }
  flush()
  return out
}

/** Degrade an unknown node: url-bearing leaves become links, labeled inline
 *  atoms become text, containers hoist their (sanitized) children. */
const unknownNodeFallback = (
  node: JsonNode,
  schema: PdfSchema,
  parentIsTextblock: boolean,
): JsonNode[] => {
  if (Array.isArray(node.content) && node.content.length > 0) {
    const children = sanitizeChildren(node.content, schema, parentIsTextblock)
    return parentIsTextblock ? children : wrapInlineRuns(children, schema)
  }
  const url =
    nonEmptyString(node.attrs?.url) ??
    nonEmptyString(node.attrs?.src) ??
    nonEmptyString(node.attrs?.href)
  const label =
    nonEmptyString(node.attrs?.name) ??
    nonEmptyString(node.attrs?.title) ??
    nonEmptyString(node.attrs?.label)
  if (url) {
    const text: JsonNode = { type: 'text', text: label ?? url }
    if ('link' in schema.marks) text.marks = [{ type: 'link', attrs: { href: url } }]
    return parentIsTextblock ? [text] : [{ type: 'paragraph', content: [text] }]
  }
  if (label) {
    const text: JsonNode = { type: 'text', text: label }
    return parentIsTextblock ? [text] : [{ type: 'paragraph', content: [text] }]
  }
  return []
}

const sanitizeChildren = (
  nodes: JsonNode[],
  schema: PdfSchema,
  parentIsTextblock: boolean,
): JsonNode[] => {
  const out: JsonNode[] = []
  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue
    if (node.type === 'text') {
      if (typeof node.text !== 'string' || node.text.length === 0) continue
      const marks = sanitizeMarks(node.marks, schema)
      out.push(marks ? { type: 'text', text: node.text, marks } : { type: 'text', text: node.text })
      continue
    }
    const known = node.type ? schema.nodes[node.type] : undefined
    if (known) {
      const next: JsonNode = { ...node }
      if (Array.isArray(node.content)) {
        const children = sanitizeChildren(node.content, schema, known.isTextblock)
        next.content = known.isTextblock ? children : wrapInlineRuns(children, schema)
      }
      if (node.marks) next.marks = sanitizeMarks(node.marks, schema)
      out.push(next)
      continue
    }
    out.push(...unknownNodeFallback(node, schema, parentIsTextblock))
  }
  return out
}

/**
 * Reduce arbitrary page JSON to the PDF schema: known nodes recurse, unknown
 * marks are dropped, unknown nodes degrade (see unknownNodeFallback). Always
 * returns a non-empty doc — generateHTML rejects an empty `block+` doc.
 */
export function sanitizeDocForSchema(
  content: unknown,
  schema: PdfSchema = getSchema(PDF_EXTENSIONS),
): { type: 'doc'; content: JsonNode[] } {
  const doc = (content ?? {}) as JsonNode
  const nodes = doc.type === 'doc' && Array.isArray(doc.content) ? doc.content : []
  const sanitized = wrapInlineRuns(sanitizeChildren(nodes, schema, false), schema)
  return { type: 'doc', content: sanitized.length > 0 ? sanitized : [{ type: 'paragraph' }] }
}

export type RenderPagePdfInput = {
  title: string
  icon: string | null
  content: unknown
  /** Scopes the image-embed file reads — never a cross-tenant read. */
  workspaceId: string
}

@Injectable()
export class PagePdfService {
  private readonly schema: PdfSchema = getSchema(PDF_EXTENSIONS)

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(STORAGE) private readonly storage: StorageClient,
  ) {}

  /** Tiptap JSON → sanitized HTML → Gotenberg PDF bytes. */
  async renderPagePdf(input: RenderPagePdfInput): Promise<Buffer> {
    const doc = sanitizeDocForSchema(input.content, this.schema)
    const raw = generateHTML(doc as Parameters<typeof generateHTML>[0], PDF_EXTENSIONS)
    // Images must be base64-embedded: Gotenberg's Chromium sits on the internal
    // network and cannot fetch the session-authed /api/files routes.
    const body = await embedImagesAndRewriteLinks(raw, {
      prisma: this.prisma,
      storage: this.storage,
      baseUrl: process.env.NEXT_PUBLIC_BASE_URL ?? '',
      workspaceId: input.workspaceId,
    })
    const html = wrapHtmlDocument({ bodyHtml: body, title: input.title, icon: input.icon })
    const pdfStream = await htmlToPdf(html)
    return Buffer.from(await new Response(pdfStream).arrayBuffer())
  }
}
