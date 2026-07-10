import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import type { PrismaClient } from '@repo/db'

import { PageNotFoundError } from '../errors/mcp.errors.js'
import { PageWriter } from './page-writer.service.js'
import type { YjsPageEditor } from './yjs-page-editor.service.js'
import { makeFakeDomain } from './__testutils__/fake-domain.js'

// These tests cover direct-Prisma methods (appendContent). Domain is not called;
// pass a minimal stub to satisfy the constructor signature.
const fakeDomain = makeFakeDomain()

/** Yjs editor stub: `applied:false` exercises the DB fallback path (the
 *  historical behavior these tests pin); flip per-test for the live path. */
function makeYjsEditor(result: { applied: false } | { applied: true; replacements: number }) {
  const applyContentEdit = jest
    .fn<(...a: unknown[]) => Promise<unknown>>()
    .mockResolvedValue(result)
  return { editor: { applyContentEdit } as unknown as YjsPageEditor, applyContentEdit }
}

function makePrisma(page: unknown) {
  const update = jest.fn<(...a: unknown[]) => Promise<unknown>>().mockResolvedValue({})
  const outbox = jest.fn<(...a: unknown[]) => Promise<unknown>>().mockResolvedValue({})
  const findUnique = jest.fn<(...a: unknown[]) => Promise<unknown>>().mockResolvedValue(page)
  const tx = { page: { findUnique, update }, outboxEvent: { create: outbox } }
  const prisma = {
    page: { findUnique },
    $transaction: (fn: (t: typeof tx) => unknown) => fn(tx),
  } as unknown as PrismaClient
  return { prisma, update, outbox }
}

describe('PageWriter.appendContent', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('appends nodes to an existing TEXT doc and rewrites content (yjs fallback)', async () => {
    const current = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'first' }] }] }
    const appended = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'second' }] }] }
    const { prisma, update } = makePrisma({ id: 'p1', workspaceId: 'w1', type: 'TEXT', content: current })
    const writer = new PageWriter(prisma, fakeDomain, makeYjsEditor({ applied: false }).editor)

    await writer.appendContent({ userId: 'u1', workspaceId: 'w1', pageId: 'p1', appended })

    const data = (update.mock.calls[0]![0] as { data: { content: typeof current } }).data
    expect(data.content.content).toHaveLength(2)
  })

  it('skips the content rewrite when the edit was applied to the live yjs doc', async () => {
    const appended = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }] }
    const { prisma, update, outbox } = makePrisma({ id: 'p1', workspaceId: 'w1', type: 'TEXT', content: null })
    const { editor, applyContentEdit } = makeYjsEditor({ applied: true, replacements: 0 })
    const writer = new PageWriter(prisma, fakeDomain, editor)

    await writer.appendContent({ userId: 'u1', workspaceId: 'w1', pageId: 'p1', appended })

    expect(applyContentEdit).toHaveBeenCalledWith(
      expect.objectContaining({ pageId: 'p1', actorUserId: 'u1', edit: { kind: 'append', doc: appended } }),
    )
    // Actor stamp only — content/contentYjs persist through the collab server.
    const data = (update.mock.calls[0]![0] as { data: Record<string, unknown> }).data
    expect(data.content).toBeUndefined()
    expect(data.contentYjs).toBeUndefined()
    // Indexing still gets its outbox row immediately.
    expect(outbox).toHaveBeenCalledTimes(1)
  })

  it('throws PageNotFoundError for a page in another workspace', async () => {
    const { prisma } = makePrisma({ id: 'p1', workspaceId: 'w-other', type: 'TEXT', content: null })
    const writer = new PageWriter(prisma, fakeDomain, makeYjsEditor({ applied: false }).editor)
    await expect(
      writer.appendContent({ userId: 'u1', workspaceId: 'w1', pageId: 'p1', appended: { type: 'doc', content: [] } }),
    ).rejects.toBeInstanceOf(PageNotFoundError)
  })
})

describe('PageWriter.replaceContentText', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('replaces within a text node via the DB fallback and reports the count', async () => {
    const current = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'баня баня' }] }],
    }
    const { prisma, update } = makePrisma({ id: 'p1', workspaceId: 'w1', type: 'TEXT', content: current })
    const writer = new PageWriter(prisma, fakeDomain, makeYjsEditor({ applied: false }).editor)

    const result = await writer.replaceContentText({
      userId: 'u1',
      workspaceId: 'w1',
      pageId: 'p1',
      find: 'баня',
      replace: 'сауна',
      all: true,
    })

    expect(result.replacements).toBe(2)
    const data = (update.mock.calls[0]![0] as { data: { content: typeof current } }).data
    expect(JSON.stringify(data.content)).toContain('сауна сауна')
  })

  it('returns 0 and writes nothing when the text is not found (live path)', async () => {
    const { prisma, update } = makePrisma({ id: 'p1', workspaceId: 'w1', type: 'TEXT', content: null })
    const writer = new PageWriter(prisma, fakeDomain, makeYjsEditor({ applied: true, replacements: 0 }).editor)

    const result = await writer.replaceContentText({
      userId: 'u1',
      workspaceId: 'w1',
      pageId: 'p1',
      find: 'нет такого',
      replace: 'x',
      all: false,
    })

    expect(result.replacements).toBe(0)
    expect(update).not.toHaveBeenCalled()
  })
})
