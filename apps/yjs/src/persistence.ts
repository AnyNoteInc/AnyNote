import {
  enqueueOutboxEventIgnoreConflict,
  PageType,
  Prisma,
  prisma,
} from "@repo/db"
import * as Y from "yjs"
import { TiptapTransformer } from "@hocuspocus/transformer"

import { log } from "./logger.js"

export async function loadPageDocument(pageId: string): Promise<Y.Doc> {
  const page = await prisma.page.findUnique({
    where: { id: pageId },
    select: { contentYjs: true },
  })
  const ydoc = new Y.Doc()
  if (page?.contentYjs) {
    Y.applyUpdate(ydoc, new Uint8Array(page.contentYjs))
  }
  return ydoc
}

export async function storePageDocument(args: {
  pageId: string
  workspaceId: string
  document: Y.Doc
  pageType: PageType
}): Promise<void> {
  const { pageId, workspaceId, document, pageType } = args
  const contentYjs = new Uint8Array(Y.encodeStateAsUpdate(document))

  const data: Prisma.PageUpdateInput = { contentYjs }

  if (pageType === PageType.TEXT) {
    try {
      data.content = TiptapTransformer.fromYdoc(document, "default") as Prisma.InputJsonValue
    } catch (err) {
      log.warn("tiptap transformer failed; saving contentYjs only", {
        pageId,
        error: (err as Error).message,
      })
    }
  } else if (pageType === PageType.EXCALIDRAW) {
    const yElements = document.getArray("elements")
    const snapshot = { elements: yElements.toJSON() }
    data.content = snapshot as Prisma.InputJsonValue
  }

  await prisma.$transaction(async (tx) => {
    await tx.page.update({ where: { id: pageId }, data })

    if (pageType === PageType.TEXT) {
      await enqueueOutboxEventIgnoreConflict(tx, {
        eventType: "page.upserted",
        aggregateType: "page",
        aggregateId: pageId,
        workspaceId,
        delayMs: 5 * 60 * 1000,
      })
    }
  })
}
