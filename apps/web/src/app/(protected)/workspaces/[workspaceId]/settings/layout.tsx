import type { ReactNode } from "react"

import { notFound } from "next/navigation"
import { Box, Container, Paper } from "@repo/ui/components"

import { getWorkspaceFeatures } from "@repo/trpc"

import { WorkspaceSettingsNav } from "@/components/workspace/workspace-settings-nav"
import { getServerTRPC } from "@/trpc/server"

type Props = {
  children: ReactNode
  params: Promise<{ workspaceId: string }>
}

export default async function WorkspaceSettingsLayout({ children, params }: Props) {
  const { workspaceId } = await params
  const trpc = await getServerTRPC()
  const [workspace, features] = await Promise.all([
    trpc.workspace.getById({ id: workspaceId }),
    getWorkspaceFeatures(workspaceId),
  ])
  if (!workspace) notFound()

  return (
    <Container maxWidth="lg" sx={{ py: { xs: 3, md: 5 } }}>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", md: "220px minmax(0,1fr)" },
          gap: { xs: 3, md: 4 },
        }}
      >
        <Paper variant="outlined" sx={{ p: 2, alignSelf: "start" }}>
          <WorkspaceSettingsNav workspaceId={workspaceId} features={features} />
        </Paper>
        <Box>{children}</Box>
      </Box>
    </Container>
  )
}
