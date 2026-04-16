import type { Prisma } from "@repo/db"

type Tx = Prisma.TransactionClient

export async function seedStartPage(
  tx: Tx,
  workspaceId: string,
  userId: string,
): Promise<{ pageId: string }> {
  const page = await tx.page.create({
    data: {
      workspaceId,
      parentId: null,
      title: "Welcome to AnyNote",
      icon: "👋",
      createdById: userId,
      updatedById: userId,
    },
  })

  return { pageId: page.id }
}
