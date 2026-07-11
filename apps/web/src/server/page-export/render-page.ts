import type { PrismaClient } from '@repo/db'
import type { StorageClient } from '@repo/storage'

import { embedImagesAndRewriteLinks } from '@repo/page-export'
import { tiptapJsonToHtml } from './tiptap-to-html'

export async function renderPageBodyHtml(
  page: { content: unknown },
  ctx: {
    prisma: Pick<PrismaClient, 'file'>
    storage: Pick<StorageClient, 'get'>
    baseUrl: string
    workspaceId: string
  },
): Promise<string> {
  const raw = tiptapJsonToHtml(page.content)
  if (raw.length === 0) return ''
  return embedImagesAndRewriteLinks(raw, ctx)
}
