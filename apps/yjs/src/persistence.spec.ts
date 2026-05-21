import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import * as Y from 'yjs'

// Mock @repo/db BEFORE importing persistence
const mockTxPageUpdate = jest.fn<(args: unknown) => Promise<unknown>>().mockResolvedValue({})
const mockEnqueueOutboxEventIgnoreConflict = jest
  .fn<(...args: unknown[]) => Promise<void>>()
  .mockResolvedValue()
const mockTransaction = jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
  return fn({
    page: { update: mockTxPageUpdate },
  })
})

jest.unstable_mockModule('@repo/db', () => ({
  prisma: { $transaction: mockTransaction },
  PageType: { TEXT: 'TEXT', EXCALIDRAW: 'EXCALIDRAW', GENOGRAM: 'GENOGRAM', MERMAID: 'MERMAID' },
  Prisma: { sql: (s: TemplateStringsArray, ...v: unknown[]) => ({ s, v }) },
  enqueueOutboxEventIgnoreConflict: mockEnqueueOutboxEventIgnoreConflict,
}))

const { storePageDocument } = await import('./persistence.js')

beforeEach(() => {
  mockTxPageUpdate.mockClear()
  mockEnqueueOutboxEventIgnoreConflict.mockClear()
  mockTransaction.mockClear()
})

describe('storePageDocument', () => {
  it('TEXT: writes contentYjs + tiptap JSON + enqueues outbox with 5m delay', async () => {
    const doc = new Y.Doc()
    // Create a Tiptap-compatible Y.Doc structure
    const fragment = doc.getXmlFragment('default')
    fragment.insert(0, [new Y.XmlElement('paragraph')])

    await storePageDocument({
      pageId: '00000000-0000-0000-0000-000000000001',
      workspaceId: '00000000-0000-0000-0000-000000000002',
      document: doc,
      pageType: 'TEXT' as never,
    })

    expect(mockTxPageUpdate).toHaveBeenCalledTimes(1)
    const call = mockTxPageUpdate.mock.calls[0]![0] as {
      data: { content: unknown; contentYjs: unknown }
    }
    expect(call.data.contentYjs).toBeInstanceOf(Uint8Array)
    expect(call.data.content).toBeDefined()

    expect(mockEnqueueOutboxEventIgnoreConflict).toHaveBeenCalledTimes(1)
    const outboxArgs = mockEnqueueOutboxEventIgnoreConflict.mock.calls[0]![1] as {
      eventType: string
      aggregateId: string
      workspaceId: string
      delayMs: number
    }
    expect(outboxArgs.eventType).toBe('page.upserted')
    expect(outboxArgs.aggregateId).toBe('00000000-0000-0000-0000-000000000001')
    expect(outboxArgs.workspaceId).toBe('00000000-0000-0000-0000-000000000002')
    expect(outboxArgs.delayMs).toBe(5 * 60 * 1000)
  })

  it('EXCALIDRAW: saves { elements } JSON to content + NO outbox', async () => {
    const doc = new Y.Doc()
    const yElements = doc.getArray<Y.Map<unknown>>('elements')
    const el = new Y.Map()
    el.set('type', 'rectangle')
    yElements.insert(0, [el])

    await storePageDocument({
      pageId: '00000000-0000-0000-0000-000000000001',
      workspaceId: '00000000-0000-0000-0000-000000000002',
      document: doc,
      pageType: 'EXCALIDRAW' as never,
    })

    const call = mockTxPageUpdate.mock.calls[0]![0] as {
      data: { content: { elements: unknown[] }; contentYjs: unknown }
    }
    expect(call.data.content).toEqual({ elements: [{ type: 'rectangle' }] })
    expect(call.data.contentYjs).toBeInstanceOf(Uint8Array)
    expect(mockEnqueueOutboxEventIgnoreConflict).not.toHaveBeenCalled()
  })

  it('GENOGRAM: saves only contentYjs + NO outbox', async () => {
    const doc = new Y.Doc()
    await storePageDocument({
      pageId: '00000000-0000-0000-0000-000000000001',
      workspaceId: '00000000-0000-0000-0000-000000000002',
      document: doc,
      pageType: 'GENOGRAM' as never,
    })
    const call = mockTxPageUpdate.mock.calls[0]![0] as {
      data: { content?: unknown }
    }
    expect(call.data.content).toBeUndefined()
    expect(mockEnqueueOutboxEventIgnoreConflict).not.toHaveBeenCalled()
  })

  it('MERMAID: saves { source } JSON to content + NO outbox', async () => {
    const doc = new Y.Doc()
    doc.getText('mermaid').insert(0, 'graph TD; A-->B;')

    await storePageDocument({
      pageId: '00000000-0000-0000-0000-000000000001',
      workspaceId: '00000000-0000-0000-0000-000000000002',
      document: doc,
      pageType: 'MERMAID' as never,
    })

    const call = mockTxPageUpdate.mock.calls[0]![0] as {
      data: { content: { source: string }; contentYjs: unknown }
    }
    expect(call.data.content).toEqual({ source: 'graph TD; A-->B;' })
    expect(call.data.contentYjs).toBeInstanceOf(Uint8Array)
    expect(mockEnqueueOutboxEventIgnoreConflict).not.toHaveBeenCalled()
  })
})
