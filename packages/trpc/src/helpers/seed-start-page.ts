import { Prisma } from "@repo/db"
import type { Block } from "@repo/db"

type Tx = Prisma.TransactionClient

type SeedBlock =
  | { type: "TO_DO"; text: string; checked?: boolean }
  | { type: "TOGGLE"; text: string }

const START_BLOCKS: SeedBlock[] = [
  { type: "TO_DO", text: "Create your first page", checked: true },
  { type: "TO_DO", text: "Pick a workspace icon", checked: true },
  { type: "TO_DO", text: "Try a slash command — type /heading on a blank line" },
  { type: "TO_DO", text: "Import notes from Notion or Obsidian" },
  { type: "TO_DO", text: "Upload a file or image with drag-and-drop" },
  { type: "TO_DO", text: "Connect an integration (GitHub, Telegram, AmoCRM)" },
  { type: "TOGGLE", text: "Advanced: databases, views, filters" },
  { type: "TO_DO", text: "Share a page with a public link" },
  { type: "TO_DO", text: "Ask AI about your docs — /ask" },
  { type: "TO_DO", text: "Invite a teammate" },
]

export async function seedStartPage(
  tx: Tx,
  workspaceId: string,
  userId: string,
): Promise<{ pageId: string }> {
  const page = await tx.page.create({
    data: {
      workspaceId,
      parentType: "WORKSPACE",
      parentId: workspaceId,
      title: "Welcome to AnyNote",
      icon: "👋",
      createdById: userId,
      updatedById: userId,
    },
  })

  let prevId: string | null = null
  for (const item of START_BLOCKS) {
    const content: Prisma.InputJsonValue =
      item.type === "TO_DO"
        ? { text: item.text, checked: item.checked ?? false }
        : { text: item.text }

    const block: Block = await tx.block.create({
      data: {
        pageId: page.id,
        prevBlockId: prevId,
        type: item.type,
        content,
        createdById: userId,
      },
    })
    prevId = block.id
  }

  return { pageId: page.id }
}
