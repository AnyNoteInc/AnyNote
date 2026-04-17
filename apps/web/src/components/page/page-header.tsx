"use client"

import { useEffect, useRef, useState } from "react"

import { EmojiIconButton, Stack, TextField, Typography } from "@repo/ui/components"

import { trpc } from "@/trpc/client"

type Props = {
  id: string
  workspaceId: string
  initialTitle: string | null
  initialIcon: string | null
}

export function PageHeader({ id, workspaceId, initialTitle, initialIcon }: Props) {
  const query = trpc.page.getById.useQuery({ id }, { staleTime: 0 })
  const title = query.data?.title ?? initialTitle
  const icon = query.data?.icon ?? initialIcon

  const utils = trpc.useUtils()
  const update = trpc.page.update.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.page.getById.invalidate({ id }),
        utils.page.listByWorkspace.invalidate({ workspaceId }),
      ])
    },
  })

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState("")
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  const startEdit = () => {
    setDraft(title ?? "")
    setEditing(true)
  }

  const commitEdit = () => {
    if (!editing) return
    setEditing(false)
    const current = (title ?? "").trim()
    const next = draft.trim()
    if (next !== current) update.mutate({ id, workspaceId, title: next })
  }

  return (
    <Stack direction="row" spacing={1} alignItems="center">
      <EmojiIconButton
        value={icon}
        onChange={(emoji) => update.mutate({ id, workspaceId, icon: emoji })}
        aria-label="Изменить иконку"
        sx={{ width: 44, height: 44, p: 0.5, borderRadius: 1 }}
      />
      {editing ? (
        <TextField
          inputRef={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              commitEdit()
            }
            if (e.key === "Escape") {
              e.preventDefault()
              setEditing(false)
            }
          }}
          variant="standard"
          fullWidth
          placeholder="Без названия"
          slotProps={{
            input: { disableUnderline: true },
          }}
          sx={{
            "& .MuiInput-input": {
              fontSize: "1.5rem",
              fontWeight: 500,
              lineHeight: 1.334,
              padding: 0,
            },
          }}
        />
      ) : (
        <Typography
          variant="h5"
          onClick={startEdit}
          sx={{
            flex: 1,
            cursor: "text",
            color: title ? "text.primary" : "text.secondary",
            px: 1,
            mx: -1,
            borderRadius: 1,
            "&:hover": { bgcolor: "action.hover" },
          }}
        >
          {title || "Без названия"}
        </Typography>
      )}
    </Stack>
  )
}
