'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'

import type { PageType } from '@repo/db'
import {
  BlockMoveDialog,
  moveBlockToPage,
  scrollToBlockIndex,
  type Editor,
  type MoveBlockResult,
  type PageLookupItem,
} from '@repo/editor'
import { Box, CircularProgress } from '@repo/ui/components'

import { trpc } from '@/trpc/client'
import { resolveYjsUrl, fetchYjsToken } from '@/lib/yjs-config'
import { resolveDrawioUrl } from '@/lib/drawio-config'
import { createUploadHandler } from '@/lib/upload-handler'
import {
  PAGE_TREE_ROOT,
  PageTreePicker,
  type PageTreeSelection,
} from '@/components/workspace/page-tree-picker'

import { useOutlineMode } from '@/hooks/use-outline-mode'

import { usePageEditor } from './editor-context'
import { EditorContentSkeleton } from './editor-content-skeleton'
import { EditorOutline } from './editor-outline'
import { ReminderPopover, type ReminderFormValue } from './reminder-popover'
import { useReminderSync } from './use-reminder-sync'
import { useWorkspaceMentionSearch } from './comments/use-mention-search'
import { usePageCommentsContext } from './comments/comments-context'
import { CommentPopover } from './comments/comment-popover'
import { COMMENTS_SIDEBAR_WIDTH } from './comments/comments-sidebar'

const AnyNoteEditor = dynamic(() => import('@repo/editor').then((m) => m.AnyNoteEditor), {
  ssr: false,
  loading: () => <EditorContentSkeleton />,
})

const Board = dynamic(() => import('@repo/excalidraw').then((m) => m.Board), {
  ssr: false,
  loading: () => <CenteredSpinner />,
})

const Genogram = dynamic(() => import('@repo/genogram').then((m) => m.GenogramBoard), {
  ssr: false,
  loading: () => <CenteredSpinner />,
})

const MermaidBoard = dynamic(() => import('@repo/mermaid').then((m) => m.MermaidBoard), {
  ssr: false,
  loading: () => <CenteredSpinner />,
})

const PlantumlBoard = dynamic(() => import('@repo/plantuml').then((m) => m.PlantumlBoard), {
  ssr: false,
  loading: () => <CenteredSpinner />,
})

const Likec4Board = dynamic(() => import('@repo/likec4').then((m) => m.Likec4Board), {
  ssr: false,
  loading: () => <CenteredSpinner />,
})

const DrawioBoard = dynamic(() => import('@repo/drawio').then((m) => m.DrawioBoard), {
  ssr: false,
  loading: () => <CenteredSpinner />,
})

const KanbanBoardPage = dynamic(
  () => import('@/components/kanban/kanban-board-page').then((m) => m.KanbanBoardPage),
  { ssr: false, loading: () => <CenteredSpinner /> },
)

function CenteredSpinner() {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
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
  yjsToken?: () => Promise<string>
  editable?: boolean
  renderAuth?: { shareId: string }
}

export function PageRenderer({
  page,
  workspaceId,
  user,
  yjsToken,
  editable = true,
  renderAuth,
}: Props) {
  const router = useRouter()
  // Share routes inject a share-scoped token; in-app callers use the default.
  const token = yjsToken ?? fetchYjsToken
  const attachFile = trpc.file.attachToPage.useMutation()
  const attachFileRef = useRef(attachFile)
  attachFileRef.current = attachFile

  const trpcUtils = trpc.useUtils()
  const pageEditor = usePageEditor()
  const { anchors, canComment, startNewThread, openThreadPopover, activeAnchor, panelOpen } =
    usePageCommentsContext()
  const pagesQuery = trpc.page.listByWorkspace.useQuery({ workspaceId })
  const editorRef = useRef<Editor | null>(null)
  const [outlineMode] = useOutlineMode(page.id)

  const [editor, setEditor] = useState<Editor | null>(null)
  const [movePos, setMovePos] = useState<number | null>(null)
  const [moveTarget, setMoveTarget] = useState<PageTreeSelection | null>(null)
  const [moveBusy, setMoveBusy] = useState(false)
  const [moveError, setMoveError] = useState<string | null>(null)

  const [reminderUI, setReminderUI] = useState<
    | { open: false }
    | {
        open: true
        mode: 'create' | 'edit'
        anchorEl: HTMLElement | null
        initial: ReminderFormValue
      }
  >({ open: false })

  const findReminderNode = useCallback(
    (id: string): { attrs: ReminderFormValue; pos: number } | null => {
      if (!editor) return null
      let found: { attrs: ReminderFormValue; pos: number } | null = null
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === 'reminder' && node.attrs.id === id) {
          found = {
            attrs: {
              id: node.attrs.id,
              dueAt: node.attrs.dueAt || null,
              offsets: node.attrs.offsets ?? [],
              audience: node.attrs.audience ?? 'ME',
              label: node.attrs.label ?? null,
              recipients: node.attrs.recipients ?? [],
              doneAt: node.attrs.doneAt ?? null,
            },
            pos,
          }
          return false
        }
        return true
      })
      return found
    },
    [editor],
  )

  const handleReminderCreate = useCallback(
    (id: string) => {
      setTimeout(() => {
        const anchor = document.querySelector(`[data-id="reminder-${id}"]`) as HTMLElement | null
        const found = findReminderNode(id)
        if (!found) return
        setReminderUI({ open: true, mode: 'create', anchorEl: anchor, initial: found.attrs })
      }, 0)
    },
    [findReminderNode],
  )

  const handleReminderClick = useCallback(
    (id: string, anchor: HTMLElement) => {
      const found = findReminderNode(id)
      if (!found) return
      setReminderUI({ open: true, mode: 'edit', anchorEl: anchor, initial: found.attrs })
    },
    [findReminderNode],
  )

  const saveReminder = useCallback(
    (value: ReminderFormValue) => {
      if (!editor) return
      let pos: number | null = null
      editor.state.doc.descendants((node, p) => {
        if (node.type.name === 'reminder' && node.attrs.id === value.id) {
          pos = p
          return false
        }
        return true
      })
      if (pos === null) return
      editor
        .chain()
        .focus()
        .setNodeSelection(pos)
        .updateAttributes('reminder', {
          dueAt: value.dueAt ?? '',
          offsets: value.offsets,
          audience: value.audience,
          label: value.label,
          recipients: value.recipients,
          doneAt: value.doneAt,
        })
        .run()
    },
    [editor],
  )

  const deleteReminder = useCallback(
    (id: string) => {
      if (!editor) return
      let pos: number | null = null
      let size = 0
      editor.state.doc.descendants((node, p) => {
        if (node.type.name === 'reminder' && node.attrs.id === id) {
          pos = p
          size = node.nodeSize
          return false
        }
        return true
      })
      if (pos === null) return
      editor
        .chain()
        .focus()
        .deleteRange({ from: pos, to: pos + size })
        .run()
    },
    [editor],
  )

  useReminderSync(editor, page.id)

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
        .filter((p) => p.id !== page.id && (!q || (p.title ?? '').toLowerCase().includes(q)))
        .slice(0, 20)
        .map((p) => ({ id: p.id, title: p.title ?? '', icon: p.icon ?? null }))
    },
    [page.id, trpcUtils, workspaceId],
  )

  const mentionSearch = useWorkspaceMentionSearch(workspaceId)

  const onNavigateToPage = useCallback(
    (pageId: string) => {
      router.push(`/workspaces/${workspaceId}/pages/${pageId}`)
    },
    [router, workspaceId],
  )

  const handleEditorReady = useCallback(
    (e: Editor) => {
      editorRef.current = e
      pageEditor.setEditor(e)
      setEditor(e)
    },
    [pageEditor],
  )

  useEffect(() => {
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
    window.addEventListener('hashchange', apply)
    return () => {
      cancelled = true
      if (timer) window.clearTimeout(timer)
      window.removeEventListener('hashchange', apply)
    }
  }, [editor])

  useEffect(() => {
    if (!editor) return
    const hash = typeof window !== 'undefined' ? window.location.hash : ''
    const match = /^#reminder-([0-9a-f-]{36})$/i.exec(hash)
    if (!match) return
    const id = match[1]
    const t = setTimeout(() => {
      const el = document.querySelector(`[data-id="reminder-${id}"]`) as HTMLElement | null
      if (!el) return
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el.classList.add('reminder-flash')
      setTimeout(() => el.classList.remove('reminder-flash'), 2000)
    }, 200)
    return () => clearTimeout(t)
  }, [editor])

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
      setMoveError('Редактор не готов')
      return
    }
    if (moveTarget === PAGE_TREE_ROOT) {
      setMoveError('Блок можно переместить только в страницу')
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
        yjsUrl: resolveYjsUrl(),
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

  if (page.type === 'EXCALIDRAW') {
    return (
      <Board
        pageId={page.id}
        initialContentYjs={page.contentYjs}
        yjsUrl={resolveYjsUrl()}
        yjsToken={token}
        uploadHandler={uploadHandler}
        user={user}
        editable={editable}
      />
    )
  }

  if (page.type === 'GENOGRAM') {
    return (
      <Genogram
        pageId={page.id}
        yjsUrl={resolveYjsUrl()}
        yjsToken={token}
        user={user}
        mode={editable ? 'editor' : 'readonly'}
      />
    )
  }

  if (page.type === 'MERMAID') {
    return (
      <MermaidBoard
        pageId={page.id}
        initialContentYjs={page.contentYjs}
        yjsUrl={resolveYjsUrl()}
        yjsToken={token}
        user={user}
        editable={editable}
      />
    )
  }

  if (page.type === 'PLANTUML') {
    return (
      <PlantumlBoard
        pageId={page.id}
        initialContentYjs={page.contentYjs}
        yjsUrl={resolveYjsUrl()}
        yjsToken={token}
        user={user}
        editable={editable}
        renderAuth={renderAuth}
      />
    )
  }

  if (page.type === 'LIKEC4') {
    return (
      <Likec4Board
        pageId={page.id}
        initialContentYjs={page.contentYjs}
        yjsUrl={resolveYjsUrl()}
        yjsToken={token}
        user={user}
        editable={editable}
      />
    )
  }

  if (page.type === 'DRAWIO') {
    return (
      <DrawioBoard
        pageId={page.id}
        initialContentYjs={page.contentYjs}
        yjsUrl={resolveYjsUrl()}
        yjsToken={token}
        user={user}
        editable={editable}
        drawioUrl={resolveDrawioUrl()}
      />
    )
  }

  if (page.type === 'KANBAN') {
    return <KanbanBoardPage pageId={page.id} editable={editable} />
  }

  if (page.type === 'TEXT') {
    return (
      <Box sx={{ height: '100%', minHeight: 0, position: 'relative' }}>
        <AnyNoteEditor
          pageId={page.id}
          workspaceId={workspaceId}
          initialContentYjs={page.contentYjs}
          yjsUrl={resolveYjsUrl()}
          yjsToken={token}
          editable={editable}
          user={user}
          uploadHandler={uploadHandler}
          pageSearch={pageSearch}
          mentionSearch={mentionSearch}
          onNavigateToPage={onNavigateToPage}
          drawioUrl={resolveDrawioUrl()}
          onReady={handleEditorReady}
          onRequestBlockMove={handleRequestBlockMove}
          onReminderCreate={handleReminderCreate}
          onReminderClick={handleReminderClick}
          commentThreads={anchors}
          canComment={canComment}
          plantumlRenderAuth={renderAuth}
          onCreateComment={startNewThread}
          onOpenThread={openThreadPopover}
          activeCommentAnchor={activeAnchor}
          loadingFallback={<EditorContentSkeleton />}
        />
        <CommentPopover />
        {reminderUI.open && (
          <ReminderPopover
            open
            anchorEl={reminderUI.anchorEl}
            mode={reminderUI.mode}
            initial={reminderUI.initial}
            workspaceId={workspaceId}
            onClose={() => setReminderUI({ open: false })}
            onSave={saveReminder}
            onDelete={() => deleteReminder(reminderUI.initial.id)}
          />
        )}
        <EditorOutline
          editor={editor}
          mode={outlineMode}
          rightOffset={panelOpen ? COMMENTS_SIDEBAR_WIDTH : 0}
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
                <Box sx={{ color: 'error.main', mt: 1, fontSize: 13, px: 1 }}>{moveError}</Box>
              ) : null}
            </>
          }
        />
      </Box>
    )
  }

  return (
    <Box sx={{ p: 4, color: 'text.secondary' }}>
      Тип страницы &laquo;{page.type}&raquo; пока не поддерживается.
    </Box>
  )
}
