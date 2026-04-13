"use client"

import { useEffect, useRef, useState } from "react"

import { ArrowUpwardIcon, Box, IconButton, Stack, TextField, Tooltip } from "@repo/ui/components"

import { trpc } from "@/trpc/client"

type Props = { chatId: string; workspaceId: string }

export function SearchChatInput({ chatId, workspaceId }: Props) {
  const [value, setValue] = useState("")
  const inputRef = useRef<HTMLInputElement | null>(null)
  const utils = trpc.useUtils()
  const send = trpc.search.sendMessage.useMutation({
    onSuccess: async () => {
      setValue("")
      await utils.search.getChat.invalidate({ chatId })
      await utils.search.listChats.invalidate({ workspaceId })
    },
  })

  useEffect(() => {
    inputRef.current?.focus()
  }, [chatId])

  const submit = () => {
    if (!value.trim() || send.isPending) return
    send.mutate({ chatId, content: value.trim() })
  }

  return (
    <Box
      sx={{
        position: "sticky",
        bottom: 0,
        bgcolor: "background.default",
        borderTop: "1px solid",
        borderColor: "divider",
        p: 2,
      }}
    >
      <Stack direction="row" spacing={1} alignItems="flex-end" sx={{ maxWidth: 720, mx: "auto" }}>
        <TextField
          inputRef={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              submit()
            }
          }}
          placeholder="Спросите что-нибудь о пространстве..."
          size="small"
          fullWidth
          multiline
          maxRows={10}
          disabled={send.isPending}
        />
        <Tooltip title="Отправить (Enter)">
          <span>
            <IconButton
              size="small"
              onClick={submit}
              disabled={!value.trim() || send.isPending}
              sx={{
                mb: 0.5,
                bgcolor: "primary.main",
                color: "primary.contrastText",
                "&:hover": { bgcolor: "primary.dark" },
                "&:disabled": { bgcolor: "action.disabledBackground" },
              }}
            >
              <ArrowUpwardIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </Stack>
    </Box>
  )
}
