'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import {
  Alert,
  Box,
  Button,
  EmojiIconButton,
  Stack,
  TextField,
  Typography,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'

export function NewWorkspaceForm() {
  const [name, setName] = useState('')
  const [icon, setIcon] = useState('📒')
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()
  const create = trpc.workspace.create.useMutation({
    onSuccess: (workspace) => {
      router.push(`/workspaces/${workspace.id}`)
    },
    onError: (err) => {
      setError(err.message)
    },
  })

  return (
    <Box
      component="form"
      onSubmit={(e) => {
        e.preventDefault()
        setError(null)
        create.mutate({ name: name.trim(), icon })
      }}
      sx={{ maxWidth: 480, mx: 'auto', mt: { xs: 4, md: 8 } }}
    >
      <Stack spacing={3}>
        <Stack spacing={1} textAlign="center">
          <Typography variant="h4" fontWeight={800} letterSpacing="-0.02em">
            Создайте рабочее пространство
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Каждое пространство — это контейнер для ваших страниц, баз и медиа
          </Typography>
        </Stack>
        {error && <Alert severity="error">{error}</Alert>}
        <Stack direction="row" spacing={1.5} alignItems="center">
          <EmojiIconButton
            value={icon}
            onChange={setIcon}
            aria-label="Выбрать иконку"
            sx={{
              width: 56,
              height: 56,
              p: 0.5,
              borderRadius: 1,
              border: 1,
              borderColor: 'divider',
              flexShrink: 0,
            }}
            emojiSize={32}
          />
          <TextField
            label="Название"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            inputProps={{ maxLength: 64 }}
            autoFocus
            fullWidth
          />
        </Stack>
        <Button
          type="submit"
          variant="contained"
          size="large"
          disabled={create.isPending || !name.trim()}
        >
          Создать пространство
        </Button>
      </Stack>
    </Box>
  )
}
