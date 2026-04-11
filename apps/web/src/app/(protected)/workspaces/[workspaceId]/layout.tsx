import { notFound } from "next/navigation"
import type { ReactNode } from "react"

import { WorkspaceShell } from "@/components/workspace/workspace-shell"
import { getServerTRPC } from "@/trpc/server"

export default async function WorkspaceLayout({
  params,
  children,
}: {
  params: Promise<{ workspaceId: string }>
  children: ReactNode
}) {
  const { workspaceId } = await params
  const trpc = await getServerTRPC()
  const workspace = await trpc.workspace.getById({ id: workspaceId })
  if (!workspace) notFound()

  return <WorkspaceShell>{children}</WorkspaceShell>
}
