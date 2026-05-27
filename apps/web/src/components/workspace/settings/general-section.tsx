'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { Alert, Button, EmojiIconButton, Stack, TextField } from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import { SettingsCard } from './settings-card'

type Props = {
  workspace: { id: string; name: string; icon: string | null }
  isOwner: boolean
}

export function WorkspaceGeneralSection({ workspace, isOwner }: Props) {
  const [name, setName] = useState(workspace.name)
  const [icon, setIcon] = useState(workspace.icon ?? '')
  const [successShown, setSuccessShown] = useState(false)
  const router = useRouter()
  const utils = trpc.useUtils()
  const rename = trpc.workspace.rename.useMutation({
    onSuccess: async () => {
      setSuccessShown(true)
      await utils.workspace.getById.invalidate({ id: workspace.id })
      router.refresh()
      setTimeout(() => setSuccessShown(false), 3000)
    },
  })

  const disabled = !isOwner || rename.isPending

  return (
    <SettingsCard
      title="Общее"
      description="Название и иконка пространства."
    >
      {!isOwner && (
        <Alert severity="info">Только владелец пространства может изменять настройки.</Alert>
      )}
      {rename.error ? <Alert severity="error">{rename.error.message}</Alert> : null}
      {successShown ? <Alert severity="success">Сохранено</Alert> : null}
      <Stack direction="row" spacing={1.5} alignItems="stretch">
        <EmojiIconButton
          value={icon}
          fallback="📒"
          emojiSize={28}
          onChange={setIcon}
          disabled={disabled}
          aria-label="Изменить иконку"
          sx={{
            width: 56,
            height: 56,
            borderRadius: 1,
            border: 1,
            borderColor: 'divider',
            alignSelf: 'center',
          }}
        />
        <TextField
          label="Название"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={disabled}
          fullWidth
        />
      </Stack>
      <Button
        onClick={() => rename.mutate({ id: workspace.id, name, icon: icon || undefined })}
        disabled={disabled || !name.trim()}
        sx={{ alignSelf: 'flex-start' }}
      >
        Сохранить
      </Button>
    </SettingsCard>
  )
}
