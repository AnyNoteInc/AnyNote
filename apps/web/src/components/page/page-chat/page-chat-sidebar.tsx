'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

import { htmlToMarkdown } from '@repo/editor/lib/html-to-markdown'
import { markdownToHtml } from '@repo/editor/lib/markdown-to-html'
import {
  AddRoundedIcon,
  Box,
  Button,
  CircularProgress,
  Collapse,
  DeleteIcon,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  DriveFileRenameOutlineIcon,
  Grow,
  IconButton,
  KeyboardDoubleArrowRightIcon,
  Menu,
  MenuItem,
  MoreVertIcon,
  Paper,
  PictureInPictureAltIcon,
  RemoveIcon,
  Select,
  Stack,
  TextField,
  Tooltip,
  Typography,
  useTheme,
  ViewSidebarRoundedIcon,
} from '@repo/ui/components'

import { usePageEditor } from '@/components/page/editor-context'
import { usePlanFeaturesOptional } from '@/components/workspace/plan-features-context'
import { PanelResizeHandle } from '@/components/workspace/panel-resize-handle'
import { WorkspaceChatClient } from '@/components/workspace/chat/workspace-chat-client'
import { trpc } from '@/trpc/client'

import {
  PAGE_CHAT_CONTEXT_LABEL,
  PAGE_CHAT_SIDEBAR_MAX_WIDTH,
  PAGE_CHAT_SIDEBAR_MIN_WIDTH,
  usePageChatContext,
} from './page-chat-context'

type Props = {
  workspaceId: string
  pageId: string
}

export function PageChatSidebar({ workspaceId, pageId }: Props) {
  const ctx = usePageChatContext()
  const features = usePlanFeaturesOptional()
  const { getEditor, hasEditor } = usePageEditor()
  const theme = useTheme()
  const [hasSelection, setHasSelection] = useState(false)

  // The mounted chat instance is frozen per "epoch": explicit thread switches
  // (Select / «Новый чат») bump the epoch → remount + hydration below, while a
  // lazy first-send creation only updates ctx.activeChatId (the Select value) —
  // the streaming instance stays mounted with its chatId prop still null (it
  // tracks the created id internally), so the optimistic pair survives.
  const [mountEpoch, setMountEpoch] = useState(0)
  const [mountChatId, setMountChatId] = useState<string | null>(null)

  // Overflow menu (rename/delete) acting on the ACTIVE thread of the Select.
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [deleteOpen, setDeleteOpen] = useState(false)
  // Display-mode menu (docked / floating), spec §2.
  const [modeMenuAnchor, setModeMenuAnchor] = useState<HTMLElement | null>(null)

  // Render-time reset on page navigation (comments-context pattern): the
  // provider resets activeChatId/panelOpen itself; the local mount state must
  // follow or the next page would hydrate the previous page's thread.
  const [prevPageId, setPrevPageId] = useState(pageId)
  if (pageId !== prevPageId) {
    setPrevPageId(pageId)
    setMountChatId(null)
    setMountEpoch((e) => e + 1)
    setHasSelection(false)
    setMenuAnchor(null)
    setRenameOpen(false)
    setDeleteOpen(false)
    setModeMenuAnchor(null)
  }

  const chatsEnabled = features?.chatsEnabled ?? false
  const open = Boolean(ctx?.enabled && ctx.panelOpen)
  const activeChatId = ctx?.activeChatId ?? null

  const list = trpc.chat.listByPage.useQuery(
    { workspaceId, pageId },
    { enabled: open && chatsEnabled },
  )
  // Hydrates ONLY explicit switches to an existing thread; a first-send
  // creation never flips mountChatId, so it never gates the live instance.
  const chatQuery = trpc.chat.getChat.useQuery(
    { chatId: mountChatId ?? '' },
    { enabled: open && chatsEnabled && mountChatId !== null },
  )

  // Thread deleted elsewhere: getChat 404s on switch-hydration — fall back to
  // the new-thread state. Transient errors keep react-query's retry instead.
  const setActiveChatId = ctx?.setActiveChatId
  const threadNotFound = chatQuery.error?.data?.code === 'NOT_FOUND'
  useEffect(() => {
    if (!threadNotFound) return
    setActiveChatId?.(null)
    setMountChatId(null)
    setMountEpoch((e) => e + 1)
  }, [threadNotFound, setActiveChatId])

  const utils = trpc.useUtils()
  const renameChat = trpc.chat.renameChat.useMutation({
    onSuccess: async () => {
      await utils.chat.listByPage.invalidate({ workspaceId, pageId })
      setRenameOpen(false)
    },
  })
  // Deleting the active thread resets the panel to the new-thread state (the
  // epoch bump also unmounts a live instance of the deleted chat).
  const deleteChat = trpc.chat.deleteChat.useMutation({
    onSuccess: async () => {
      await utils.chat.listByPage.invalidate({ workspaceId, pageId })
      setDeleteOpen(false)
      setActiveChatId?.(null)
      setMountChatId(null)
      setMountEpoch((e) => e + 1)
    },
  })

  // Live selection → context chip (Notion: selection narrows the context).
  useEffect(() => {
    if (!open || !hasEditor) return
    const editor = getEditor()
    if (!editor) return
    const update = () => setHasSelection(!editor.state.selection.empty)
    update()
    editor.on('selectionUpdate', update)
    return () => {
      editor.off('selectionUpdate', update)
    }
  }, [open, hasEditor, getEditor])

  const getPageContext = useCallback((): { content: string; isSelection: boolean } | null => {
    const editor = getEditor()
    if (!editor) return null
    const { from, to, empty } = editor.state.selection
    const ctx = empty
      ? { content: htmlToMarkdown(editor.getHTML()), isSelection: false }
      : { content: editor.state.doc.textBetween(from, to, '\n'), isSelection: true }
    // Empty page (or whitespace-only selection): send no context at all — the
    // generate route rejects an empty pageContext.content, and the agent can
    // always pull the page through getPageMarkdown when it needs it.
    if (!ctx.content.trim()) return null
    return ctx
  }, [getEditor])

  // Per-answer page actions (spec item 6). All go through the LIVE editor so
  // they collaborate correctly: snapshots are editor HTML, and both restore
  // and append propagate through the shared Yjs doc.
  const capturePageSnapshot = useCallback((): string | null => {
    const editor = getEditor()
    return editor ? editor.getHTML() : null
  }, [getEditor])

  const restorePageSnapshot = useCallback(
    (snapshot: string): boolean => {
      const editor = getEditor()
      if (!editor) return false
      editor.commands.setContent(snapshot)
      return true
    },
    [getEditor],
  )

  const appendToPage = useCallback(
    (markdown: string): boolean => {
      const editor = getEditor()
      if (!editor) return false
      const end = editor.state.doc.content.size
      return editor.chain().insertContentAt(end, markdownToHtml(markdown)).run()
    },
    [getEditor],
  )

  if (!ctx?.enabled) return null

  const panelShown = ctx.panelOpen

  const switchThread = (id: string | null) => {
    ctx.setActiveChatId(id)
    setMountChatId(id)
    setMountEpoch((e) => e + 1)
  }

  const activeChat = activeChatId ? (list.data?.find((c) => c.id === activeChatId) ?? null) : null

  const panelContent = (
    <>
      {/* Header (spec §7): no static «Чат» label — the thread switcher IS the
          title and stretches to the panel's left edge. */}
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', p: 1.5, pb: 1, flexShrink: 0 }}>
        {chatsEnabled ? (
          <>
            {(list.data?.length ?? 0) > 0 ? (
              <Select
                size="small"
                value={activeChatId ?? 'new'}
                onChange={(e) => {
                  const v = e.target.value as string
                  switchThread(v === 'new' ? null : v)
                }}
                sx={{ flex: 1, minWidth: 0 }}
                inputProps={{ 'aria-label': 'Выбор чата' }}
                data-testid="page-chat-switcher"
              >
                <MenuItem value="new">Новый чат</MenuItem>
                {(list.data ?? []).map((c) => (
                  <MenuItem key={c.id} value={c.id}>
                    {c.title ?? 'Без названия'}
                  </MenuItem>
                ))}
              </Select>
            ) : (
              <Box sx={{ flex: 1 }} />
            )}
            <IconButton
              size="small"
              aria-label="Новый чат"
              onClick={() => switchThread(null)}
              data-testid="page-chat-new"
            >
              <AddRoundedIcon fontSize="small" />
            </IconButton>
            {activeChatId !== null ? (
              <IconButton
                size="small"
                aria-label="Действия с чатом"
                onClick={(e) => setMenuAnchor(e.currentTarget)}
                data-testid="page-chat-menu"
              >
                <MoreVertIcon fontSize="small" />
              </IconButton>
            ) : null}
          </>
        ) : (
          <Box sx={{ flex: 1 }} />
        )}
        <Tooltip title="Режим отображения">
          <IconButton
            size="small"
            aria-label="Режим отображения"
            onClick={(e) => setModeMenuAnchor(e.currentTarget)}
            data-testid="page-chat-mode"
          >
            {ctx.displayMode === 'floating' ? (
              <PictureInPictureAltIcon fontSize="small" />
            ) : (
              <ViewSidebarRoundedIcon fontSize="small" />
            )}
          </IconButton>
        </Tooltip>
        <Tooltip title="Скрыть чат">
          <IconButton size="small" aria-label="Скрыть чат" onClick={ctx.closePanel}>
            {/* Floating window closes like a minimized window (RemoveIcon);
                the docked column slides away to the right (»). */}
            {ctx.displayMode === 'floating' ? (
              <RemoveIcon fontSize="small" />
            ) : (
              <KeyboardDoubleArrowRightIcon fontSize="small" />
            )}
          </IconButton>
        </Tooltip>
      </Stack>

      {chatsEnabled ? (
        <Box sx={{ flex: 1, minHeight: 0 }}>
          {/* For an explicitly-switched existing thread, wait for getChat so the
              client mounts with the real history; until then show a spinner. A
              new-thread mount (incl. one that lazily created a chat) renders
              immediately and never remounts through creation. */}
          {mountChatId === null || chatQuery.isSuccess ? (
            <WorkspaceChatClient
              key={mountEpoch}
              chatId={mountChatId}
              workspaceId={workspaceId}
              initialMessages={mountChatId ? (chatQuery.data?.messages ?? []) : []}
              variant="page"
              pageId={pageId}
              getPageContext={getPageContext}
              onChatCreated={ctx.setActiveChatId}
              contextChipLabel={hasSelection ? 'Контекст: Выделение' : PAGE_CHAT_CONTEXT_LABEL}
              capturePageSnapshot={capturePageSnapshot}
              restorePageSnapshot={restorePageSnapshot}
              appendToPage={appendToPage}
            />
          ) : (
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100%',
              }}
            >
              <CircularProgress size={24} />
            </Box>
          )}
        </Box>
      ) : (
        <Stack spacing={1.5} sx={{ p: 2 }} data-testid="page-chat-upsell">
          <Typography variant="body2">
            Чат с AI по странице доступен на тарифе ПРО и выше.
          </Typography>
          {/* Inline style: the unlayered `a { color: inherit }` reset in
              globals.css beats the layered MUI contained-button color. */}
          <Button
            component={Link}
            href="/pricing"
            variant="contained"
            size="small"
            style={{ color: theme.palette.primary.contrastText }}
          >
            Перейти на тариф
          </Button>
        </Stack>
      )}

      {/* Display mode (spec §2): docked column vs floating window. */}
      <Menu
        anchorEl={modeMenuAnchor}
        open={Boolean(modeMenuAnchor)}
        onClose={() => setModeMenuAnchor(null)}
      >
        <MenuItem
          selected={ctx.displayMode === 'docked'}
          data-testid="page-chat-mode-docked"
          onClick={() => {
            setModeMenuAnchor(null)
            ctx.setDisplayMode('docked')
          }}
          sx={{ gap: 1, fontSize: 13 }}
        >
          <ViewSidebarRoundedIcon fontSize="small" />
          Сбоку справа
        </MenuItem>
        <MenuItem
          selected={ctx.displayMode === 'floating'}
          data-testid="page-chat-mode-floating"
          onClick={() => {
            setModeMenuAnchor(null)
            ctx.setDisplayMode('floating')
          }}
          sx={{ gap: 1, fontSize: 13 }}
        >
          <PictureInPictureAltIcon fontSize="small" />
          Плавающее окно
        </MenuItem>
      </Menu>

      {/* Thread actions (spec §7): rename/delete the active thread. */}
      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
        <MenuItem
          data-testid="page-chat-rename"
          onClick={() => {
            setMenuAnchor(null)
            setRenameValue(activeChat?.title ?? '')
            setRenameOpen(true)
          }}
          sx={{ gap: 1, fontSize: 13 }}
        >
          <DriveFileRenameOutlineIcon fontSize="small" />
          Переименовать
        </MenuItem>
        <MenuItem
          data-testid="page-chat-delete"
          onClick={() => {
            setMenuAnchor(null)
            setDeleteOpen(true)
          }}
          sx={{ gap: 1, fontSize: 13, color: 'error.main' }}
        >
          <DeleteIcon fontSize="small" />
          Удалить
        </MenuItem>
      </Menu>

      <Dialog open={renameOpen} onClose={() => setRenameOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Переименовать чат</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            size="small"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && renameValue.trim() && activeChatId) {
                renameChat.mutate({ chatId: activeChatId, title: renameValue.trim() })
              }
            }}
            // Mirrors renameChat's z.string().max(48) input cap.
            slotProps={{ htmlInput: { maxLength: 48 } }}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button variant="text" onClick={() => setRenameOpen(false)}>
            Отмена
          </Button>
          <Button
            onClick={() => {
              if (!activeChatId) return
              renameChat.mutate({ chatId: activeChatId, title: renameValue.trim() })
            }}
            disabled={!renameValue.trim() || renameChat.isPending}
          >
            Сохранить
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={deleteOpen} onClose={() => setDeleteOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Удалить чат?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Чат «{activeChat?.title ?? 'Без названия'}» будет удалён навсегда.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button variant="text" onClick={() => setDeleteOpen(false)}>
            Отмена
          </Button>
          <Button
            onClick={() => {
              if (!activeChatId) return
              deleteChat.mutate({ chatId: activeChatId })
            }}
            disabled={deleteChat.isPending}
          >
            Удалить
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )

  // Floating window (Notion's "Floating" display mode): fixed above the page,
  // outside the layout flex row — panel offsets (outline/comments) untouched.
  if (ctx.displayMode === 'floating') {
    return (
      <Grow in={panelShown} unmountOnExit style={{ transformOrigin: 'bottom right' }}>
        <Paper
          className="page-chat-sidebar"
          data-testid="page-chat-sidebar"
          data-mode="floating"
          elevation={8}
          sx={{
            position: 'fixed',
            bottom: 24,
            right: 24,
            width: 420,
            maxWidth: 'calc(100vw - 48px)',
            height: 'min(640px, calc(100vh - 96px))',
            zIndex: (theme) => theme.zIndex.modal - 1,
            borderRadius: 3,
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
            overflow: 'hidden',
          }}
        >
          {panelContent}
        </Paper>
      </Grow>
    )
  }

  // Docked column: Collapse animates the width 0↔400 (slide-in, spec §2);
  // unmountOnExit keeps the closed panel free of live queries.
  return (
    <Collapse
      in={panelShown}
      orientation="horizontal"
      unmountOnExit
      sx={{
        flexShrink: 0,
        height: '100%',
        position: 'relative',
        zIndex: 10,
        '& .MuiCollapse-wrapper, & .MuiCollapse-wrapperInner': { height: '100%' },
      }}
    >
      <Box
        data-testid="page-chat-sidebar"
        data-mode="docked"
        className="page-chat-sidebar"
        sx={{
          width: ctx.sidebarWidth,
          bgcolor: 'background.default',
          borderLeft: 1,
          borderColor: 'divider',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          position: 'relative',
        }}
      >
        {panelContent}
        <PanelResizeHandle
          edge="left"
          width={ctx.sidebarWidth}
          min={PAGE_CHAT_SIDEBAR_MIN_WIDTH}
          max={PAGE_CHAT_SIDEBAR_MAX_WIDTH}
          onWidth={ctx.setSidebarWidth}
          onCommit={ctx.commitSidebarWidth}
          ariaLabel="Изменить ширину чата"
          testId="page-chat-sidebar-resize"
        />
      </Box>
    </Collapse>
  )
}
