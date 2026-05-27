'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { Alert, Button, TextField } from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import { SettingsCard } from './settings-card'

type Props = {
  workspace: { id: string; name: string }
  isOwner: boolean
}

export function WorkspaceDangerSection({ workspace, isOwner }: Props) {
  const [confirmation, setConfirmation] = useState('')
  const router = useRouter()
  const del = trpc.workspace.delete.useMutation({
    onSuccess: () => router.push('/workspaces'),
  })

  return (
    <SettingsCard
      title="Опасная зона"
      description="Удаление пространства необратимо. Все страницы, блоки и поисковые чаты будут удалены."
      tone="danger"
    >
      {!isOwner && <Alert severity="info">Только владелец пространства может удалить его.</Alert>}
      {del.error ? <Alert severity="error">{del.error.message}</Alert> : null}
      <TextField
        label={`Введите "${workspace.name}" для подтверждения`}
        value={confirmation}
        onChange={(e) => setConfirmation(e.target.value)}
        disabled={!isOwner || del.isPending}
      />
      <Button
        color="error"
        onClick={() => del.mutate({ id: workspace.id })}
        disabled={!isOwner || del.isPending || confirmation !== workspace.name}
        sx={{ alignSelf: 'flex-start' }}
      >
        Удалить пространство
      </Button>
    </SettingsCard>
  )
}
