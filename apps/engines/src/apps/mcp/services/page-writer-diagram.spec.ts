import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import type { PrismaClient } from '@repo/db'
import type { Domain } from '@repo/domain'
import * as Y from 'yjs'

import { PageWriter } from './page-writer.service.js'

// These tests cover direct-Prisma methods (createDiagramPage). Domain is not called;
// pass a minimal stub to satisfy the constructor signature.
const fakeDomain = { pages: {} } as unknown as Domain

describe('PageWriter.createDiagramPage', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('creates a MERMAID page whose contentYjs decodes to the source under the "mermaid" Y.Text', async () => {
    const create = jest.fn<(...a: unknown[]) => Promise<unknown>>().mockResolvedValue({ id: 'p1' })
    const outbox = jest.fn<(...a: unknown[]) => Promise<unknown>>().mockResolvedValue({})
    const findUnique = jest.fn<(...a: unknown[]) => Promise<unknown>>()
    const tx = { page: { create, findUnique }, outboxEvent: { create: outbox } }
    const prisma = { $transaction: (fn: (t: typeof tx) => unknown) => fn(tx) } as unknown as PrismaClient

    const id = await new PageWriter(prisma, fakeDomain).createDiagramPage({
      userId: 'u1', workspaceId: 'w1', title: 'D', kind: 'MERMAID', source: 'graph TD; A-->B',
    })

    expect(id).toBe('p1')
    const data = (create.mock.calls[0]![0] as { data: { type: string; contentYjs: Uint8Array } }).data
    expect(data.type).toBe('MERMAID')
    const ydoc = new Y.Doc()
    Y.applyUpdate(ydoc, data.contentYjs)
    expect(ydoc.getText('mermaid').toString()).toBe('graph TD; A-->B')
  })
})
