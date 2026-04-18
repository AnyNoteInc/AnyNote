"use client"

import { useCallback, useMemo, useRef } from "react"
import dynamic from "next/dynamic"
import { useRouter } from "next/navigation"

import type { PageType } from "@repo/db"
import type { PageLookupItem } from "@repo/editor"
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
  type: PageType
}

type Props = {
  page: PageInput
  workspaceId: string
  user: { id: string; name: string; color: string }
}

export function PageRenderer({ page, workspaceId, user }: Props) {
  const router = useRouter()
  const attachFile = trpc.file.attachToPage.useMutation()
  const attachFileRef = useRef(attachFile)
  attachFileRef.current = attachFile

  const trpcUtils = trpc.useUtils()

  const attachToPage = useCallback(
    async (fileId: string) => {
      await attachFileRef.current.mutateAsync({ pageId: page.id, fileId })
    },
    [page.id],
  )

  const uploadHandler = useMemo(
    () => createUploadHandler({ workspaceId, attachToPage }),
    [workspaceId, attachToPage],
  )

  const pageSearch = useCallback(
    async (query: string): Promise<PageLookupItem[]> => {
      const pages = await trpcUtils.page.listByWorkspace.ensureData({ workspaceId })
      const q = query.trim().toLowerCase()
      return pages
        .filter((p) => p.id !== page.id && (!q || (p.title ?? "").toLowerCase().includes(q)))
        .slice(0, 20)
        .map((p) => ({ id: p.id, title: p.title ?? "", icon: p.icon ?? null }))
    },
    [page.id, trpcUtils, workspaceId],
  )

  const onNavigateToPage = useCallback(
    (pageId: string) => {
      router.push(`/workspaces/${workspaceId}/pages/${pageId}`)
    },
    [router, workspaceId],
  )

  if (page.type === "EXCALIDRAW") {
    return (
      <Board
        pageId={page.id}
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
        pageSearch={pageSearch}
        onNavigateToPage={onNavigateToPage}
      />
    )
  }

  return (
    <Box sx={{ p: 4, color: "text.secondary" }}>
      Тип страницы &laquo;{page.type}&raquo; пока не поддерживается.
    </Box>
  )
}
