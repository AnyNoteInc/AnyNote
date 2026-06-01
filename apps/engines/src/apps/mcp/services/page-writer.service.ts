import { BadRequestException, Inject, Injectable } from '@nestjs/common'
import { TiptapTransformer } from '@hocuspocus/transformer'
import type { PrismaClient } from '@repo/db'
import { Prisma } from '@repo/db'
import type { Domain } from '@repo/domain'
import StarterKit from '@tiptap/starter-kit'
import * as Y from 'yjs'

import { PRISMA } from '../../../infra/db/db.providers.js'
import { DOMAIN } from '../../../infra/domain/domain.providers.js'
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
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(DOMAIN) private readonly domain: Domain,
  ) {}

  async createPage(input: CreatePageInput): Promise<string> {
    // Delegate to @repo/domain so engines-created pages land in the linked list
    // (positioning gap-fix) and share the outbox path. The domain builds neither the
    // contentYjs bytes nor the Tiptap snapshot, so we still construct contentYjs here
    // (the editor loads from contentYjs) and pass both content + contentYjs through.
    const contentYjs = input.content === undefined ? undefined : buildContentYjs(input.content)
    const result = await this.domain.pages.create(input.userId, {
      workspaceId: input.workspaceId,
      parentId: input.parentId ?? null,
      title: input.title,
      type: 'TEXT',
      ownership: input.ownership ?? 'TEXT',
      content: input.content === undefined ? undefined : (input.content as Prisma.InputJsonValue),
      contentYjs,
    })
    return result.id
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
      // The Tiptap editor loads from contentYjs, so rebuild it whenever content
      // changes — otherwise the JSON content is persisted but the editor renders
      // an empty page (createPage/appendToPage already keep these in sync).
      // tryBuildContentYjs returns undefined for non-Tiptap shapes so a malformed
      // payload still persists the raw content instead of failing the whole write.
      const contentYjs = input.content === undefined ? undefined : tryBuildContentYjs(input.content)
      await tx.page.update({
        where: { id: input.pageId },
        data: {
          title: input.title,
          icon: input.icon,
          content: input.content as never,
          ...(contentYjs === undefined ? {} : { contentYjs }),
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
    // Preserve the engines cross-workspace guard + parent validation, then delegate to
    // domain.reorderPage (which matches this op's prevPageId semantics — closer to tRPC
    // reorder than move) so the agent gets BFS cycle-detection (the gap-fix).
    const page = await this.prisma.page.findUnique({
      where: { id: input.pageId },
      select: { id: true, workspaceId: true },
    })
    if (page?.workspaceId !== input.workspaceId) {
      throw new PageNotFoundError(input.pageId)
    }
    if (input.newParentId) {
      const parent = await this.prisma.page.findUnique({
        where: { id: input.newParentId },
        select: { workspaceId: true, deletedAt: true },
      })
      if (!parent || parent.workspaceId !== input.workspaceId || parent.deletedAt) {
        throw new PageNotFoundError(input.newParentId)
      }
    }
    await this.domain.pages.reorder(input.userId, {
      pageId: input.pageId,
      newParentId: input.newParentId ?? null,
      newPrevPageId: input.prevPageId ?? null,
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

/**
 * Like {@link buildContentYjs} but returns undefined instead of throwing when
 * `content` is not a Tiptap ProseMirror document (`{ type: 'doc', ... }`). The
 * agent occasionally passes a different shape (e.g. `{ markdown: '...' }`); we
 * must still persist the raw JSON content rather than fail the whole update.
 */
function tryBuildContentYjs(content: unknown): Uint8Array<ArrayBuffer> | undefined {
  if (!content || typeof content !== 'object' || (content as { type?: unknown }).type !== 'doc') {
    return undefined
  }
  try {
    return buildContentYjs(content)
  } catch {
    return undefined
  }
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
