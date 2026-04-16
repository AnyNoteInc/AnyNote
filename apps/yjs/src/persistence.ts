import { prisma, PageType, Prisma } from "@repo/db"
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
  document: Y.Doc
  pageType: PageType
}): Promise<void> {
  const { pageId, document, pageType } = args
  const update = Y.encodeStateAsUpdate(document)
  // Copy into a fresh ArrayBuffer-backed view so the type matches Prisma's
  // `Uint8Array<ArrayBuffer>` expectation (`encodeStateAsUpdate` returns
  // `Uint8Array<ArrayBufferLike>`, which could be a SharedArrayBuffer).
  const contentYjs = new Uint8Array(update.length)
  contentYjs.set(update)

  const data: Prisma.PageUpdateInput = { contentYjs }
  if (pageType !== PageType.EXCALIDRAW) {
    try {
      data.content = TiptapTransformer.fromYdoc(document, "default") as Prisma.InputJsonValue
    } catch (err) {
      log.warn("tiptap transformer failed; saving contentYjs only", {
        pageId,
        error: (err as Error).message,
      })
    }
  }

  await prisma.page.update({
    where: { id: pageId },
    data,
  })
}
