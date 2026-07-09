'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

import { htmlToMarkdown } from '@repo/editor/lib/html-to-markdown'
import {
  AddRoundedIcon,
  Box,
  Button,
  CircularProgress,
  CloseIcon,
  DeleteIcon,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  DriveFileRenameOutlineIcon,
  IconButton,
  Menu,
  MenuItem,
  MoreVertIcon,
  Select,
  Stack,
  TextField,
  Typography,
  useTheme,
} from '@repo/ui/components'

import { usePageEditor } from '@/components/page/editor-context'
import { usePlanFeaturesOptional } from '@/components/workspace/plan-features-context'
import { WorkspaceChatClient } from '@/components/workspace/chat/workspace-chat-client'
import { trpc } from '@/trpc/client'

import {
  PAGE_CHAT_CONTEXT_LABEL,
  PAGE_CHAT_SIDEBAR_WIDTH,
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
    if (!empty) {
      return { content: editor.state.doc.textBetween(from, to, '\n'), isSelection: true }
    }
    return { content: htmlToMarkdown(editor.getHTML()), isSelection: false }
  }, [getEditor])

  if (!ctx?.enabled || !ctx.panelOpen) return null

  const switchThread = (id: string | null) => {
    ctx.setActiveChatId(id)
    setMountChatId(id)
    setMountEpoch((e) => e + 1)
  }

  const activeChat = activeChatId ? (list.data?.find((c) => c.id === activeChatId) ?? null) : null

  return (
    <Box
      className="page-chat-sidebar"
      data-testid="page-chat-sidebar"
      sx={{
        width: PAGE_CHAT_SIDEBAR_WIDTH,
        flexShrink: 0,
        position: 'relative',
        zIndex: 10,
        bgcolor: 'background.default',
        borderLeft: 1,
        borderColor: 'divider',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
      }}
    >
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', p: 1.5, pb: 1, flexShrink: 0 }}>
        <Typography variant="subtitle2" sx={{ flex: 1 }}>
          Чат по странице
        </Typography>
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
                sx={{ maxWidth: 160 }}
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
            ) : null}
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
        ) : null}
        <IconButton size="small" aria-label="Закрыть чат" onClick={ctx.closePanel}>
          <CloseIcon fontSize="small" />
        </IconButton>
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
    </Box>
  )
}
