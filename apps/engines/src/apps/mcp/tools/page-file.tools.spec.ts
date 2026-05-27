import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import { ForbiddenException } from '@nestjs/common'

import type { PrismaClient } from '@repo/db'

import { PageNotFoundError } from '../errors/mcp.errors.js'
import type { FileUploader } from '../services/file-uploader.service.js'
import { PageFileTools } from './page-file.tools.js'

describe('PageFileTools', () => {
  const userId = '11111111-1111-4111-8111-111111111111'
  const workspaceId = '22222222-2222-4222-8222-222222222222'
  const pageId = '33333333-3333-4333-8333-333333333333'

  const mockPrisma = {
    page: {
      findUnique: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
    },
    pageFile: {
      findMany: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
    },
    workspaceMember: {
      findUnique: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
    },
  } as unknown as PrismaClient
  const mockUploader = {
    uploadInline: jest.fn<(...args: unknown[]) => Promise<string>>(),
    attach: jest.fn<(...args: unknown[]) => Promise<void>>(),
  } as unknown as FileUploader

  const req: any = { auth: { userId, source: 'api-key' } }

  let tools: PageFileTools

  beforeEach(() => {
    jest.clearAllMocks()
    ;(mockPrisma as any).workspaceMember.findUnique.mockResolvedValue({ workspaceId })
    ;(mockUploader.uploadInline as jest.Mock).mockReset()
    ;(mockUploader.attach as jest.Mock).mockReset()
    tools = new PageFileTools(mockPrisma, mockUploader)
  })

  it('uploadFileToPage returns fileId and passes imageOnly=false', async () => {
    ;(mockUploader.uploadInline as jest.Mock).mockResolvedValue(
      '44444444-4444-4444-8444-444444444444' as never,
    )

    const result = await tools.uploadFileToPage(
      {
        workspaceId,
        pageId,
        fileName: 'notes.txt',
        mimeType: 'text/plain',
        contentBase64: Buffer.from('hello').toString('base64'),
      },
      {} as never,
      req,
    )

    expect(result).toEqual({ fileId: '44444444-4444-4444-8444-444444444444' })
    expect(mockPrisma.workspaceMember.findUnique).toHaveBeenCalled()
    expect(mockUploader.uploadInline).toHaveBeenCalledWith({
      userId,
      workspaceId,
      pageId,
      fileName: 'notes.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('hello'),
      imageOnly: false,
    })
  })

  it('uploadFileToPage throws ForbiddenException when caller is not a workspace member', async () => {
    ;(mockPrisma as any).workspaceMember.findUnique.mockResolvedValue(null)
    const nonMemberReq: any = { auth: { userId: 'u1', source: 'api-key' } }

    await expect(
      tools.uploadFileToPage(
        {
          workspaceId,
          pageId,
          fileName: 'notes.txt',
          mimeType: 'text/plain',
          contentBase64: Buffer.from('hello').toString('base64'),
        },
        {} as never,
        nonMemberReq,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException)
  })

  it('uploadImageToPage returns fileId and passes imageOnly=true', async () => {
    ;(mockUploader.uploadInline as jest.Mock).mockResolvedValue(
      '55555555-5555-4555-8555-555555555555' as never,
    )

    const result = await tools.uploadImageToPage(
      {
        workspaceId,
        pageId,
        fileName: 'diagram.png',
        mimeType: 'image/png',
        contentBase64: Buffer.from('png').toString('base64'),
      },
      {} as never,
      req,
    )

    expect(result).toEqual({ fileId: '55555555-5555-4555-8555-555555555555' })
    expect(mockPrisma.workspaceMember.findUnique).toHaveBeenCalled()
    expect(mockUploader.uploadInline).toHaveBeenCalledWith({
      userId,
      workspaceId,
      pageId,
      fileName: 'diagram.png',
      mimeType: 'image/png',
      buffer: Buffer.from('png'),
      imageOnly: true,
    })
  })

  it('attachFileToPage returns ok and passes imageOnly=false', async () => {
    ;(mockUploader.attach as jest.Mock).mockResolvedValue(undefined as never)

    const result = await tools.attachFileToPage(
      {
        workspaceId,
        pageId,
        fileId: '44444444-4444-4444-8444-444444444444',
      },
      {} as never,
      req,
    )

    expect(result).toEqual({ ok: true })
    expect(mockPrisma.workspaceMember.findUnique).toHaveBeenCalled()
    expect(mockUploader.attach).toHaveBeenCalledWith({
      userId,
      workspaceId,
      pageId,
      fileId: '44444444-4444-4444-8444-444444444444',
      imageOnly: false,
    })
  })

  it('attachImageToPage returns ok and passes imageOnly=true', async () => {
    ;(mockUploader.attach as jest.Mock).mockResolvedValue(undefined as never)

    const result = await tools.attachImageToPage(
      {
        workspaceId,
        pageId,
        fileId: '55555555-5555-4555-8555-555555555555',
      },
      {} as never,
      req,
    )

    expect(result).toEqual({ ok: true })
    expect(mockPrisma.workspaceMember.findUnique).toHaveBeenCalled()
    expect(mockUploader.attach).toHaveBeenCalledWith({
      userId,
      workspaceId,
      pageId,
      fileId: '55555555-5555-4555-8555-555555555555',
      imageOnly: true,
    })
  })

  it('listPageFiles maps attached file records', async () => {
    const createdAt = new Date('2026-01-01T12:00:00.000Z')
    ;(mockPrisma.page.findUnique as jest.Mock).mockResolvedValue({ workspaceId } as never)
    ;(mockPrisma.pageFile.findMany as jest.Mock).mockResolvedValue([
      {
        file: {
          id: '66666666-6666-4666-8666-666666666666',
          name: 'spec.pdf',
          mimeType: 'application/pdf',
          fileSize: BigInt(128),
          createdAt,
        },
      },
    ] as never)

    const result = await tools.listPageFiles({ workspaceId, pageId }, {} as never, req)

    expect(result).toEqual({
      files: [
        {
          id: '66666666-6666-4666-8666-666666666666',
          name: 'spec.pdf',
          mimeType: 'application/pdf',
          size: 128,
          createdAt,
        },
      ],
    })
    expect(mockPrisma.workspaceMember.findUnique).toHaveBeenCalled()
    expect(mockPrisma.page.findUnique).toHaveBeenCalledWith({
      where: { id: pageId },
      select: { workspaceId: true },
    })
    expect(mockPrisma.pageFile.findMany).toHaveBeenCalledWith({
      where: { pageId },
      select: {
        file: {
          select: { id: true, name: true, mimeType: true, fileSize: true, createdAt: true },
        },
      },
    })
  })

  it('listPageFiles throws when page is missing', async () => {
    ;(mockPrisma.page.findUnique as jest.Mock).mockResolvedValue(null as never)

    await expect(
      tools.listPageFiles({ workspaceId, pageId }, {} as never, req),
    ).rejects.toBeInstanceOf(PageNotFoundError)
  })
})
