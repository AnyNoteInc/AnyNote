"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import dynamic from "next/dynamic"
import { useRouter } from "next/navigation"

import type { PageType } from "@repo/db"
import {
  BlockMoveDialog,
  moveBlockToPage,
  scrollToBlockIndex,
  type Editor,
  type MoveBlockResult,
  type PageLookupItem,
} from "@repo/editor"
import { Box, CircularProgress } from "@repo/ui/components"

import { trpc } from "@/trpc/client"
import { yjsUrl, fetchYjsToken } from "@/lib/yjs-config"
import { createUploadHandler } from "@/lib/upload-handler"
import {
  PAGE_TREE_ROOT,
  PageTreePicker,
  type PageTreeSelection,
} from "@/components/workspace/page-tree-picker"

import { usePageEditor } from "./editor-context"
import { EditorContentSkeleton } from "./editor-content-skeleton"

const AnyNoteEditor = dynamic(() => import("@repo/editor").then((m) => m.AnyNoteEditor), {
  ssr: false,
  loading: () => <EditorContentSkeleton />,
})

const Board = dynamic(() => import("@repo/excalidraw").then((m) => m.Board), {
  ssr: false,
  loading: () => <CenteredSpinner />,
})

const Genogram = dynamic(
  () => import("@repo/genogram").then((m) => m.GenogramBoard),
  { ssr: false, loading: () => <CenteredSpinner /> },
)

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
  contentYjs: string | null
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
  const pageEditor = usePageEditor()
  const pagesQuery = trpc.page.listByWorkspace.useQuery({ workspaceId })
  const editorRef = useRef<Editor | null>(null)

  const [editorReady, setEditorReady] = useState(false)
  const [movePos, setMovePos] = useState<number | null>(null)
  const [moveTarget, setMoveTarget] = useState<PageTreeSelection | null>(null)
  const [moveBusy, setMoveBusy] = useState(false)
  const [moveError, setMoveError] = useState<string | null>(null)

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

  const handleEditorReady = useCallback(
    (editor: Editor) => {
      editorRef.current = editor
      pageEditor.setEditor(editor)
      setEditorReady(true)
    },
    [pageEditor],
  )

  useEffect(() => {
    if (!editorReady) return
    const editor = editorRef.current
    if (!editor) return

    let timer: number | null = null
    let cancelled = false

    const apply = () => {
      const hash = window.location.hash.slice(1)
      if (!hash) return
      const index = Number.parseInt(hash, 10)
      if (Number.isNaN(index)) return
      let attempts = 0
      const tryScroll = () => {
        if (cancelled) return
        if (scrollToBlockIndex(editor, index)) return
        if (++attempts < 10) {
          timer = window.setTimeout(tryScroll, 150)
        }
      }
      tryScroll()
    }

    apply()
    window.addEventListener("hashchange", apply)
    return () => {
      cancelled = true
      if (timer) window.clearTimeout(timer)
      window.removeEventListener("hashchange", apply)
    }
  }, [editorReady])

  const handleRequestBlockMove = useCallback((pos: number) => {
    setMovePos(pos)
    setMoveTarget(null)
    setMoveError(null)
  }, [])

  const handleCloseMove = useCallback(() => {
    if (moveBusy) return
    setMovePos(null)
    setMoveTarget(null)
  }, [moveBusy])

  const handleConfirmMove = useCallback(async () => {
    if (movePos == null || moveTarget == null) return
    const editor = editorRef.current
    if (!editor) {
      setMoveError("Редактор не готов")
      return
    }
    if (moveTarget === PAGE_TREE_ROOT) {
      setMoveError("Блок можно переместить только в страницу")
      return
    }

    setMoveBusy(true)
    setMoveError(null)
    try {
      const token = await fetchYjsToken()
      const result: MoveBlockResult = await moveBlockToPage({
        editor,
        sourcePos: movePos,
        targetPageId: moveTarget,
        yjsUrl,
        token,
      })
      if (result.ok) {
        setMovePos(null)
        setMoveTarget(null)
        router.push(`/workspaces/${workspaceId}/pages/${moveTarget}`)
      } else {
        setMoveError(result.error)
      }
    } catch (err) {
      setMoveError(err instanceof Error ? err.message : String(err))
    } finally {
      setMoveBusy(false)
    }
  }, [movePos, moveTarget, router, workspaceId])

  if (page.type === "EXCALIDRAW") {
    return (
      <Board
        pageId={page.id}
        initialContentYjs={page.contentYjs}
        yjsUrl={yjsUrl}
        yjsToken={fetchYjsToken}
        uploadHandler={uploadHandler}
        user={user}
      />
    )
  }

  if (page.type === "GENOGRAM") {
    return (
      <Genogram
        pageId={page.id}
        yjsUrl={yjsUrl}
        yjsToken={fetchYjsToken}
        user={user}
      />
    )
  }

  if (page.type === "TEXT") {
    return (
      <>
        <AnyNoteEditor
          pageId={page.id}
          workspaceId={workspaceId}
          initialContentYjs={page.contentYjs}
          yjsUrl={yjsUrl}
          yjsToken={fetchYjsToken}
          user={user}
          uploadHandler={uploadHandler}
          pageSearch={pageSearch}
          onNavigateToPage={onNavigateToPage}
          onReady={handleEditorReady}
          onRequestBlockMove={handleRequestBlockMove}
          loadingFallback={<EditorContentSkeleton />}
        />
        <BlockMoveDialog
          open={movePos != null}
          onClose={handleCloseMove}
          onConfirm={handleConfirmMove}
          busy={moveBusy}
          canConfirm={moveTarget != null && moveTarget !== PAGE_TREE_ROOT}
          treePicker={
            <>
              <PageTreePicker
                pages={pagesQuery.data ?? []}
                excludeIds={new Set([page.id])}
                onSelect={setMoveTarget}
                selectedId={moveTarget}
                showRoot={false}
              />
              {moveError ? (
                <Box sx={{ color: "error.main", mt: 1, fontSize: 13, px: 1 }}>{moveError}</Box>
              ) : null}
            </>
          }
        />
      </>
    )
  }

  return (
    <Box sx={{ p: 4, color: "text.secondary" }}>
      Тип страницы &laquo;{page.type}&raquo; пока не поддерживается.
    </Box>
  )
}
