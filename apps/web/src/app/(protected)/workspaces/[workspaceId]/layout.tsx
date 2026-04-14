import type { ReactNode } from "react"

import { notFound } from "next/navigation"

import { requireSession } from "@/lib/get-session"
import { getServerTRPC } from "@/trpc/server"
import { WorkspaceLayoutClient } from "@/components/workspace/workspace-layout-client"

type Props = {
  children: ReactNode
  params: Promise<{ workspaceId: string }>
}

export default async function WorkspaceLayout({ children, params }: Props) {
  const { workspaceId } = await params
  const session = await requireSession()
  const trpc = await getServerTRPC()
  const workspace = await trpc.workspace.getById({ id: workspaceId })
  if (!workspace) notFound()
  const pages = await trpc.page.listByWorkspace({ workspaceId })
  const { plan } = await trpc.subscription.getCurrent()

  return (
    <WorkspaceLayoutClient
      workspace={{ id: workspace.id, name: workspace.name, icon: workspace.icon }}
      planName={plan.name}
      pages={pages}
      user={{
        id: session.user.id,
        firstName: session.user.firstName,
        lastName: session.user.lastName,
        email: session.user.email,
        image: session.user.image ?? null,
      }}
    >
      {children}
    </WorkspaceLayoutClient>
  )
}
