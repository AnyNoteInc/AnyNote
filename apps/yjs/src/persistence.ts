import {
  enqueueOutboxEventIgnoreConflict,
  PageRevisionAction,
  PageType,
  Prisma,
  prisma,
} from '@repo/db'
import * as Y from 'yjs'
import { TiptapTransformer } from '@hocuspocus/transformer'

import { log } from './logger.js'

/**
 * Minimum interval between captured content revisions for a page. Mirrors the
 * domain `HISTORY_MIN_INTERVAL_MS` cadence (≈10 min). Defined locally because
 * apps/yjs runs in its own process with no `@repo/domain` access — it writes
 * revisions directly via its Prisma client. The Yjs hook has no reliable
 * actorId, so the throttle is purely time-since-last-revision-for-the-page.
 */
const HISTORY_MIN_INTERVAL_MS = 10 * 60 * 1000

/**
 * Capture a throttled content revision (action EDIT) for a page inside the
 * page-update transaction. Skips the write when the page's latest revision is
 * younger than {@link HISTORY_MIN_INTERVAL_MS} (time-only throttle — no actorId
 * is available in the collaborative save path).
 */
async function capturePageRevisionTx(
  tx: Prisma.TransactionClient,
  args: {
    pageId: string
    content: Prisma.InputJsonValue | undefined
    contentYjs: Uint8Array
    metadata: Prisma.InputJsonValue
  },
): Promise<void> {
  const latest = await tx.pageRevision.findFirst({
    where: { pageId: args.pageId },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  })
  if (latest && Date.now() - latest.createdAt.getTime() < HISTORY_MIN_INTERVAL_MS) {
    return
  }
  await tx.pageRevision.create({
    data: {
      pageId: args.pageId,
      actorId: null,
      action: PageRevisionAction.EDIT,
      ...(args.content === undefined ? {} : { content: args.content }),
      contentYjs: args.contentYjs as Uint8Array<ArrayBuffer>,
      metadata: args.metadata,
    },
  })
}

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
      data.content = TiptapTransformer.fromYdoc(document, 'default') as Prisma.InputJsonValue
    } catch (err) {
      log.warn('tiptap transformer failed; saving contentYjs only', {
        pageId,
        error: (err as Error).message,
      })
    }
  } else if (pageType === PageType.EXCALIDRAW) {
    const yElements = document.getArray('elements')
    const snapshot = { elements: yElements.toJSON() }
    data.content = snapshot as Prisma.InputJsonValue
  } else if (pageType === PageType.MERMAID) {
    data.content = { source: document.getText('mermaid').toString() } as Prisma.InputJsonValue
  }

  await prisma.$transaction(async (tx) => {
    await tx.page.update({ where: { id: pageId }, data })

    // Capture a throttled content revision (page-history). The hook only fires
    // on real content saves, so this is the content-capture site (the domain
    // page service captures structural revisions).
    await capturePageRevisionTx(tx, {
      pageId,
      content: data.content as Prisma.InputJsonValue | undefined,
      contentYjs,
      metadata: { type: pageType, workspaceId } as Prisma.InputJsonValue,
    })

    if (pageType === PageType.TEXT) {
      await enqueueOutboxEventIgnoreConflict(tx, {
        eventType: 'page.upserted',
        aggregateType: 'page',
        aggregateId: pageId,
        workspaceId,
        delayMs: 5 * 60 * 1000,
      })
    }
  })
}
