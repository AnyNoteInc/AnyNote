import { BadRequestException, Inject, Injectable } from '@nestjs/common'
import type { PrismaClient } from '@repo/db'
import { Prisma } from '@repo/db'
import type { Domain } from '@repo/domain'
import * as Y from 'yjs'

import { PRISMA } from '../../../infra/db/db.providers.js'
import { DOMAIN } from '../../../infra/domain/domain.providers.js'
import { PageNotFoundError } from '../errors/mcp.errors.js'
import { buildContentYjs } from './content-yjs.js'
import { computeTargetDoc } from './yjs-content.js'
import { YjsPageEditor } from './yjs-page-editor.service.js'

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
    private readonly yjsEditor: YjsPageEditor,
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
    // Page↔workspace ownership MUST be validated BEFORE the live-doc write:
    // applyContentEdit mints an EDITOR share token for the raw pageId, so a
    // member of workspace A passing a foreign pageId with workspaceId=A would
    // otherwise vandalize B's live document before the tx guard ever fired.
    const page = await this.prisma.page.findUnique({
      where: { id: input.pageId },
      select: { id: true, workspaceId: true, type: true },
    })
    if (page?.workspaceId !== input.workspaceId) {
      throw new PageNotFoundError(input.pageId)
    }
    // Content rewrites go through the live collaborative doc first (lost-update
    // guard — see YjsPageEditor): open editors see the change instantly and the
    // yjs server persists content/contentYjs itself. Only TEXT pages have the
    // Tiptap 'default' fragment; other types/shapes keep the raw-JSON DB path.
    let contentAppliedLive = false
    if (page.type === 'TEXT' && isTiptapDoc(input.content)) {
      const live = await this.yjsEditor.applyContentEdit({
        pageId: input.pageId,
        actorUserId: input.userId,
        edit: { kind: 'replaceAll', doc: input.content },
      })
      contentAppliedLive = live.applied
    }
    await this.prisma.$transaction(async (tx) => {
      const current = await tx.page.findUnique({
        where: { id: input.pageId },
        select: { id: true, workspaceId: true },
      })
      if (current?.workspaceId !== input.workspaceId) {
        throw new PageNotFoundError(input.pageId)
      }
      if (contentAppliedLive) {
        // Live path: content/contentYjs + the indexing outbox event ride the
        // yjs server's store path (the same route user edits take) — an
        // immediate event here would index the still-old DB snapshot. Only a
        // title/icon change warrants one now: the row already carries it.
        await tx.page.update({
          where: { id: input.pageId },
          data: { title: input.title, icon: input.icon, updatedById: input.userId },
        })
        if (input.title !== undefined || input.icon !== undefined) {
          await this.enqueuePageUpserted(tx, input.pageId, input.workspaceId)
        }
        return
      }
      // The Tiptap editor loads from contentYjs, so rebuild it whenever content
      // changes — otherwise the JSON content is persisted but the editor renders
      // an empty page (createPage/appendToPage already keep these in sync).
      // tryBuildContentYjs returns undefined for non-Tiptap shapes so a malformed
      // payload still persists the raw content instead of failing the whole write.
      const contentYjs = tryBuildContentYjs(input.content)
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
      await this.enqueuePageUpserted(tx, input.pageId, input.workspaceId)
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
    await this.assertTextPage(input.pageId, input.workspaceId)
    const appendedDoc = input.appended as TiptapDoc
    // Live-doc first (lost-update guard, see YjsPageEditor); the DB path below
    // is the fallback for an unreachable/unconfigured yjs server.
    const live = await this.yjsEditor.applyContentEdit({
      pageId: input.pageId,
      actorUserId: input.userId,
      edit: { kind: 'append', doc: appendedDoc },
    })
    await this.prisma.$transaction(async (tx) => {
      const page = await tx.page.findUnique({
        where: { id: input.pageId },
        select: { id: true, workspaceId: true, type: true, content: true },
      })
      if (page?.workspaceId !== input.workspaceId) throw new PageNotFoundError(input.pageId)
      if (page.type !== 'TEXT')
        throw new BadRequestException('appendToPage supports only TEXT pages')
      if (live.applied) {
        // Content + the indexing outbox event arrive via the yjs server's
        // store path (as with user edits) — an immediate event would index
        // the still-old DB snapshot. Only stamp the actor.
        await tx.page.update({
          where: { id: input.pageId },
          data: { updatedById: input.userId },
        })
        return
      }
      const current = (page.content as TiptapDoc | null) ?? { type: 'doc', content: [] }
      // Same merge semantics as the live path (computeTargetDoc is the single
      // source of append logic — the two paths must not diverge).
      const merged = computeTargetDoc(current, { kind: 'append', doc: appendedDoc }).doc
      await tx.page.update({
        where: { id: input.pageId },
        data: { content: merged as never, contentYjs: buildContentYjs(merged), updatedById: input.userId },
      })
      await this.enqueuePageUpserted(tx, input.pageId, input.workspaceId)
    })
  }

  /** Targeted find→replace on a TEXT page (matches within single text nodes).
   *  Returns the replacement count; 0 = «не найдено», nothing written. */
  async replaceContentText(input: {
    userId: string
    workspaceId: string
    pageId: string
    find: string
    replace: string
    all: boolean
  }): Promise<{ replacements: number }> {
    await this.assertTextPage(input.pageId, input.workspaceId)
    const edit = {
      kind: 'replaceText',
      find: input.find,
      replace: input.replace,
      all: input.all,
    } as const
    const live = await this.yjsEditor.applyContentEdit({
      pageId: input.pageId,
      actorUserId: input.userId,
      edit,
    })
    if (live.applied) {
      if (live.replacements === 0) return { replacements: 0 }
      // Content + the indexing outbox event ride the yjs server's store path;
      // an immediate event would index the still-old DB snapshot.
      await this.prisma.page.update({
        where: { id: input.pageId },
        data: { updatedById: input.userId },
      })
      return { replacements: live.replacements }
    }
    // Fallback: no live doc — rewrite content + contentYjs from the snapshot.
    return this.prisma.$transaction(async (tx) => {
      const page = await tx.page.findUnique({
        where: { id: input.pageId },
        select: { id: true, workspaceId: true, type: true, content: true },
      })
      if (page?.workspaceId !== input.workspaceId) throw new PageNotFoundError(input.pageId)
      const current = (page.content as TiptapDoc | null) ?? { type: 'doc', content: [] }
      const target = computeTargetDoc(current, edit)
      if (target.replacements === 0) return { replacements: 0 }
      await tx.page.update({
        where: { id: input.pageId },
        data: {
          content: target.doc as never,
          contentYjs: buildContentYjs(target.doc),
          updatedById: input.userId,
        },
      })
      await this.enqueuePageUpserted(tx, input.pageId, input.workspaceId)
      return { replacements: target.replacements }
    })
  }

  private async assertTextPage(pageId: string, workspaceId: string): Promise<void> {
    const page = await this.prisma.page.findUnique({
      where: { id: pageId },
      select: { id: true, workspaceId: true, type: true },
    })
    if (page?.workspaceId !== workspaceId) throw new PageNotFoundError(pageId)
    if (page.type !== 'TEXT') {
      throw new BadRequestException('Content edits support only TEXT pages')
    }
  }

  private enqueuePageUpserted(
    tx: Prisma.TransactionClient,
    pageId: string,
    workspaceId: string,
  ): Promise<unknown> {
    return tx.outboxEvent.create({
      data: {
        eventType: 'page.upserted',
        aggregateType: 'page',
        aggregateId: pageId,
        workspaceId,
        payload: {},
      },
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
        data: input.archived
          ? { archivedAt: new Date(), archivedById: input.userId, updatedById: input.userId }
          : { archivedAt: null, archivedById: null, updatedById: input.userId },
      })
      await this.enqueuePageUpserted(tx, input.pageId, input.workspaceId)
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
      await this.enqueuePageUpserted(tx, page.id, input.workspaceId)
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
        data: {
          contentYjs: buildDiagramContentYjs(input.source, docName),
          updatedById: input.userId,
        },
      })
      await this.enqueuePageUpserted(tx, input.pageId, input.workspaceId)
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

/**
 * Like {@link buildContentYjs} but returns undefined instead of throwing when
 * `content` is not a Tiptap ProseMirror document (`{ type: 'doc', ... }`). The
 * agent occasionally passes a different shape (e.g. `{ markdown: '...' }`); we
 * must still persist the raw JSON content rather than fail the whole update.
 */
function tryBuildContentYjs(content: unknown): Uint8Array<ArrayBuffer> | undefined {
  if (!isTiptapDoc(content)) {
    return undefined
  }
  try {
    return buildContentYjs(content)
  } catch {
    return undefined
  }
}

function isTiptapDoc(content: unknown): content is TiptapDoc {
  return !!content && typeof content === 'object' && (content as { type?: unknown }).type === 'doc'
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
