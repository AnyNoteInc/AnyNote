import { Inject, Injectable } from '@nestjs/common'
import { Prisma, type PrismaClient } from '@repo/db'

import { PRISMA } from '../../../infra/db/db.providers.js'

const MAX_EXCERPT_WINDOW = 100
const MAX_QUERY_LENGTH = 200
const MIN_QUERY_LENGTH = 2
const PG_DICT = 'russian'
const RESULT_LIMIT = 10

export type PageFtsHit = {
  pageId: string
  title: string
  icon: string | null
  type: string
  blockNumber: number | null
  excerpt: string | null
}

type TiptapNode = { type?: string; text?: string; content?: TiptapNode[] }
type PgRow = { id: string; title: string | null; icon: string | null; type: string; content: Prisma.JsonValue | null }

function extractText(node: TiptapNode): string {
  if (typeof node.text === 'string') return node.text
  if (!Array.isArray(node.content)) return ''
  return node.content.map(extractText).join('')
}

function extractExcerpt(text: string, query: string, window: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  const idx = flat.toLowerCase().indexOf(query.toLowerCase())
  if (idx < 0) return flat
  const start = Math.max(0, idx - window)
  const end = Math.min(flat.length, idx + query.length + window)
  return `${start > 0 ? '...' : ''}${flat.slice(start, end)}${end < flat.length ? '...' : ''}`
}

function findFirstMatchingBlock(doc: unknown, query: string): { blockNumber: number; excerpt: string } | null {
  const root = doc as TiptapNode | null
  if (!root || root.type !== 'doc' || !Array.isArray(root.content)) return null
  const lower = query.toLowerCase()
  for (let i = 0; i < root.content.length; i += 1) {
    const text = extractText(root.content[i] ?? {})
    if (text.toLowerCase().includes(lower)) {
      return { blockNumber: i, excerpt: extractExcerpt(text, query, MAX_EXCERPT_WINDOW) }
    }
  }
  return null
}

function normalizeQuery(raw: string): string | null {
  const query = raw.trim().slice(0, MAX_QUERY_LENGTH)
  return query.length < MIN_QUERY_LENGTH ? null : query
}

@Injectable()
export class PageFtsService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async search(workspaceId: string, rawQuery: string): Promise<PageFtsHit[]> {
    const query = normalizeQuery(rawQuery)
    if (!query) return []

    const rows = await this.prisma.$queryRaw<PgRow[]>`
      SELECT id, title, icon, content, type::text AS type
      FROM "pages"
      WHERE "workspace_id" = ${workspaceId}::uuid
        AND "deleted_at" IS NULL
        AND "archived_at" IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM "pages" p2
          WHERE p2.id = "pages".parent_id AND p2.type = 'DATABASE'
        )
        AND "search_vector" @@ websearch_to_tsquery(${PG_DICT}, ${query})
      ORDER BY ts_rank("search_vector", websearch_to_tsquery(${PG_DICT}, ${query})) DESC
      LIMIT ${RESULT_LIMIT}
    `

    return rows.map((row) => {
      const base = { pageId: row.id, title: row.title ?? '', icon: row.icon, type: row.type }
      if (row.type !== 'TEXT' || !row.content) {
        return { ...base, blockNumber: null, excerpt: null }
      }
      const hit = findFirstMatchingBlock(row.content, query)
      return { ...base, blockNumber: hit?.blockNumber ?? null, excerpt: hit?.excerpt ?? null }
    })
  }
}
