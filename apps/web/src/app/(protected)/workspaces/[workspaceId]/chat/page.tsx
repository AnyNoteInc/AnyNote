import { notFound, redirect } from "next/navigation"

import { getSession } from "@/lib/get-session"
import { prisma } from "@repo/db"
import { getServerTRPC } from "@/trpc/server"

type Props = { params: Promise<{ workspaceId: string }> }

export default async function WorkspaceChatLandingPage({ params }: Props) {
  const { workspaceId } = await params
  const session = await getSession()
  if (!session) notFound()
  const trpc = await getServerTRPC()
  const workspace = await trpc.workspace.getById({ id: workspaceId })
  if (!workspace) notFound()

  const chat = await prisma.chat.create({
    data: {
      workspaceId,
      createdById: session.user.id,
    },
    select: { id: true },
  })

  redirect(`/workspaces/${workspaceId}/chat/${chat.id}`)
}
