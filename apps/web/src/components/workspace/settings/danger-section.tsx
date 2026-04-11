"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

import { Alert, Button, Paper, Stack, TextField, Typography } from "@repo/ui/components"

import { trpc } from "@/trpc/client"

type Props = {
  workspace: { id: string; name: string }
  locked: boolean
}

export function WorkspaceDangerSection({ workspace, locked }: Props) {
  const [confirmation, setConfirmation] = useState("")
  const router = useRouter()
  const del = trpc.workspace.delete.useMutation({
    onSuccess: () => router.push("/workspaces"),
  })

  return (
    <Paper variant="outlined" sx={{ p: 3, borderColor: "error.main" }}>
      <Stack spacing={2}>
        <Typography variant="h6" color="error">
          Опасная зона
        </Typography>
        {locked ? (
          <Alert severity="info">
            Удаление доступно на платных тарифах. <a href="/settings/billing">Апгрейд</a>
          </Alert>
        ) : null}
        {del.error ? <Alert severity="error">{del.error.message}</Alert> : null}
        <Typography variant="body2" color="text.secondary">
          Удаление пространства необратимо. Все страницы, блоки и поисковые чаты будут удалены.
        </Typography>
        <TextField
          label={`Введите "${workspace.name}" для подтверждения`}
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          disabled={locked || del.isPending}
        />
        <Button
          color="error"
          onClick={() => del.mutate({ id: workspace.id })}
          disabled={locked || del.isPending || confirmation !== workspace.name}
        >
          Удалить пространство
        </Button>
      </Stack>
    </Paper>
  )
}
