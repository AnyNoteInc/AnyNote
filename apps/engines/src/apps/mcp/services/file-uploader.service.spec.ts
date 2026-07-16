import { jest, describe, it, expect, beforeEach } from '@jest/globals'

import type { PrismaClient } from '@repo/db'
import type { StorageClient } from '@repo/storage'

import { FileUploader, IMAGE_MIME_TYPES } from './file-uploader.service.js'

describe('FileUploader', () => {
  const mockPrisma = {
    $transaction: jest.fn<(...a: unknown[]) => Promise<unknown>>(),
    file: {
      create: jest.fn<(...a: unknown[]) => Promise<unknown>>(),
      findUnique: jest.fn<(...a: unknown[]) => Promise<unknown>>(),
      update: jest.fn<(...a: unknown[]) => Promise<unknown>>(),
      aggregate: jest.fn<(...a: unknown[]) => Promise<unknown>>(),
    },
    workspaceLimit: { findUnique: jest.fn<(...a: unknown[]) => Promise<unknown>>() },
    pageFile: { create: jest.fn<(...a: unknown[]) => Promise<unknown>>() },
    outboxEvent: { create: jest.fn<(...a: unknown[]) => Promise<unknown>>() },
    page: { findUnique: jest.fn<(...a: unknown[]) => Promise<unknown>>() },
    $queryRaw: jest.fn<(...a: unknown[]) => Promise<unknown>>(),
  } as unknown as PrismaClient
  const mockStorage = {
    put: jest.fn<(...a: unknown[]) => Promise<void>>(),
  } as unknown as StorageClient

  let uploader: FileUploader

  beforeEach(() => {
    ;(mockPrisma.$transaction as jest.Mock).mockReset()
    ;(mockPrisma.file.create as jest.Mock).mockReset()
    ;(mockPrisma.file.findUnique as jest.Mock).mockReset()
    ;(mockPrisma.file.update as jest.Mock).mockReset()
    ;(mockPrisma.pageFile.create as jest.Mock).mockReset()
    ;(mockPrisma.outboxEvent.create as jest.Mock).mockReset()
    ;(mockPrisma.page.findUnique as jest.Mock).mockReset()
    ;(mockPrisma.file.aggregate as jest.Mock).mockReset()
    ;(mockPrisma.workspaceLimit.findUnique as jest.Mock).mockReset()
    ;(mockPrisma.$queryRaw as jest.Mock).mockReset().mockResolvedValue([{ id: 'w1' }] as never)
    ;(mockStorage.put as jest.Mock).mockReset()
    // Quota defaults: nothing used, a roomy limit — individual tests override.
    ;(mockPrisma.file.aggregate as jest.Mock).mockResolvedValue({
      _sum: { fileSize: 0n },
    } as never)
    ;(mockPrisma.workspaceLimit.findUnique as jest.Mock).mockResolvedValue({
      maxFileBytes: 1_000_000_000n,
    } as never)
    process.env.UPLOAD_INLINE_MAX_BYTES = '1048576'
    ;(mockPrisma.$transaction as jest.Mock).mockImplementation(((
      fn: (tx: PrismaClient) => Promise<unknown>,
    ) => fn(mockPrisma)) as never)
    uploader = new FileUploader(mockPrisma, mockStorage)
  })

  describe('uploadInline', () => {
    it('rejects oversize file', async () => {
      const big = Buffer.alloc(2_000_000)
      await expect(
        uploader.uploadInline({
          userId: 'u1',
          workspaceId: 'w1',
          pageId: 'p1',
          fileName: 'a.bin',
          mimeType: 'application/octet-stream',
          buffer: big,
          imageOnly: false,
        }),
      ).rejects.toThrow(/FILE_TOO_LARGE/i)
    })

    it('rejects non-image mime when imageOnly=true', async () => {
      await expect(
        uploader.uploadInline({
          userId: 'u1',
          workspaceId: 'w1',
          pageId: 'p1',
          fileName: 'a.txt',
          mimeType: 'text/plain',
          buffer: Buffer.from('x'),
          imageOnly: true,
        }),
      ).rejects.toThrow(/UNSUPPORTED_MIME_TYPE/i)
    })

    it('rejects when page not in workspace', async () => {
      ;(mockPrisma.page.findUnique as jest.Mock).mockResolvedValue({
        id: 'p1',
        workspaceId: 'other',
      } as never)
      await expect(
        uploader.uploadInline({
          userId: 'u1',
          workspaceId: 'w1',
          pageId: 'p1',
          fileName: 'a.txt',
          mimeType: 'text/plain',
          buffer: Buffer.from('x'),
          imageOnly: false,
        }),
      ).rejects.toThrow(/PAGE_NOT_FOUND/i)
    })

    it('uploads and links small file', async () => {
      ;(mockPrisma.page.findUnique as jest.Mock).mockResolvedValue({
        id: 'p1',
        workspaceId: 'w1',
      } as never)
      ;(mockPrisma.file.create as jest.Mock).mockResolvedValue({ id: 'f1' } as never)

      const id = await uploader.uploadInline({
        userId: 'u1',
        workspaceId: 'w1',
        pageId: 'p1',
        fileName: 'a.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('hello'),
        imageOnly: false,
      })

      expect(id).toBe('f1')
      expect(mockStorage.put).toHaveBeenCalled()
      expect(mockPrisma.pageFile.create).toHaveBeenCalled()
      expect(mockPrisma.outboxEvent.create).toHaveBeenCalled()
    })
  })

  describe('uploadGenerated', () => {
    const input = {
      userId: 'u1',
      workspaceId: 'w1',
      pageId: 'p1',
      fileName: 'отчёт.pdf',
      mimeType: 'application/pdf',
    }

    it('persists the artifact and PageFile link when under the workspace quota', async () => {
      ;(mockPrisma.page.findUnique as jest.Mock).mockResolvedValue({
        id: 'p1',
        workspaceId: 'w1',
      } as never)
      ;(mockPrisma.file.create as jest.Mock).mockResolvedValue({ id: 'f9' } as never)

      const id = await uploader.uploadGenerated({ ...input, buffer: Buffer.alloc(2_000_000) })
      expect(id).toBe('f9')
      expect(mockStorage.put).toHaveBeenCalled()
      expect(mockPrisma.pageFile.create).toHaveBeenCalledWith({
        data: { pageId: 'p1', fileId: 'f9' },
      })
      expect(mockPrisma.file.aggregate).toHaveBeenCalledWith({
        where: {
          workspaceId: 'w1',
          OR: [{ status: 'ACTIVE' }, { status: 'PENDING', expiresAt: { gt: expect.any(Date) } }],
        },
        _sum: { fileSize: true },
      })
      expect((mockPrisma.$queryRaw as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(
        (mockPrisma.file.aggregate as jest.Mock).mock.invocationCallOrder[0]!,
      )
      expect((mockPrisma.file.aggregate as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(
        (mockPrisma.file.create as jest.Mock).mock.invocationCallOrder[0]!,
      )
    })

    it('413s with WORKSPACE_STORAGE_LIMIT when the quota would be exceeded', async () => {
      ;(mockPrisma.page.findUnique as jest.Mock).mockResolvedValue({
        id: 'p1',
        workspaceId: 'w1',
      } as never)
      ;(mockPrisma.file.aggregate as jest.Mock).mockResolvedValue({
        _sum: { fileSize: 90n },
      } as never)
      ;(mockPrisma.workspaceLimit.findUnique as jest.Mock).mockResolvedValue({
        maxFileBytes: 100n,
      } as never)

      await expect(
        uploader.uploadGenerated({ ...input, buffer: Buffer.alloc(20) }),
      ).rejects.toThrow(/WORKSPACE_STORAGE_LIMIT/)
      expect(mockPrisma.file.create).not.toHaveBeenCalled()
    })

    it('rejects buffers over the 50MB generated cap before touching the DB', async () => {
      await expect(
        uploader.uploadGenerated({ ...input, buffer: Buffer.alloc(52_428_801) }),
      ).rejects.toThrow(/FILE_TOO_LARGE/)
      expect(mockPrisma.$transaction).not.toHaveBeenCalled()
    })
  })

  describe('attach', () => {
    it('rejects cross-workspace attach', async () => {
      ;(mockPrisma.page.findUnique as jest.Mock).mockResolvedValue({
        id: 'p1',
        workspaceId: 'w1',
      } as never)
      ;(mockPrisma.file.findUnique as jest.Mock).mockResolvedValue({
        id: 'f1',
        workspaceId: 'other',
        mimeType: 'text/plain',
      } as never)
      await expect(
        uploader.attach({
          userId: 'u1',
          workspaceId: 'w1',
          pageId: 'p1',
          fileId: 'f1',
          imageOnly: false,
        }),
      ).rejects.toThrow(/FILE_NOT_FOUND/i)
    })

    it('links existing file', async () => {
      ;(mockPrisma.page.findUnique as jest.Mock).mockResolvedValue({
        id: 'p1',
        workspaceId: 'w1',
      } as never)
      ;(mockPrisma.file.findUnique as jest.Mock).mockResolvedValue({
        id: 'f1',
        workspaceId: 'w1',
        mimeType: 'text/plain',
      } as never)

      await uploader.attach({
        userId: 'u1',
        workspaceId: 'w1',
        pageId: 'p1',
        fileId: 'f1',
        imageOnly: false,
      })

      expect(mockPrisma.pageFile.create).toHaveBeenCalledWith({
        data: { pageId: 'p1', fileId: 'f1' },
      })
      expect(mockPrisma.outboxEvent.create).toHaveBeenCalled()
    })

    it('validates image mime constant exists', () => {
      expect(IMAGE_MIME_TYPES).toContain('image/png')
    })
  })
})
