"use client"

import { useCallback, useMemo } from "react"
import dynamic from "next/dynamic"

import { Box, CircularProgress } from "@repo/ui/components"

import { trpc } from "@/trpc/client"
import { yjsUrl, fetchYjsToken } from "@/lib/yjs-config"
import { createUploadHandler } from "@/lib/upload-handler"

const AnyNoteEditor = dynamic(() => import("@repo/editor").then((m) => m.AnyNoteEditor), {
  ssr: false,
  loading: () => <CenteredSpinner />,
})

const Board = dynamic(() => import("@repo/excalidraw").then((m) => m.Board), {
  ssr: false,
  loading: () => <CenteredSpinner />,
})

function CenteredSpinner() {
  return (
    <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
      <CircularProgress />
    </Box>
  )
}

type PageInput = {
  id: string
  type: "TEXT" | "EXCALIDRAW" | "DATABASE" | "KANBAN" | "FORM"
}

type Props = {
  page: PageInput
  workspaceId: string
  user: { id: string; name: string; color: string }
}

export function PageRenderer({ page, workspaceId, user }: Props) {
  const attachFile = trpc.file.attachToPage.useMutation()

  const attachToPage = useCallback(
    async (fileId: string) => {
      await attachFile.mutateAsync({ pageId: page.id, fileId })
    },
    [attachFile, page.id],
  )

  const uploadHandler = useMemo(
    () => createUploadHandler({ workspaceId, attachToPage }),
    [workspaceId, attachToPage],
  )

  if (page.type === "EXCALIDRAW") {
    return (
      <Board
        pageId={page.id}
        workspaceId={workspaceId}
        yjsUrl={yjsUrl}
        yjsToken={fetchYjsToken}
        uploadHandler={uploadHandler}
        user={user}
      />
    )
  }

  if (page.type === "TEXT") {
    return (
      <AnyNoteEditor
        pageId={page.id}
        workspaceId={workspaceId}
        yjsUrl={yjsUrl}
        yjsToken={fetchYjsToken}
        user={user}
        uploadHandler={uploadHandler}
      />
    )
  }

  return (
    <Box sx={{ p: 4, color: "text.secondary" }}>
      Тип страницы &laquo;{page.type}&raquo; пока не поддерживается.
    </Box>
  )
}
