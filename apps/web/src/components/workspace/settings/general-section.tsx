"use client"

import { useState } from "react"

import {
  Alert,
  Button,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@repo/ui/components"

import { trpc } from "@/trpc/client"

type Props = {
  workspace: { id: string; name: string; icon: string | null }
  locked: boolean
}

export function WorkspaceGeneralSection({ workspace, locked }: Props) {
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
        {locked ? (
          <Alert severity="info">
            Переименование доступно на платных тарифах. <a href="/settings/billing">Апгрейд</a>
          </Alert>
        ) : null}
        {rename.error ? <Alert severity="error">{rename.error.message}</Alert> : null}
        {successShown ? <Alert severity="success">Сохранено</Alert> : null}
        <TextField
          label="Название"
          value={name}
          onChange={(event) => setName(event.target.value)}
          disabled={locked || rename.isPending}
          fullWidth
        />
        <TextField
          label="Иконка (эмодзи)"
          value={icon}
          onChange={(event) => setIcon(event.target.value)}
          disabled={locked || rename.isPending}
          inputProps={{ maxLength: 8 }}
        />
        <Stack direction="row" spacing={1}>
          <Button
            onClick={() => rename.mutate({ id: workspace.id, name, icon: icon || undefined })}
            disabled={locked || rename.isPending || !name.trim()}
          >
            Сохранить
          </Button>
        </Stack>
      </Stack>
    </Paper>
  )
}
