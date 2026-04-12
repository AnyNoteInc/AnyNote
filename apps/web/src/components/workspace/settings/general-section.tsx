"use client"

import { useState } from "react"

import { Alert, Button, Paper, Stack, TextField, Typography } from "@repo/ui/components"

import { trpc } from "@/trpc/client"

type Props = {
  workspace: { id: string; name: string; icon: string | null }
  isOwner: boolean
}

export function WorkspaceGeneralSection({ workspace, isOwner }: Props) {
  const [name, setName] = useState(workspace.name)
  const [icon, setIcon] = useState(workspace.icon ?? "")
  const [successShown, setSuccessShown] = useState(false)
  const utils = trpc.useUtils()
  const rename = trpc.workspace.rename.useMutation({
    onSuccess: async () => {
      setSuccessShown(true)
      await utils.workspace.getById.invalidate({ id: workspace.id })
      setTimeout(() => setSuccessShown(false), 3000)
    },
  })

  return (
    <Paper variant="outlined" sx={{ p: 3 }}>
      <Stack spacing={2}>
        <Typography variant="h6">Общее</Typography>
        {!isOwner && (
          <Alert severity="info">Только владелец пространства может изменять настройки.</Alert>
        )}
        {rename.error ? <Alert severity="error">{rename.error.message}</Alert> : null}
        {successShown ? <Alert severity="success">Сохранено</Alert> : null}
        <TextField
          label="Название"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={!isOwner || rename.isPending}
          fullWidth
        />
        <TextField
          label="Иконка (эмодзи)"
          value={icon}
          onChange={(e) => setIcon(e.target.value)}
          disabled={!isOwner || rename.isPending}
          inputProps={{ maxLength: 8 }}
        />
        <Button
          onClick={() => rename.mutate({ id: workspace.id, name, icon: icon || undefined })}
          disabled={!isOwner || rename.isPending || !name.trim()}
          sx={{ alignSelf: "flex-start" }}
        >
          Сохранить
        </Button>
      </Stack>
    </Paper>
  )
}
