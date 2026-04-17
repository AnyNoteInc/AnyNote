import { notFound } from "next/navigation"

import { Box } from "@repo/ui/components"

import { requireSession } from "@/lib/get-session"
import { getServerTRPC } from "@/trpc/server"
import { PageRenderer } from "@/components/page/page-renderer"
import { PageTitle } from "@/components/page/page-title"

const COLORS = ["#1976d2", "#9c27b0", "#2e7d32", "#ed6c02", "#0288d1", "#d32f2f"]

function colorFor(userId: string): string {
  let hash = 0
  for (const ch of userId) hash = (hash * 31 + ch.charCodeAt(0)) | 0
  return COLORS[Math.abs(hash) % COLORS.length]!
}

export default async function PageView({
  params,
}: {
  params: Promise<{ workspaceId: string; pageId: string }>
}) {
  const { workspaceId, pageId } = await params
  const session = await requireSession()
  const trpc = await getServerTRPC()
  const page = await trpc.page.getById({ id: pageId })
  if (!page) notFound()

  const displayName =
    [session.user.firstName, session.user.lastName].filter(Boolean).join(" ").trim() ||
    session.user.email

  const isExcalidraw = page.type === "EXCALIDRAW"

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {!isExcalidraw && (
        <Box sx={{ px: 3, py: 2, maxWidth: 713, width: "100%", mx: "auto" }}>
          <PageTitle id={page.id} initialTitle={page.title} />
        </Box>
      )}
      <Box sx={isExcalidraw ? { flex: 1, minHeight: 0 } : { flex: 1, minHeight: 0 }}>
        <PageRenderer
          page={{ id: page.id, type: page.type }}
          workspaceId={workspaceId}
          user={{ id: session.user.id, name: displayName, color: colorFor(session.user.id) }}
        />
      </Box>
    </Box>
  )
}
