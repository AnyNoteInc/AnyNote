import type { Prisma } from "@repo/db"

import { buildWelcomePageContent } from "./welcome-page-content"

type Tx = Prisma.TransactionClient

export async function seedStartPage(
  tx: Tx,
  workspaceId: string,
  userId: string,
): Promise<{ pageId: string }> {
  const { content, contentYjs } = buildWelcomePageContent()

  const page = await tx.page.create({
    data: {
      workspaceId,
      parentId: null,
      title: "Добро пожаловать в AnyNote",
      icon: "👋",
      content: content as Prisma.InputJsonValue,
      contentYjs,
      createdById: userId,
      updatedById: userId,
    },
  })

  return { pageId: page.id }
}
