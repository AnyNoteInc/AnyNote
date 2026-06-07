import { PageType, type Prisma, type PrismaClient } from '@repo/db'
import { decryptSecret, type EncryptedPayload } from '@repo/auth'

import { getWorkspaceFeatures } from '../helpers/plan'

const MAX_EXCERPT_WINDOW = 100
const MAX_QUERY_LENGTH = 200
const MIN_QUERY_LENGTH = 2
const PG_DICT = 'russian'
const RESULT_LIMIT = 10

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

function normalizeQuery(raw: string): string | null {
  const query = raw.trim().slice(0, MAX_QUERY_LENGTH)
  return query.length < MIN_QUERY_LENGTH ? null : query
}

export type SearchResultItem = {
  pageId: string
  title: string
  icon: string | null
  blockNumber: number | null
  excerpt: string | null
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
  const query = normalizeQuery(rawQuery)
  if (!query) return []

  const rows = await prisma.$queryRaw<PgRow[]>`
    SELECT id, title, icon, content, type::text AS type
    FROM "pages"
    WHERE "workspace_id" = ${workspaceId}::uuid
      AND "deleted_at" IS NULL
      AND "archived_at" IS NULL
      AND "is_template_backing" = false
      AND "search_vector" @@ websearch_to_tsquery(${PG_DICT}, ${query})
    ORDER BY ts_rank("search_vector", websearch_to_tsquery(${PG_DICT}, ${query})) DESC
    LIMIT ${RESULT_LIMIT}
  `

  return rows.map((row) => {
    const base = {
      pageId: row.id,
      title: row.title ?? '',
      icon: row.icon,
    }
    if (row.type !== PageType.TEXT || !row.content) {
      return { ...base, blockNumber: null, excerpt: null }
    }
    const hit = findFirstMatchingBlock(row.content, query)
    return {
      ...base,
      blockNumber: hit?.blockNumber ?? null,
      excerpt: hit?.excerpt ?? null,
    }
  })
}

type WorkspaceAiSettingsRow = {
  embeddingsModel: {
    slug: string
    vectorSize: number | null
    provider: { kind: string; workspaceId: string | null; connection: unknown; connectionEnc: unknown }
  } | null
} | null

type EmbeddingPayload = {
  provider: string
  modelSlug: string
  vectorSize: number
  connection: Record<string, string>
}

// Prefer encrypted credentials when present, falling back to the plaintext
// `connection` only when `connectionEnc` is absent. Both shared (workspaceId
// null) and workspace-scoped custom providers may store creds in
// `connectionEnc`, so the two fields must not be mutually exclusive. Mirrors the
// agent-run payload path so RAG search works for every provider.
function resolveProviderConnection(provider: {
  workspaceId: string | null
  connection: unknown
  connectionEnc: unknown
}): Record<string, string> {
  const raw = provider.connectionEnc
    ? (JSON.parse(decryptSecret(provider.connectionEnc as EncryptedPayload)) as unknown)
    : provider.connection
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = v
  }
  return out
}

function buildEmbedding(ai: WorkspaceAiSettingsRow): EmbeddingPayload | null {
  if (!ai?.embeddingsModel?.vectorSize) return null

  const { slug, vectorSize, provider } = ai.embeddingsModel
  try {
    return {
      provider: provider.kind.toLowerCase(),
      modelSlug: slug,
      vectorSize,
      connection: resolveProviderConnection(provider),
    }
  } catch {
    return null
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
  const query = normalizeQuery(rawQuery)
  if (!query) return []

  const [ai, features] = await Promise.all([
    prisma.workspaceAiSettings.findUnique({
      where: { workspaceId },
      include: { embeddingsModel: { include: { provider: true } } },
    }) as Promise<WorkspaceAiSettingsRow>,
    getWorkspaceFeatures(workspaceId),
  ])

  if (!features.pageIndexingEnabled) return []
  const embedding = buildEmbedding(ai)
  if (!embedding) return []

  const baseUrl = process.env.AGENTS_SERVICE_URL ?? 'http://localhost:8080'
  try {
    const response = await fetch(`${baseUrl}/v1/search`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-workspace-id': workspaceId,
      },
      body: JSON.stringify({ workspaceId, query, limit: RESULT_LIMIT, embedding }),
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) return []

    const body = (await response.json()) as { results: AgentsSearchResult[] }
    const ids = body.results.map((result) => result.pageId)
    if (ids.length === 0) return []

    const pages = await prisma.page.findMany({
      where: { id: { in: ids }, workspaceId, deletedAt: null, archivedAt: null, isTemplateBacking: false },
      select: { id: true, icon: true },
    })
    const iconMap = new Map(pages.map((page) => [page.id, page.icon]))

    return body.results
      .filter((result) => iconMap.has(result.pageId))
      .map((result) => ({
        pageId: result.pageId,
        title: result.title,
        icon: iconMap.get(result.pageId) ?? null,
        blockNumber: result.blockNumber,
        excerpt: result.content,
      }))
  } catch {
    return []
  }
}
