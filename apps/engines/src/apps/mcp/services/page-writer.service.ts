import { BadRequestException, Inject, Injectable } from '@nestjs/common'
import { TiptapTransformer } from '@hocuspocus/transformer'
import type { PrismaClient } from '@repo/db'
import { Prisma } from '@repo/db'
import StarterKit from '@tiptap/starter-kit'
import * as Y from 'yjs'

import { PRISMA } from '../../../infra/db/db.providers.js'
import { PageNotFoundError } from '../errors/mcp.errors.js'

export type CreatePageInput = {
  userId: string
  workspaceId: string
  parentId?: string | null
  title: string
  ownership?: 'TEXT' | 'SKILL' | 'AGENT'
  content?: unknown
}

export type UpdatePageInput = {
  userId: string
  workspaceId: string
  pageId: string
  title?: string
  icon?: string | null
  content?: unknown
}

export type MovePageInput = {
  userId: string
  workspaceId: string
  pageId: string
  newParentId?: string | null
  prevPageId?: string | null
}

type TiptapDoc = { type: 'doc'; content?: unknown[] }
export type AppendContentInput = {
  userId: string
  workspaceId: string
  pageId: string
  appended: unknown
}

@Injectable()
export class PageWriter {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async createPage(input: CreatePageInput): Promise<string> {
    return this.prisma.$transaction(async (tx) => {
      await this.ensureParent(tx, input.parentId, input.workspaceId)
      const contentYjs = input.content === undefined ? undefined : buildContentYjs(input.content)
      const page = await tx.page.create({
        data: {
          workspaceId: input.workspaceId,
          parentId: input.parentId ?? null,
          title: input.title,
          ownership: input.ownership ?? 'TEXT',
          type: 'TEXT',
          content: input.content === undefined ? undefined : (input.content as never),
          contentYjs,
          createdById: input.userId,
          updatedById: input.userId,
        },
        select: { id: true },
      })
      await tx.outboxEvent.create({
        data: {
          eventType: 'page.upserted',
          aggregateType: 'page',
          aggregateId: page.id,
          workspaceId: input.workspaceId,
          payload: {},
        },
      })
      return page.id
    })
  }

  async updatePage(input: UpdatePageInput): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const page = await tx.page.findUnique({
        where: { id: input.pageId },
        select: { id: true, workspaceId: true },
      })
      if (page?.workspaceId !== input.workspaceId) {
        throw new PageNotFoundError(input.pageId)
      }
      await tx.page.update({
        where: { id: input.pageId },
        data: {
          title: input.title,
          icon: input.icon,
          content: input.content as never,
          updatedById: input.userId,
        },
      })
      await tx.outboxEvent.create({
        data: {
          eventType: 'page.upserted',
          aggregateType: 'page',
          aggregateId: input.pageId,
          workspaceId: input.workspaceId,
          payload: {},
        },
      })
    })
  }

  async movePage(input: MovePageInput): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // 1. Find the page being moved; validate workspace ownership.
      const page = await tx.page.findUnique({
        where: { id: input.pageId },
        select: { id: true, workspaceId: true, prevPageId: true },
      })
      if (page?.workspaceId !== input.workspaceId) {
        throw new PageNotFoundError(input.pageId)
      }

      // Validate new parent (cross-workspace / soft-deleted check).
      await this.ensureParent(tx, input.newParentId, input.workspaceId)

      // 2. Collapse the old position: find the page currently pointing at the
      //    moved page as predecessor and relink it to moved page's previous
      //    predecessor. Detach first to avoid P2002 on the @unique prevPageId.
      const oldSuccessor = await tx.page.findFirst({
        where: { prevPageId: input.pageId },
        select: { id: true },
      })
      if (oldSuccessor) {
        await tx.page.update({
          where: { id: oldSuccessor.id },
          data: { prevPageId: null },
        })
      }

      // 3. Make room at the new position: the current successor of the new
      //    predecessor must be relinked to the moved page.
      let newSuccessor: { id: string } | null = null
      if (input.prevPageId) {
        newSuccessor = await tx.page.findFirst({
          where: { prevPageId: input.prevPageId, id: { not: input.pageId } },
          select: { id: true },
        })
        if (newSuccessor) {
          await tx.page.update({
            where: { id: newSuccessor.id },
            data: { prevPageId: null },
          })
        }
      }

      // 4. Update the moved page with its new parent + predecessor.
      await tx.page.update({
        where: { id: input.pageId },
        data: {
          parentId: input.newParentId ?? null,
          prevPageId: input.prevPageId ?? null,
          updatedById: input.userId,
        },
      })

      // 5. Finish relinking now that the moved page is out of the way.
      if (oldSuccessor) {
        await tx.page.update({
          where: { id: oldSuccessor.id },
          data: { prevPageId: page.prevPageId ?? null },
        })
      }
      if (newSuccessor) {
        await tx.page.update({
          where: { id: newSuccessor.id },
          data: { prevPageId: input.pageId },
        })
      }

      await tx.outboxEvent.create({
        data: {
          eventType: 'page.upserted',
          aggregateType: 'page',
          aggregateId: input.pageId,
          workspaceId: input.workspaceId,
          payload: {},
        },
      })
    })
  }

  async appendContent(input: AppendContentInput): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const page = await tx.page.findUnique({
        where: { id: input.pageId },
        select: { id: true, workspaceId: true, type: true, content: true },
      })
      if (page?.workspaceId !== input.workspaceId) throw new PageNotFoundError(input.pageId)
      if (page.type !== 'TEXT') throw new BadRequestException('appendToPage supports only TEXT pages')
      const current = (page.content as TiptapDoc | null) ?? { type: 'doc', content: [] }
      const appendedDoc = input.appended as TiptapDoc
      const merged: TiptapDoc = {
        type: 'doc',
        content: [...(current.content ?? []), ...(appendedDoc.content ?? [])],
      }
      await tx.page.update({
        where: { id: input.pageId },
        data: { content: merged as never, contentYjs: buildContentYjs(merged), updatedById: input.userId },
      })
      await tx.outboxEvent.create({
        data: {
          eventType: 'page.upserted',
          aggregateType: 'page',
          aggregateId: input.pageId,
          workspaceId: input.workspaceId,
          payload: {},
        },
      })
    })
  }

  async setArchived(input: {
    userId: string
    workspaceId: string
    pageId: string
    archived: boolean
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const page = await tx.page.findUnique({
        where: { id: input.pageId },
        select: { id: true, workspaceId: true },
      })
      if (page?.workspaceId !== input.workspaceId) throw new PageNotFoundError(input.pageId)
      await tx.page.update({
        where: { id: input.pageId },
        data: { archived: input.archived, updatedById: input.userId },
      })
      await tx.outboxEvent.create({
        data: {
          eventType: 'page.upserted',
          aggregateType: 'page',
          aggregateId: input.pageId,
          workspaceId: input.workspaceId,
          payload: {},
        },
      })
    })
  }

  async createDiagramPage(input: {
    userId: string
    workspaceId: string
    parentId?: string | null
    title: string
    kind: DiagramPageKind
    source: string
  }): Promise<string> {
    return this.prisma.$transaction(async (tx) => {
      await this.ensureParent(tx, input.parentId, input.workspaceId)
      const page = await tx.page.create({
        data: {
          workspaceId: input.workspaceId,
          parentId: input.parentId ?? null,
          title: input.title,
          ownership: 'TEXT',
          type: input.kind,
          contentYjs: buildDiagramContentYjs(input.source, DIAGRAM_DOC_NAME[input.kind]),
          createdById: input.userId,
          updatedById: input.userId,
        },
        select: { id: true },
      })
      await tx.outboxEvent.create({
        data: { eventType: 'page.upserted', aggregateType: 'page', aggregateId: page.id, workspaceId: input.workspaceId, payload: {} },
      })
      return page.id
    })
  }

  async updateDiagramSource(input: {
    userId: string
    workspaceId: string
    pageId: string
    source: string
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const page = await tx.page.findUnique({
        where: { id: input.pageId },
        select: { id: true, workspaceId: true, type: true },
      })
      if (page?.workspaceId !== input.workspaceId) throw new PageNotFoundError(input.pageId)
      const docName = DIAGRAM_DOC_NAME[page.type as DiagramPageKind]
      if (!docName) throw new BadRequestException('Page is not a diagram page')
      await tx.page.update({
        where: { id: input.pageId },
        data: { contentYjs: buildDiagramContentYjs(input.source, docName), updatedById: input.userId },
      })
      await tx.outboxEvent.create({
        data: { eventType: 'page.upserted', aggregateType: 'page', aggregateId: input.pageId, workspaceId: input.workspaceId, payload: {} },
      })
    })
  }

  private async ensureParent(
    tx: Prisma.TransactionClient,
    parentId: string | null | undefined,
    workspaceId: string,
  ): Promise<void> {
    if (!parentId) return
    const parent = await tx.page.findUnique({
      where: { id: parentId },
      select: { workspaceId: true, deletedAt: true },
    })
    if (!parent || parent.workspaceId !== workspaceId || parent.deletedAt) {
      throw new PageNotFoundError(parentId)
    }
  }
}

function buildContentYjs(content: unknown): Uint8Array<ArrayBuffer> {
  const ydoc = TiptapTransformer.toYdoc(content, 'default', [StarterKit])
  const src = Y.encodeStateAsUpdate(ydoc)
  const contentYjs = new Uint8Array(new ArrayBuffer(src.byteLength))
  contentYjs.set(src)
  return contentYjs
}

const DIAGRAM_DOC_NAME = { MERMAID: 'mermaid', PLANTUML: 'plantuml', LIKEC4: 'likec4' } as const
export type DiagramPageKind = keyof typeof DIAGRAM_DOC_NAME

function buildDiagramContentYjs(source: string, docName: string): Uint8Array<ArrayBuffer> {
  const ydoc = new Y.Doc()
  ydoc.getText(docName).insert(0, source)
  const src = Y.encodeStateAsUpdate(ydoc)
  const out = new Uint8Array(new ArrayBuffer(src.byteLength))
  out.set(src)
  return out
}
