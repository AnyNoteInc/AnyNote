'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

import { htmlToMarkdown } from '@repo/editor/lib/html-to-markdown'
import {
  AddRoundedIcon,
  Box,
  Button,
  CloseIcon,
  IconButton,
  MenuItem,
  Select,
  Stack,
  Typography,
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
  const [hasSelection, setHasSelection] = useState(false)

  const chatsEnabled = features?.chatsEnabled ?? false
  const open = Boolean(ctx?.enabled && ctx.panelOpen)
  const activeChatId = ctx?.activeChatId ?? null

  const list = trpc.chat.listByPage.useQuery(
    { workspaceId, pageId },
    { enabled: open && chatsEnabled },
  )
  const chatQuery = trpc.chat.getChat.useQuery(
    { chatId: activeChatId ?? '' },
    { enabled: open && chatsEnabled && activeChatId !== null },
  )

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
      <Stack direction="row" spacing={1} alignItems="center" sx={{ p: 1.5, pb: 1, flexShrink: 0 }}>
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
                  ctx.setActiveChatId(v === 'new' ? null : v)
                }}
                sx={{ maxWidth: 160 }}
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
              onClick={() => ctx.setActiveChatId(null)}
              data-testid="page-chat-new"
            >
              <AddRoundedIcon fontSize="small" />
            </IconButton>
          </>
        ) : null}
        <IconButton size="small" aria-label="Закрыть чат" onClick={ctx.closePanel}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </Stack>

      {chatsEnabled ? (
        <Box sx={{ flex: 1, minHeight: 0 }}>
          {/* For an existing thread, wait for getChat so the client mounts with
              the real history (it does not reconcile from a later prop change
              alone before its own query resolves). A new thread renders empty. */}
          {activeChatId === null || chatQuery.isSuccess ? (
            <WorkspaceChatClient
              key={activeChatId ?? 'new'}
              chatId={activeChatId}
              workspaceId={workspaceId}
              initialMessages={activeChatId ? (chatQuery.data?.messages ?? []) : []}
              variant="page"
              pageId={pageId}
              getPageContext={getPageContext}
              onChatCreated={ctx.setActiveChatId}
              contextChipLabel={hasSelection ? 'Контекст: Выделение' : PAGE_CHAT_CONTEXT_LABEL}
            />
          ) : null}
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
            style={{ color: '#fff' }}
          >
            Перейти на тариф
          </Button>
        </Stack>
      )}
    </Box>
  )
}
