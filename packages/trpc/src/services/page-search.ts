import type { Prisma, PrismaClient } from '@repo/db'

import { getWorkspaceFeatures } from '../helpers/plan'

const MAX_EXCERPT_WINDOW = 100

type TiptapNode = {
  type?: string
  text?: string
  content?: TiptapNode[]
}

function extractText(node: TiptapNode): string {
  if (typeof node.text === 'string') return node.text
  if (!Array.isArray(node.content)) return ''
  return node.content.map(extractText).join('')
}

export function findFirstMatchingBlock(
  doc: unknown,
  query: string,
): { blockNumber: number; excerpt: string } | null {
  if (
    !doc ||
    typeof doc !== 'object' ||
    (doc as TiptapNode).type !== 'doc' ||
    !Array.isArray((doc as TiptapNode).content)
  ) {
    return null
  }

  const lower = query.toLowerCase()
  const blocks = (doc as TiptapNode).content as TiptapNode[]
  for (let i = 0; i < blocks.length; i += 1) {
    const text = extractText(blocks[i] ?? {})
    if (text.toLowerCase().includes(lower)) {
      return { blockNumber: i, excerpt: extractExcerpt(text, query, MAX_EXCERPT_WINDOW) }
    }
  }
  return null
}

export function extractExcerpt(text: string, query: string, window: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  const idx = flat.toLowerCase().indexOf(query.toLowerCase())
  if (idx < 0) return flat

  const start = Math.max(0, idx - window)
  const end = Math.min(flat.length, idx + query.length + window)
  const prefix = start > 0 ? '...' : ''
  const suffix = end < flat.length ? '...' : ''
  return `${prefix}${flat.slice(start, end)}${suffix}`
}

export type SearchResultItem = {
  pageId: string
  title: string
  icon: string | null
  blockNumber: number | null
  excerpt: string | null
  source: 'postgres' | 'qdrant'
}

type PgRow = {
  id: string
  title: string | null
  icon: string | null
  type: string
  content: Prisma.JsonValue | null
}

export async function searchPg(
  prisma: PrismaClient,
  workspaceId: string,
  rawQuery: string,
): Promise<SearchResultItem[]> {
  const query = rawQuery.trim().slice(0, 200)
  if (query.length < 2) return []

  const rows = await prisma.$queryRaw<PgRow[]>`
    SELECT id, title, icon, content, type::text AS type
    FROM "pages"
    WHERE "workspace_id" = ${workspaceId}::uuid
      AND "deleted_at" IS NULL
      AND "archived" = false
      AND "search_vector" @@ websearch_to_tsquery('russian', ${query})
    ORDER BY ts_rank("search_vector", websearch_to_tsquery('russian', ${query})) DESC
    LIMIT 10
  `

  return rows.map((row) => {
    if (row.type !== 'TEXT' || !row.content) {
      return {
        pageId: row.id,
        title: row.title ?? '',
        icon: row.icon,
        blockNumber: null,
        excerpt: null,
        source: 'postgres' as const,
      }
    }

    const hit = findFirstMatchingBlock(row.content, query)
    return {
      pageId: row.id,
      title: row.title ?? '',
      icon: row.icon,
      blockNumber: hit?.blockNumber ?? null,
      excerpt: hit?.excerpt ?? null,
      source: 'postgres' as const,
    }
  })
}

type WorkspaceAiSettingsRow = {
  embeddingsModel: {
    slug: string
    vectorSize: number | null
    provider: { slug: string; connection: unknown }
  } | null
} | null

type EmbeddingPayload = {
  provider: string
  modelSlug: string
  vectorSize: number
  connection: Record<string, string>
}

function normalizeConnection(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}

  const out: Record<string, string> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (typeof item === 'string') out[key] = item
  }
  return out
}

function buildEmbedding(ai: WorkspaceAiSettingsRow): EmbeddingPayload | null {
  if (!ai?.embeddingsModel?.vectorSize) return null

  return {
    provider: ai.embeddingsModel.provider.slug,
    modelSlug: ai.embeddingsModel.slug,
    vectorSize: ai.embeddingsModel.vectorSize,
    connection: normalizeConnection(ai.embeddingsModel.provider.connection),
  }
}

type AgentsSearchResult = {
  pageId: string
  title: string
  blockNumber: number
  content: string
}

export async function searchQdrant(
  prisma: PrismaClient,
  workspaceId: string,
  rawQuery: string,
): Promise<SearchResultItem[]> {
  const query = rawQuery.trim().slice(0, 200)
  if (query.length < 2) return []

  const ai = (await prisma.workspaceAiSettings.findUnique({
    where: { workspaceId },
    include: { embeddingsModel: { include: { provider: true } } },
  })) as WorkspaceAiSettingsRow

  const embedding = buildEmbedding(ai)
  if (!embedding) return []

  const features = await getWorkspaceFeatures(workspaceId)
  if (!features.pageIndexingEnabled) return []

  const baseUrl = process.env.AGENTS_SERVICE_URL ?? 'http://localhost:8080'
  try {
    const response = await fetch(`${baseUrl}/v1/search`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-workspace-id': workspaceId,
      },
      body: JSON.stringify({ workspaceId, query, limit: 10, embedding }),
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) return []

    const body = (await response.json()) as { results: AgentsSearchResult[] }
    const ids = body.results.map((result) => result.pageId)
    if (ids.length === 0) return []

    const pages = await prisma.page.findMany({
      where: { id: { in: ids }, workspaceId, deletedAt: null, archived: false },
      select: { id: true, icon: true },
    })
    const iconMap = new Map(pages.map((page) => [page.id, page.icon]))
    const aliveIds = new Set(pages.map((page) => page.id))

    return body.results
      .filter((result) => aliveIds.has(result.pageId))
      .map((result) => ({
        pageId: result.pageId,
        title: result.title,
        icon: iconMap.get(result.pageId) ?? null,
        blockNumber: result.blockNumber,
        excerpt: result.content,
        source: 'qdrant' as const,
      }))
  } catch {
    return []
  }
}
