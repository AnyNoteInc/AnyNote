import { notFound } from "next/navigation"

import { Box } from "@repo/ui/components"

import { CookieBanner } from "@/components/workspace/cookie-banner"
import { WorkspaceAiPanel } from "@/components/workspace/workspace-ai-panel"
import { WorkspaceOnboarding } from "@/components/workspace/workspace-onboarding"
import { WorkspaceSidebar } from "@/components/workspace/workspace-sidebar"
import { WorkspaceToolbar } from "@/components/workspace/workspace-toolbar"
import { getServerTRPC } from "@/trpc/server"

function formatEditedRelative(updated: Date): string {
  const diff = Date.now() - new Date(updated).getTime()
  const minutes = Math.max(1, Math.floor(diff / 60000))
  if (minutes < 60) return `Edited ${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `Edited ${hours}h ago`
  const days = Math.floor(hours / 24)
  return `Edited ${days}d ago`
}

export default async function WorkspacePage({
  params,
}: {
  params: Promise<{ workspaceId: string }>
}) {
  const { workspaceId } = await params
  const trpc = await getServerTRPC()
  const [workspace, current] = await Promise.all([
    trpc.workspace.getById({ id: workspaceId }),
    trpc.subscription.getCurrent(),
  ])
  if (!workspace) notFound()

  return (
    <>
      <WorkspaceSidebar
        workspace={{ id: workspace.id, name: workspace.name, icon: workspace.icon }}
        planName={current.plan.name}
      />
      <Box sx={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
        <WorkspaceToolbar
          title="Welcome to AnyNote"
          editedRelative={formatEditedRelative(workspace.updatedAt)}
        />
        <WorkspaceOnboarding />
      </Box>
      <WorkspaceAiPanel />
      <CookieBanner />
    </>
  )
}
