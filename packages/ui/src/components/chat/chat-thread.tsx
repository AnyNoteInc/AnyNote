'use client'

import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded'
import Box from '@mui/material/Box'
import Collapse from '@mui/material/Collapse'
import Fab from '@mui/material/Fab'
import Fade from '@mui/material/Fade'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import useMediaQuery from '@mui/material/useMediaQuery'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

import {
  ChatComposer,
  type ChatComposerRecentFile,
  type ChatComposerThinkingEffort,
} from './chat-composer'
import { ChatEmptyState } from './chat-empty-state'
import { ChatMessageList } from './chat-message-list'
import type { ChatRenderLink } from './chat-message-content'
import type {
  ChatComposerAttachment,
  ChatConfirmHandler,
  ChatSendPayload,
  ChatThreadMessage,
} from './chat-types'

const BOTTOM_THRESHOLD_PX = 120

type ChatThreadProps = Readonly<{
  messages: ChatThreadMessage[]
  composerValue: string
  composerAttachments: ChatComposerAttachment[]
  onComposerValueChange: (value: string) => void
  onComposerAttachmentsChange: (attachments: ChatComposerAttachment[]) => void
  onSend: (payload: ChatSendPayload) => void
  composerPlaceholder?: string
  disabled?: boolean
  emptyTitle?: string
  emptyDescription?: string
  scrollContainerSelector?: string
  scrollKey?: string
  renderLink?: ChatRenderLink
  onConfirm?: ChatConfirmHandler
  composerRecentFiles?: ReadonlyArray<ChatComposerRecentFile>
  onComposerAttachRecent?: (file: ChatComposerRecentFile) => void
  composerReasoningSupported?: boolean
  onComposerSelectThinking?: (effort: ChatComposerThinkingEffort) => void
  composerThinking?: { effort: ChatComposerThinkingEffort } | null
  onComposerClearThinking?: () => void
  composerContextChip?: { label: string } | null
  composerAutoFocus?: boolean
  /** 'compact' drops the assistant timeline rail so output spans the full
   *  width — for narrow hosts like the 400px page-chat panel. */
  density?: 'comfortable' | 'compact'
  /** Per-message action row rendered under a message (e.g. copy / insert /
   *  undo under assistant answers). Return null to render nothing. */
  renderMessageActions?: (message: ChatThreadMessage) => ReactNode
}>

function isNearBottom(element: HTMLElement) {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= BOTTOM_THRESHOLD_PX
}

function scrollToBottom(element: HTMLElement, behavior: ScrollBehavior) {
  const options: ScrollToOptions = {
    behavior,
    top: element.scrollHeight,
  }

  if (typeof element.scrollTo === 'function') {
    element.scrollTo(options)
    return
  }

  element.scrollTop = options.top ?? element.scrollHeight
}

export function ChatThread({
  messages,
  composerValue,
  composerAttachments,
  onComposerValueChange,
  onComposerAttachmentsChange,
  onSend,
  composerPlaceholder,
  disabled,
  emptyTitle,
  emptyDescription,
  scrollContainerSelector,
  scrollKey,
  renderLink,
  onConfirm,
  composerRecentFiles,
  onComposerAttachRecent,
  composerReasoningSupported,
  onComposerSelectThinking,
  composerThinking,
  onComposerClearThinking,
  composerContextChip,
  composerAutoFocus,
  density = 'comfortable',
  renderMessageActions,
}: ChatThreadProps) {
  const pinnedToBottomRef = useRef(true)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [scrollElement, setScrollElement] = useState<HTMLElement | null>(null)
  const [showScrollDown, setShowScrollDown] = useState(false)
  const usesPageScroll = Boolean(scrollContainerSelector)
  const isEmpty = messages.length === 0
  const prefersReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')

  // Internal-scroll hosts (the page-chat panel): land on the LATEST message.
  // @mui/x-chat's autoScroll follows newly appended messages, but a list that
  // mounts already populated (opening the panel, switching docked↔floating —
  // both remount, switching threads — scrollKey changes) starts at the top.
  useLayoutEffect(() => {
    if (usesPageScroll) return
    const scroller = rootRef.current?.querySelector<HTMLElement>('.MuiChatMessageList-scroller')
    if (scroller) scrollToBottom(scroller, 'auto')
  }, [usesPageScroll, scrollKey])

  useLayoutEffect(() => {
    if (!scrollContainerSelector) {
      setScrollElement(null)
      return
    }

    const element = document.querySelector<HTMLElement>(scrollContainerSelector)
    setScrollElement(element)

    if (!element) {
      return
    }

    pinnedToBottomRef.current = true
    setShowScrollDown(false)
    scrollToBottom(element, 'auto')
  }, [scrollContainerSelector, scrollKey])

  useEffect(() => {
    if (!scrollElement) {
      return
    }

    const updateScrollState = () => {
      const pinned = isNearBottom(scrollElement)
      pinnedToBottomRef.current = pinned
      setShowScrollDown(!pinned)
    }

    updateScrollState()
    scrollElement.addEventListener('scroll', updateScrollState, { passive: true })

    return () => {
      scrollElement.removeEventListener('scroll', updateScrollState)
    }
  }, [scrollElement])

  useLayoutEffect(() => {
    if (!scrollElement || !pinnedToBottomRef.current) {
      return
    }

    scrollToBottom(scrollElement, 'auto')
    setShowScrollDown(false)
  }, [messages, scrollElement])

  const handleScrollDown = () => {
    if (!scrollElement) {
      return
    }

    pinnedToBottomRef.current = true
    setShowScrollDown(false)
    scrollToBottom(scrollElement, 'smooth')
  }

  const disclaimer = (
    <Typography
      component="p"
      sx={{
        color: 'text.secondary',
        fontSize: 11,
        mt: 0.75,
        textAlign: 'center',
      }}
    >
      AnyNote это ИИ и может ошибаться. Проверяйте ответ дважды
    </Typography>
  )

  const composer = (
    <ChatComposer
      attachments={composerAttachments}
      autoFocus={composerAutoFocus}
      contextChip={composerContextChip ?? null}
      disabled={disabled}
      onAttachRecent={onComposerAttachRecent}
      onAttachmentsChange={onComposerAttachmentsChange}
      onClearThinking={onComposerClearThinking}
      onSelectThinking={onComposerSelectThinking}
      onSend={onSend}
      onValueChange={onComposerValueChange}
      placeholder={composerPlaceholder}
      reasoningSupported={composerReasoningSupported}
      recentFiles={composerRecentFiles}
      thinking={composerThinking}
      value={composerValue}
    />
  )

  return (
    <Stack
      data-testid="chat-thread"
      ref={rootRef}
      spacing={0}
      sx={{
        flex: usesPageScroll ? 1 : undefined,
        height: usesPageScroll ? undefined : '100%',
        minHeight: 0,
        position: 'relative',
      }}
    >
      {isEmpty ? null : (
        <ChatMessageList
          density={density}
          emptyDescription={emptyDescription}
          emptyTitle={emptyTitle}
          messages={messages}
          onConfirm={onConfirm}
          renderLink={renderLink}
          renderMessageActions={renderMessageActions}
          showEmptyState={false}
          scrollMode={usesPageScroll ? 'page' : 'internal'}
        />
      )}
      <Box
        data-sticky={!isEmpty && usesPageScroll ? 'true' : 'false'}
        data-testid="chat-composer-shell"
        sx={(theme) => ({
          bottom: 0,
          display: 'flex',
          flexDirection: 'column',
          flexGrow: isEmpty ? 1 : 0,
          mt: 'auto',
          ...(isEmpty ? { justifyContent: 'center', mt: 0 } : null),
          pb: { xs: 1.5, sm: 2 },
          position: !isEmpty && usesPageScroll ? 'sticky' : 'static',
          pt: 2,
          px: 2,
          transition: prefersReducedMotion
            ? 'none'
            : theme.transitions.create(['flex-grow'], {
                duration: theme.transitions.duration.standard,
              }),
          zIndex: theme.zIndex.appBar - 1,
          // Opaque backing while sticky so messages scroll behind the composer
          // instead of bleeding through it. Empty mode has nothing scrolling
          // under it, so it stays transparent.
          ...(!isEmpty && usesPageScroll ? { backgroundColor: 'background.paper' } : null),
        })}
      >
        <Collapse in={isEmpty} unmountOnExit>
          <Box data-testid="chat-empty-greeting" sx={{ mb: 2 }}>
            <ChatEmptyState />
          </Box>
        </Collapse>
        {!isEmpty && usesPageScroll ? (
          <Fade in={showScrollDown} unmountOnExit>
            <Fab
              aria-label="Прокрутить вниз"
              color="primary"
              onClick={handleScrollDown}
              size="small"
              sx={{ left: '50%', position: 'absolute', top: -18, transform: 'translateX(-50%)' }}
            >
              <KeyboardArrowDownRoundedIcon />
            </Fab>
          </Fade>
        ) : null}
        {composer}
        {disclaimer}
      </Box>
    </Stack>
  )
}
