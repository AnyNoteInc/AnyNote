import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import * as Y from 'yjs'

// Mock @repo/db BEFORE importing persistence
const mockTxPageUpdate = jest.fn<(args: unknown) => Promise<unknown>>().mockResolvedValue({})
const mockEnqueueOutboxEventIgnoreConflict = jest
  .fn<(...args: unknown[]) => Promise<void>>()
  .mockResolvedValue()
const mockEnqueueIntegrationEvents = jest
  .fn<(...args: unknown[]) => Promise<void>>()
  .mockResolvedValue()
const mockRevisionFindFirst = jest
  .fn<(args: unknown) => Promise<{ createdAt: Date } | null>>()
  .mockResolvedValue(null)
const mockRevisionCreate = jest.fn<(args: unknown) => Promise<unknown>>().mockResolvedValue({})
const mockTransaction = jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
  return fn({
    page: { update: mockTxPageUpdate },
    pageRevision: { findFirst: mockRevisionFindFirst, create: mockRevisionCreate },
  })
})

jest.unstable_mockModule('@repo/db', () => ({
  prisma: { $transaction: mockTransaction },
  PageType: { TEXT: 'TEXT', EXCALIDRAW: 'EXCALIDRAW', GENOGRAM: 'GENOGRAM', MERMAID: 'MERMAID' },
  PageRevisionAction: {
    EDIT: 'EDIT',
    TITLE_CHANGE: 'TITLE_CHANGE',
    MOVE: 'MOVE',
    ARCHIVE: 'ARCHIVE',
    RESTORE: 'RESTORE',
    PUBLISH: 'PUBLISH',
  },
  Prisma: { sql: (s: TemplateStringsArray, ...v: unknown[]) => ({ s, v }) },
  enqueueOutboxEventIgnoreConflict: mockEnqueueOutboxEventIgnoreConflict,
  enqueueIntegrationEvents: mockEnqueueIntegrationEvents,
}))

const { storePageDocument } = await import('./persistence.js')

beforeEach(() => {
  mockTxPageUpdate.mockClear()
  mockEnqueueOutboxEventIgnoreConflict.mockClear()
  mockEnqueueIntegrationEvents.mockClear()
  mockTransaction.mockClear()
  mockRevisionFindFirst.mockClear()
  mockRevisionFindFirst.mockResolvedValue(null)
  mockRevisionCreate.mockClear()
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

  describe('page-history content capture (throttle)', () => {
    it('captures an EDIT revision (actorId null) when there is no prior revision', async () => {
      mockRevisionFindFirst.mockResolvedValue(null)
      const doc = new Y.Doc()
      doc.getXmlFragment('default').insert(0, [new Y.XmlElement('paragraph')])

      await storePageDocument({
        pageId: '00000000-0000-0000-0000-000000000001',
        workspaceId: '00000000-0000-0000-0000-000000000002',
        document: doc,
        pageType: 'TEXT' as never,
      })

      expect(mockRevisionCreate).toHaveBeenCalledTimes(1)
      const data = (mockRevisionCreate.mock.calls[0]![0] as { data: Record<string, unknown> }).data
      expect(data.action).toBe('EDIT')
      expect(data.actorId).toBeNull()
      expect(data.pageId).toBe('00000000-0000-0000-0000-000000000001')
      expect(data.contentYjs).toBeInstanceOf(Uint8Array)
      // The integration page.content_updated emission (webhook + telegram outbox
      // rows) rides the same throttle branch.
      expect(mockEnqueueIntegrationEvents).toHaveBeenCalledTimes(1)
      const webhookArgs = mockEnqueueIntegrationEvents.mock.calls[0]![1] as Record<string, unknown>
      expect(webhookArgs.event).toBe('page.content_updated')
      expect(webhookArgs.resourceType).toBe('page')
      expect(webhookArgs.resourceId).toBe('00000000-0000-0000-0000-000000000001')
      expect(webhookArgs.workspaceId).toBe('00000000-0000-0000-0000-000000000002')
      expect(webhookArgs.actorId).toBeNull()
    })

    it('SKIPS the revision when the latest is younger than 10 min (time-only throttle)', async () => {
      mockRevisionFindFirst.mockResolvedValue({ createdAt: new Date(Date.now() - 60_000) })
      const doc = new Y.Doc()
      doc.getXmlFragment('default').insert(0, [new Y.XmlElement('paragraph')])

      await storePageDocument({
        pageId: '00000000-0000-0000-0000-000000000001',
        workspaceId: '00000000-0000-0000-0000-000000000002',
        document: doc,
        pageType: 'TEXT' as never,
      })

      expect(mockRevisionCreate).not.toHaveBeenCalled()
      // The throttled branch also suppresses the integration content_updated emission.
      expect(mockEnqueueIntegrationEvents).not.toHaveBeenCalled()
      // page.update + outbox still run
      expect(mockTxPageUpdate).toHaveBeenCalledTimes(1)
    })

    it('captures the revision when the latest is older than 10 min', async () => {
      mockRevisionFindFirst.mockResolvedValue({
        createdAt: new Date(Date.now() - (10 * 60 * 1000 + 60_000)),
      })
      const doc = new Y.Doc()
      doc.getXmlFragment('default').insert(0, [new Y.XmlElement('paragraph')])

      await storePageDocument({
        pageId: '00000000-0000-0000-0000-000000000001',
        workspaceId: '00000000-0000-0000-0000-000000000002',
        document: doc,
        pageType: 'TEXT' as never,
      })

      expect(mockRevisionCreate).toHaveBeenCalledTimes(1)
    })
  })
})
