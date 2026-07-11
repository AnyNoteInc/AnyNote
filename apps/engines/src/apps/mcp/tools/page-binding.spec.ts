import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import { ForbiddenException } from '@nestjs/common'

import type { PrismaClient } from '@repo/db'

import type { StorageClient } from '@repo/storage'

import type { AuthedRequest } from '../../api/auth/auth-context.js'
import type { FileUploader } from '../services/file-uploader.service.js'
import type { MarkdownParser } from '../services/markdown-parser.service.js'
import type { MarkdownRenderer } from '../services/markdown-renderer.service.js'
import type { PageWriter } from '../services/page-writer.service.js'
import type { ReminderService } from '../services/reminder.service.js'
import type { StatsService } from '../services/stats.service.js'
import { FileTools } from './file.tools.js'
import { PageFileTools } from './page-file.tools.js'
import { PageTools } from './page.tools.js'
import { ReminderTools } from './reminder.tools.js'
import { makeFakeYjsEditor } from '../services/__testutils__/fake-yjs-editor.js'

describe('page-bound chats (auth.boundPageId)', () => {
  const workspaceId = '22222222-2222-4222-8222-222222222222'
  const boundPageId = '33333333-3333-4333-8333-333333333333'
  const otherPageId = '44444444-4444-4444-8444-444444444444'
  const fileId = '55555555-5555-4555-8555-555555555555'

  const memberFindUnique = jest.fn<(...a: unknown[]) => Promise<unknown>>()
  const prisma = {
    workspaceMember: { findUnique: memberFindUnique },
    workspaceBlockedUser: { findUnique: jest.fn(async () => null) },
  } as unknown as PrismaClient
  const writer = {
    createPage: jest.fn<(...a: unknown[]) => Promise<string>>(),
    updatePage: jest.fn<(...a: unknown[]) => Promise<void>>(),
    setArchived: jest.fn<(...a: unknown[]) => Promise<void>>(),
  } as unknown as PageWriter
  const uploader = {
    attach: jest.fn<(...a: unknown[]) => Promise<void>>(),
  } as unknown as FileUploader
  const parser = { parse: jest.fn<(markdown: string) => unknown>() } as unknown as MarkdownParser
  const storage = {
    delete: jest.fn<(...a: unknown[]) => Promise<void>>(),
  } as unknown as StorageClient
  const reminders = {
    createReminder: jest.fn<(...a: unknown[]) => Promise<string>>(),
  } as unknown as ReminderService

  const boundReq: AuthedRequest = {
    headers: {},
    auth: { userId: 'u1', source: 'internal', boundPageId },
  }

  let pageTools: PageTools
  let pageFileTools: PageFileTools
  let fileTools: FileTools
  let reminderTools: ReminderTools

  beforeEach(() => {
    jest.clearAllMocks()
    memberFindUnique.mockResolvedValue({ workspaceId })
    pageTools = new PageTools(
      prisma,
      writer,
      {} as MarkdownRenderer,
      parser,
      {} as StatsService,
      makeFakeYjsEditor(),
    )
    pageFileTools = new PageFileTools(prisma, uploader)
    fileTools = new FileTools(prisma, storage)
    reminderTools = new ReminderTools(prisma, reminders)
  })

  it('updatePage rejects a pageId other than the bound page and never reaches the writer', async () => {
    await expect(
      pageTools.updatePage(
        { workspaceId, pageId: otherPageId, title: 'hijack' },
        {} as never,
        boundReq,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException)
    expect(writer.updatePage).not.toHaveBeenCalled()
  })

  it('updatePage still allows the bound page itself', async () => {
    ;(writer.updatePage as jest.Mock).mockResolvedValue(undefined as never)
    const result = await pageTools.updatePage(
      { workspaceId, pageId: boundPageId, title: 'ok' },
      {} as never,
      boundReq,
    )
    expect(result).toEqual({ ok: true })
    expect(writer.updatePage).toHaveBeenCalledWith(expect.objectContaining({ pageId: boundPageId }))
  })

  it('archivePage rejects a pageId other than the bound page', async () => {
    await expect(
      pageTools.archivePage({ workspaceId, pageId: otherPageId }, {} as never, boundReq),
    ).rejects.toBeInstanceOf(ForbiddenException)
    expect(writer.setArchived).not.toHaveBeenCalled()
  })

  it('createPage is blocked entirely for a page-bound chat', async () => {
    await expect(
      pageTools.createPage(
        { workspaceId, title: 'new page', ownership: 'TEXT' },
        {} as never,
        boundReq,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException)
    expect(writer.createPage).not.toHaveBeenCalled()
  })

  it('attachFileToPage rejects a pageId other than the bound page', async () => {
    await expect(
      pageFileTools.attachFileToPage(
        { workspaceId, pageId: otherPageId, fileId },
        {} as never,
        boundReq,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException)
    expect(uploader.attach).not.toHaveBeenCalled()
  })

  it('delete_file is blocked entirely for a page-bound chat', async () => {
    await expect(
      fileTools.deleteFile({ workspaceId, fileId, confirm: true }, {} as never, boundReq),
    ).rejects.toBeInstanceOf(ForbiddenException)
    expect(storage.delete).not.toHaveBeenCalled()
  })

  it('createReminder rejects a pageId other than the bound page', async () => {
    await expect(
      reminderTools.createReminder(
        {
          workspaceId,
          pageId: otherPageId,
          dueAt: new Date('2026-08-01T10:00:00Z'),
          audience: 'ME',
        },
        {} as never,
        boundReq,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException)
    expect(reminders.createReminder).not.toHaveBeenCalled()
  })

  it('createReminder still allows the bound page itself', async () => {
    ;(reminders.createReminder as jest.Mock).mockResolvedValue('r1' as never)
    const result = await reminderTools.createReminder(
      { workspaceId, pageId: boundPageId, dueAt: new Date('2026-08-01T10:00:00Z'), audience: 'ME' },
      {} as never,
      boundReq,
    )
    expect(result).toEqual({ reminderId: 'r1' })
    expect(reminders.createReminder).toHaveBeenCalledWith(
      expect.objectContaining({ pageId: boundPageId }),
    )
  })
})
