import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import { Readable } from 'node:stream'

import { ForbiddenException } from '@nestjs/common'

import type { PrismaClient } from '@repo/db'
import { MAX_INLINE_FILE_BYTES, type StorageClient } from '@repo/storage'

import type { AuthedRequest } from '../../api/auth/auth-context.js'
import { FileNotFoundError, FileTooLargeError } from '../errors/mcp.errors.js'
import { FileTools } from './file.tools.js'

describe('FileTools', () => {
  const userId = '11111111-1111-4111-8111-111111111111'
  const workspaceId = '22222222-2222-4222-8222-222222222222'
  const fileId = '44444444-4444-4444-8444-444444444444'

  const workspaceMemberFindUniqueMock = jest.fn<(...a: unknown[]) => Promise<unknown>>()
  const fileFindManyMock = jest.fn<(...a: unknown[]) => Promise<unknown>>()
  const fileFindFirstMock = jest.fn<(...a: unknown[]) => Promise<unknown>>()
  const fileUpdateMock = jest.fn<(...a: unknown[]) => Promise<unknown>>()
  const fileDeleteMock = jest.fn<(...a: unknown[]) => Promise<unknown>>()

  const mockPrisma = {
    workspaceMember: { findUnique: workspaceMemberFindUniqueMock },
    file: {
      findMany: fileFindManyMock,
      findFirst: fileFindFirstMock,
      update: fileUpdateMock,
      delete: fileDeleteMock,
    },
  } as unknown as PrismaClient

  const storageGetMock = jest.fn<(...a: unknown[]) => Promise<Readable>>()
  const storageDeleteMock = jest.fn<(...a: unknown[]) => Promise<void>>()
  const mockStorage = {
    get: storageGetMock,
    delete: storageDeleteMock,
  } as unknown as StorageClient

  const req: AuthedRequest = { headers: {}, auth: { userId, source: 'internal' } }

  let tools: FileTools

  beforeEach(() => {
    jest.clearAllMocks()
    workspaceMemberFindUniqueMock.mockResolvedValue({ workspaceId })
    storageGetMock.mockResolvedValue(Readable.from(Buffer.from('hello')))
    storageDeleteMock.mockResolvedValue(undefined)
    tools = new FileTools(mockPrisma, mockStorage)
  })

  it('list_files returns ACTIVE workspace files with size as string', async () => {
    const createdAt = new Date('2026-01-01T10:00:00.000Z')
    fileFindManyMock.mockResolvedValue([
      { id: fileId, name: 'a.md', mimeType: 'text/markdown', fileSize: 5n, createdAt },
    ])

    const res = await tools.listFiles({ workspaceId, limit: 20, offset: 0 }, {} as never, req)

    expect(res.files[0]).toEqual({
      id: fileId,
      name: 'a.md',
      mimeType: 'text/markdown',
      fileSize: '5',
      createdAt,
    })
    expect(mockPrisma.workspaceMember.findUnique).toHaveBeenCalled()
    expect(mockPrisma.file.findMany).toHaveBeenCalledWith({
      where: { workspaceId, status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
      take: 20,
      skip: 0,
      select: { id: true, name: true, mimeType: true, fileSize: true, createdAt: true },
    })
  })

  it('list_files throws ForbiddenException for non-member', async () => {
    workspaceMemberFindUniqueMock.mockResolvedValue(null)

    await expect(
      tools.listFiles({ workspaceId, limit: 20, offset: 0 }, {} as never, req),
    ).rejects.toBeInstanceOf(ForbiddenException)
  })

  it('search_files filters ACTIVE files by name (case-insensitive)', async () => {
    const createdAt = new Date('2026-01-02T10:00:00.000Z')
    fileFindManyMock.mockResolvedValue([
      { id: fileId, name: 'report.pdf', mimeType: 'application/pdf', fileSize: 9n, createdAt },
    ])

    const res = await tools.searchFiles(
      { workspaceId, query: 'report', limit: 20 },
      {} as never,
      req,
    )

    expect(res.files[0]).toEqual({
      id: fileId,
      name: 'report.pdf',
      mimeType: 'application/pdf',
      fileSize: '9',
      createdAt,
    })
    expect(mockPrisma.file.findMany).toHaveBeenCalledWith({
      where: {
        workspaceId,
        status: 'ACTIVE',
        name: { contains: 'report', mode: 'insensitive' },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { id: true, name: true, mimeType: true, fileSize: true, createdAt: true },
    })
  })

  it('get_file_download_link returns url without incrementing downloadCount', async () => {
    fileFindFirstMock.mockResolvedValue({ id: fileId })

    const res = await tools.getFileDownloadLink({ workspaceId, fileId }, {} as never, req)

    expect(res).toEqual({ url: `/api/files/${fileId}` })
    expect(mockPrisma.file.findFirst).toHaveBeenCalledWith({
      where: { id: fileId, workspaceId, status: 'ACTIVE' },
      select: { id: true },
    })
    // GET /api/files/[id] already increments on real downloads; counting here
    // would double-count and count links that are never followed.
    expect(mockPrisma.file.update).not.toHaveBeenCalled()
  })

  it('get_file_download_link throws when file missing', async () => {
    fileFindFirstMock.mockResolvedValue(null)

    await expect(
      tools.getFileDownloadLink({ workspaceId, fileId }, {} as never, req),
    ).rejects.toBeInstanceOf(FileNotFoundError)
  })

  it('get_file_content reads S3 bytes and returns extracted text', async () => {
    fileFindFirstMock.mockResolvedValue({
      id: fileId,
      mimeType: 'text/markdown',
      ext: 'md',
      path: 'k1',
      fileSize: 5n,
    })

    const res = await tools.getFileContent(
      { workspaceId, fileId, maxBytes: MAX_INLINE_FILE_BYTES },
      {} as never,
      req,
    )

    expect(res.content).toContain('hello')
    expect(storageGetMock).toHaveBeenCalledWith('k1')
    expect(mockPrisma.file.findFirst).toHaveBeenCalledWith({
      where: { id: fileId, workspaceId, status: 'ACTIVE' },
      select: { id: true, mimeType: true, ext: true, path: true, fileSize: true },
    })
  })

  it('get_file_content rejects an oversized file before reading storage', async () => {
    fileFindFirstMock.mockResolvedValue({
      id: fileId,
      mimeType: 'text/markdown',
      ext: 'md',
      path: 'k1',
      fileSize: BigInt(50 * 1024 * 1024),
    })

    await expect(
      tools.getFileContent(
        { workspaceId, fileId, maxBytes: MAX_INLINE_FILE_BYTES },
        {} as never,
        req,
      ),
    ).rejects.toBeInstanceOf(FileTooLargeError)
    expect(storageGetMock).not.toHaveBeenCalled()
  })

  it('get_file_content throws when file missing', async () => {
    fileFindFirstMock.mockResolvedValue(null)

    await expect(
      tools.getFileContent(
        { workspaceId, fileId, maxBytes: MAX_INLINE_FILE_BYTES },
        {} as never,
        req,
      ),
    ).rejects.toBeInstanceOf(FileNotFoundError)
  })

  it('delete_file hard-deletes S3 object and row when confirmed', async () => {
    fileFindFirstMock.mockResolvedValue({ id: fileId, path: 'k1' })

    const res = await tools.deleteFile({ workspaceId, fileId, confirm: true }, {} as never, req)

    expect(res).toEqual({ deleted: true, fileId })
    expect(storageDeleteMock).toHaveBeenCalledWith('k1')
    expect(mockPrisma.file.delete).toHaveBeenCalledWith({ where: { id: fileId } })
    expect(mockPrisma.file.findFirst).toHaveBeenCalledWith({
      where: { id: fileId, workspaceId },
      select: { id: true, path: true },
    })
  })

  it('delete_file refuses without confirm and does not touch storage/db', async () => {
    await expect(
      tools.deleteFile({ workspaceId, fileId, confirm: false }, {} as never, req),
    ).rejects.toThrow()
    expect(storageDeleteMock).not.toHaveBeenCalled()
    expect(mockPrisma.file.delete).not.toHaveBeenCalled()
  })

  it('delete_file denies a non-member before any destructive action (even with confirm)', async () => {
    workspaceMemberFindUniqueMock.mockResolvedValue(null)

    await expect(
      tools.deleteFile({ workspaceId, fileId, confirm: true }, {} as never, req),
    ).rejects.toBeInstanceOf(ForbiddenException)
    expect(storageDeleteMock).not.toHaveBeenCalled()
    expect(mockPrisma.file.delete).not.toHaveBeenCalled()
  })

  it('delete_file throws when file missing', async () => {
    fileFindFirstMock.mockResolvedValue(null)

    await expect(
      tools.deleteFile({ workspaceId, fileId, confirm: true }, {} as never, req),
    ).rejects.toBeInstanceOf(FileNotFoundError)
  })
})
