"use client"

import KeyboardArrowDownRoundedIcon from "@mui/icons-material/KeyboardArrowDownRounded"
import Box from "@mui/material/Box"
import Fab from "@mui/material/Fab"
import Fade from "@mui/material/Fade"
import Stack from "@mui/material/Stack"
import { alpha } from "@mui/material/styles"
import { useEffect, useLayoutEffect, useRef, useState } from "react"

import { ChatComposer } from "./chat-composer"
import { ChatMessageList } from "./chat-message-list"
import type { ChatComposerAttachment, ChatSendPayload, ChatThreadMessage } from "./chat-types"

const BOTTOM_THRESHOLD_PX = 120

type ChatThreadProps = {
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
}

function isNearBottom(element: HTMLElement) {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= BOTTOM_THRESHOLD_PX
}

function scrollToBottom(element: HTMLElement, behavior: ScrollBehavior) {
  const options: ScrollToOptions = {
    behavior,
    top: element.scrollHeight,
  }

  if (typeof element.scrollTo === "function") {
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
}: ChatThreadProps) {
  const pinnedToBottomRef = useRef(true)
  const [scrollElement, setScrollElement] = useState<HTMLElement | null>(null)
  const [showScrollDown, setShowScrollDown] = useState(false)
  const usesPageScroll = Boolean(scrollContainerSelector)

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
    scrollToBottom(element, "auto")
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
    scrollElement.addEventListener("scroll", updateScrollState, { passive: true })

    return () => {
      scrollElement.removeEventListener("scroll", updateScrollState)
    }
  }, [scrollElement])

  useLayoutEffect(() => {
    if (!scrollElement || !pinnedToBottomRef.current) {
      return
    }

    scrollToBottom(scrollElement, "auto")
    setShowScrollDown(false)
  }, [messages, scrollElement])

  const handleScrollDown = () => {
    if (!scrollElement) {
      return
    }

    pinnedToBottomRef.current = true
    setShowScrollDown(false)
    scrollToBottom(scrollElement, "smooth")
  }

  return (
    <Stack
      data-testid="chat-thread"
      height={usesPageScroll ? undefined : "100%"}
      minHeight={usesPageScroll ? "100%" : 0}
      spacing={0}
      sx={{ position: "relative" }}
    >
      <ChatMessageList
        emptyDescription={emptyDescription}
        emptyTitle={emptyTitle}
        messages={messages}
        scrollMode={usesPageScroll ? "page" : "internal"}
      />
      <Box
        data-sticky={usesPageScroll ? "true" : "false"}
        data-testid="chat-composer-shell"
        sx={(theme) => ({
          bottom: 0,
          mt: "auto",
          pb: { xs: 1.5, sm: 2 },
          position: usesPageScroll ? "sticky" : "static",
          pt: 2,
          px: 2,
          zIndex: theme.zIndex.appBar - 1,
          ...(usesPageScroll
            ? {
                background: `linear-gradient(180deg, ${alpha(
                  theme.palette.background.default,
                  0,
                )} 0%, ${alpha(theme.palette.background.default, 0.96)} 30%, ${
                  theme.palette.background.default
                } 100%)`,
              }
            : null),
        })}
      >
        {usesPageScroll ? (
          <Fade in={showScrollDown} unmountOnExit>
            <Fab
              aria-label="Прокрутить вниз"
              color="primary"
              onClick={handleScrollDown}
              size="small"
              sx={{
                left: "50%",
                position: "absolute",
                top: -18,
                transform: "translateX(-50%)",
              }}
            >
              <KeyboardArrowDownRoundedIcon />
            </Fab>
          </Fade>
        ) : null}
        <ChatComposer
          attachments={composerAttachments}
          disabled={disabled}
          onAttachmentsChange={onComposerAttachmentsChange}
          onSend={onSend}
          onValueChange={onComposerValueChange}
          placeholder={composerPlaceholder}
          value={composerValue}
        />
      </Box>
    </Stack>
  )
}
