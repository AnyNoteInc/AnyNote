"use client"

import { useEffect, useRef, useState, type MouseEvent } from "react"

import {
  AddIcon,
  Box,
  Button,
  EmojiIconButton,
  EmojiPicker,
  Popover,
  Stack,
  TextField,
  Typography,
} from "@repo/ui/components"

import { trpc } from "@/trpc/client"

const UNTITLED_PLACEHOLDER = "Новая страница"

type Props = {
  id: string
  workspaceId: string
  initialTitle: string | null
  initialIcon: string | null
}

export function PageHeader({ id, workspaceId, initialTitle, initialIcon }: Props) {
  const query = trpc.page.getById.useQuery({ id }, { staleTime: 0 })
  // Use the query result directly when loaded (data can be null for icon after
  // removal). Only fall back to SSR initialIcon/Title while the query is still
  // pending. `?? initialIcon` was a bug — it treated null as "not loaded".
  const title = query.data ? query.data.title : initialTitle
  const icon = query.data ? query.data.icon : initialIcon

  const utils = trpc.useUtils()
  const update = trpc.page.update.useMutation({
    // Update both caches in place instead of invalidating. Invalidation would
    // refetch the whole workspace page list, which the sidebar + breadcrumb
    // subscribe to — causing a visible flicker and unnecessary network work.
    onSuccess: (updated) => {
      utils.page.getById.setData({ id }, (prev) =>
        prev
          ? { ...prev, title: updated.title, icon: updated.icon, updatedAt: updated.updatedAt }
          : prev,
      )
      utils.page.listByWorkspace.setData(
        { workspaceId },
        (prev) =>
          prev?.map((p) =>
            p.id === id ? { ...p, title: updated.title, icon: updated.icon } : p,
          ) ?? prev,
      )
    },
  })

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState("")
  const [addIconAnchor, setAddIconAnchor] = useState<HTMLElement | null>(null)
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

  const openAddIcon = (event: MouseEvent<HTMLButtonElement>) =>
    setAddIconAnchor(event.currentTarget)
  const closeAddIcon = () => setAddIconAnchor(null)

  return (
    <Stack spacing={0.5} sx={{ "&:hover .page-header__add-icon": { opacity: 1 } }}>
      {!icon ? (
        <Box sx={{ height: 28 }}>
          <Button
            className="page-header__add-icon"
            size="small"
            onClick={openAddIcon}
            startIcon={<AddIcon fontSize="small" />}
            sx={{
              color: "text.secondary",
              textTransform: "none",
              opacity: 0,
              transition: "opacity .15s",
              "&:focus-visible": { opacity: 1 },
            }}
          >
            Добавить иконку
          </Button>
          <Popover
            open={Boolean(addIconAnchor)}
            anchorEl={addIconAnchor}
            onClose={closeAddIcon}
            anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
          >
            <EmojiPicker
              onSelect={(emoji) => {
                closeAddIcon()
                update.mutate({ id, workspaceId, icon: emoji })
              }}
            />
          </Popover>
        </Box>
      ) : null}
      <Stack direction="row" spacing={1} alignItems="center">
        {icon ? (
          <EmojiIconButton
            value={icon}
            onChange={(emoji) => update.mutate({ id, workspaceId, icon: emoji })}
            onRemove={() => update.mutate({ id, workspaceId, icon: null })}
            aria-label="Изменить иконку"
            sx={{ width: 56, height: 56, p: 0.5, borderRadius: 1 }}
            emojiSize={44}
          />
        ) : null}
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
            placeholder={UNTITLED_PLACEHOLDER}
            slotProps={{ input: { disableUnderline: true } }}
            sx={{
              "& .MuiInput-input": {
                fontSize: "2.25rem",
                fontWeight: 700,
                lineHeight: 1.2,
                padding: 0,
              },
            }}
          />
        ) : (
          <Typography
            variant="h3"
            onClick={startEdit}
            sx={{
              flex: 1,
              fontSize: "2.25rem",
              fontWeight: 700,
              lineHeight: 1.2,
              cursor: "text",
              color: title ? "text.primary" : "text.secondary",
              px: 1,
              mx: -1,
              borderRadius: 1,
              "&:hover": { bgcolor: "action.hover" },
            }}
          >
            {title || UNTITLED_PLACEHOLDER}
          </Typography>
        )}
      </Stack>
    </Stack>
  )
}
