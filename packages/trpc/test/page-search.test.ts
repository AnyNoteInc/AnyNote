import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/helpers/plan', () => ({
  getWorkspaceFeatures: vi.fn(),
}))

import { getWorkspaceFeatures } from '../src/helpers/plan'
import {
  extractExcerpt,
  findFirstMatchingBlock,
  searchPg,
  searchQdrant,
} from '../src/services/page-search'
import { encryptSecret } from '@repo/auth'

process.env.SECRETS_ENCRYPTION_KEY ||= Buffer.alloc(32, 7).toString('base64')

const WS = '11111111-1111-1111-1111-111111111111'
const USER = '99999999-9999-9999-9999-999999999999'
const PG_ROW = (
  overrides: Partial<{
    id: string
    title: string
    icon: string | null
    type: string
    content: unknown
  }> = {},
) => ({
  id: '22222222-2222-2222-2222-222222222222',
  title: 'A doc',
  icon: null,
  type: 'TEXT',
  content: {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'foo bar baz' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'matchword here' }] },
    ],
  },
  ...overrides,
})

function mockPrisma(rows: Array<{ id: string }>, visibleIds?: string[]) {
  // By default every FTS-matched row is visible; pass `visibleIds` to simulate
  // the visibility predicate filtering some hits out.
  const visible = (visibleIds ?? rows.map((row) => row.id)).map((id) => ({ id }))
  return {
    $queryRaw: vi.fn(async () => rows),
    page: { findMany: vi.fn(async () => visible) },
  } as unknown as import('@repo/db').PrismaClient
}

describe('findFirstMatchingBlock', () => {
  it('returns null on non-doc input', () => {
    expect(findFirstMatchingBlock(null, 'foo')).toBeNull()
    expect(findFirstMatchingBlock({ type: 'paragraph' }, 'foo')).toBeNull()
  })

  it('returns null when no top-level child contains the query', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'apples' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'oranges' }] },
      ],
    }
    expect(findFirstMatchingBlock(doc, 'banana')).toBeNull()
  })

  it('finds first matching block index case-insensitively', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Lorem ipsum' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Hello WORLD foo' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'world again' }] },
      ],
    }
    const hit = findFirstMatchingBlock(doc, 'world')
    expect(hit?.blockNumber).toBe(1)
    expect(hit?.excerpt).toContain('WORLD')
  })

  it('walks nested marks and child arrays', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          content: [
            { type: 'text', text: 'Intro: ' },
            { type: 'text', text: 'targetWord', marks: [{ type: 'bold' }] },
          ],
        },
      ],
    }
    expect(findFirstMatchingBlock(doc, 'targetword')?.blockNumber).toBe(0)
  })

  it('handles Cyrillic input', () => {
    const doc = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Это поиск по тексту' }] }],
    }
    expect(findFirstMatchingBlock(doc, 'поиск')?.blockNumber).toBe(0)
  })
})

describe('extractExcerpt', () => {
  it('returns full text if shorter than window', () => {
    expect(extractExcerpt('hello world', 'world', 100)).toBe('hello world')
  })

  it('truncates with ellipsis on both sides when match is in the middle', () => {
    const text = `${'a'.repeat(200)} MATCH ${'b'.repeat(200)}`
    const out = extractExcerpt(text, 'match', 50)
    expect(out.startsWith('...')).toBe(true)
    expect(out.endsWith('...')).toBe(true)
    expect(out.toLowerCase()).toContain('match')
  })

  it('replaces newlines with spaces', () => {
    const text = 'line one\nline two with match\nline three'
    const out = extractExcerpt(text, 'match', 100)
    expect(out).not.toContain('\n')
    expect(out).toContain('match')
  })

  it('returns the original string if query is missing', () => {
    expect(extractExcerpt('hello world', 'nope', 100)).toBe('hello world')
  })
})

describe('searchPg', () => {
  it('returns empty when query shorter than 2 chars', async () => {
    const prisma = mockPrisma([])
    expect(await searchPg(prisma, WS, USER, 'a')).toEqual([])
    expect(prisma.$queryRaw).not.toHaveBeenCalled()
  })

  it('returns empty when prisma yields no rows', async () => {
    const prisma = mockPrisma([])
    expect(await searchPg(prisma, WS, USER, 'matchword')).toEqual([])
  })

  it('maps rows and locates matching block for TEXT pages', async () => {
    const prisma = mockPrisma([PG_ROW()])
    const out = await searchPg(prisma, WS, USER, 'matchword')
    expect(out).toHaveLength(1)
    expect(out[0].pageId).toBe('22222222-2222-2222-2222-222222222222')
    expect(out[0].blockNumber).toBe(1)
    expect(out[0].excerpt).toContain('matchword')
  })

  it('filters out FTS hits the user is not allowed to see', async () => {
    const visibleId = '22222222-2222-2222-2222-222222222222'
    const hiddenId = '55555555-5555-5555-5555-555555555555'
    const prisma = mockPrisma(
      [PG_ROW({ id: visibleId }), PG_ROW({ id: hiddenId, title: 'Private doc' })],
      [visibleId],
    )
    const out = await searchPg(prisma, WS, USER, 'matchword')
    expect(out).toHaveLength(1)
    expect(out[0].pageId).toBe(visibleId)
  })

  it('returns null block and excerpt for non-TEXT pages', async () => {
    const prisma = mockPrisma([PG_ROW({ type: 'EXCALIDRAW', content: null })])
    const out = await searchPg(prisma, WS, USER, 'matchword')
    expect(out).toHaveLength(1)
    expect(out[0].blockNumber).toBeNull()
    expect(out[0].excerpt).toBeNull()
  })

  it('returns null block and excerpt when title matches but content does not', async () => {
    const prisma = mockPrisma([
      PG_ROW({
        title: 'matchword title',
        content: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'unrelated' }] }],
        },
      }),
    ])
    const out = await searchPg(prisma, WS, USER, 'matchword')
    expect(out[0].blockNumber).toBeNull()
    expect(out[0].excerpt).toBeNull()
  })
})

describe('searchQdrant', () => {
  const envBackup = process.env.AGENTS_SERVICE_URL

  beforeEach(() => {
    process.env.AGENTS_SERVICE_URL = 'http://agents.local'
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.mocked(getWorkspaceFeatures).mockResolvedValue({ pageIndexingEnabled: true } as never)
  })

  afterAll(() => {
    process.env.AGENTS_SERVICE_URL = envBackup
  })

  function prismaWithAi(opts: {
    aiSettings: unknown
    pages?: Array<{ id: string; icon: string | null }>
  }) {
    return {
      workspaceAiSettings: { findUnique: vi.fn(async () => opts.aiSettings) },
      page: {
        findMany: vi.fn(async () => opts.pages ?? []),
      },
    } as unknown as import('@repo/db').PrismaClient
  }

  const validAi = {
    embeddingsModel: {
      slug: 'nomic-embed-text',
      vectorSize: 768,
      provider: {
        kind: 'OLLAMA',
        workspaceId: null,
        connection: { baseUrl: 'http://localhost:11434' },
        connectionEnc: null,
      },
    },
  }

  it('returns [] when query shorter than 2 chars', async () => {
    const prisma = prismaWithAi({ aiSettings: validAi })
    expect(await searchQdrant(prisma, WS, USER, 'a')).toEqual([])
  })

  it('returns [] when no embedding model configured', async () => {
    const prisma = prismaWithAi({ aiSettings: { embeddingsModel: null } })
    expect(await searchQdrant(prisma, WS, USER, 'matchword')).toEqual([])
  })

  it('returns [] when plan does not have indexing', async () => {
    vi.mocked(getWorkspaceFeatures).mockResolvedValueOnce({ pageIndexingEnabled: false } as never)
    const prisma = prismaWithAi({ aiSettings: validAi })
    expect(await searchQdrant(prisma, WS, USER, 'matchword')).toEqual([])
  })

  it('returns [] on agents 5xx', async () => {
    const prisma = prismaWithAi({ aiSettings: validAi })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('boom', { status: 500 })),
    )
    expect(await searchQdrant(prisma, WS, USER, 'matchword')).toEqual([])
  })

  it('maps results and filters out deleted or archived pages', async () => {
    const aliveId = '33333333-3333-3333-3333-333333333333'
    const deletedId = '44444444-4444-4444-4444-444444444444'
    const prisma = prismaWithAi({
      aiSettings: validAi,
      pages: [{ id: aliveId, icon: 'doc' }],
    })
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            results: [
              { pageId: aliveId, title: 'Alive', blockNumber: 3, content: 'snippet text' },
              { pageId: deletedId, title: 'Gone', blockNumber: 0, content: '...' },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const out = await searchQdrant(prisma, WS, USER, 'matchword')

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://agents.local/v1/search')
    expect(out).toHaveLength(1)
    expect(out[0]).toEqual({
      pageId: aliveId,
      title: 'Alive',
      icon: 'doc',
      blockNumber: 3,
      excerpt: 'snippet text',
    })
  })

  it('sends provider.kind and decrypted connectionEnc for a custom (workspace-scoped) provider', async () => {
    const aliveId = '33333333-3333-3333-3333-333333333333'
    const customAi = {
      embeddingsModel: {
        slug: 'text-embedding-3-small',
        vectorSize: 1536,
        provider: {
          kind: 'OPENAI',
          workspaceId: WS,
          connection: {},
          connectionEnc: encryptSecret(JSON.stringify({ apiKey: 'sk-custom' })),
        },
      },
    }
    const prisma = prismaWithAi({ aiSettings: customAi, pages: [{ id: aliveId, icon: null }] })
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            results: [{ pageId: aliveId, title: 'X', blockNumber: 0, content: 'c' }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    )
    vi.stubGlobal('fetch', fetchMock)

    await searchQdrant(prisma, WS, USER, 'matchword')

    const body = JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string)
    expect(body.embedding.provider).toBe('openai')
    expect(body.embedding.connection).toEqual({ apiKey: 'sk-custom' })
  })

  it('decrypts connectionEnc for a shared (global) provider with workspaceId null', async () => {
    const aliveId = '33333333-3333-3333-3333-333333333333'
    const globalAi = {
      embeddingsModel: {
        slug: 'text-embedding-3-small',
        vectorSize: 1536,
        provider: {
          kind: 'OPENAI',
          workspaceId: null,
          connection: {},
          connectionEnc: encryptSecret(JSON.stringify({ apiKey: 'sk-global' })),
        },
      },
    }
    const prisma = prismaWithAi({ aiSettings: globalAi, pages: [{ id: aliveId, icon: null }] })
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            results: [{ pageId: aliveId, title: 'X', blockNumber: 0, content: 'c' }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    )
    vi.stubGlobal('fetch', fetchMock)

    await searchQdrant(prisma, WS, USER, 'matchword')

    const body = JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string)
    expect(body.embedding.connection).toEqual({ apiKey: 'sk-global' })
  })
})
