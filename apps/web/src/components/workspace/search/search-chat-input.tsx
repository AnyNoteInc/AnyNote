"use client"

import { useState, useRef, useEffect } from "react"

import { Box, Button, Stack, TextField } from "@repo/ui/components"

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

  return (
    <Box
      component="form"
      onSubmit={(event) => {
        event.preventDefault()
        if (!value.trim() || send.isPending) return
        send.mutate({ chatId, content: value.trim() })
      }}
      sx={{
        position: "sticky",
        bottom: 0,
        bgcolor: "background.default",
        borderTop: "1px solid",
        borderColor: "divider",
        p: 2,
      }}
    >
      <Stack direction="row" spacing={1} sx={{ maxWidth: 720, mx: "auto" }}>
        <TextField
          inputRef={inputRef}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="Спросите что-нибудь о пространстве..."
          size="small"
          fullWidth
          disabled={send.isPending}
        />
        <Button type="submit" disabled={!value.trim() || send.isPending}>
          Отправить
        </Button>
      </Stack>
    </Box>
  )
}
