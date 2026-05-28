'use client'

import { useState } from 'react'

import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  DeleteIcon,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import { SettingsCard } from './settings-card'

const KINDS = ['OPENAI', 'ANTHROPIC', 'DEEPSEEK', 'GIGACHAT', 'YANDEXGPT', 'OLLAMA'] as const
type Kind = (typeof KINDS)[number]

const FIELDS: Record<Kind, Array<{ key: string; label: string; required?: boolean }>> = {
  OPENAI: [
    { key: 'apiKey', label: 'API ключ', required: true },
    { key: 'organization', label: 'Organization' },
    { key: 'baseUrl', label: 'Base URL' },
  ],
  ANTHROPIC: [{ key: 'apiKey', label: 'API ключ', required: true }, { key: 'baseUrl', label: 'Base URL' }],
  DEEPSEEK: [{ key: 'apiKey', label: 'API ключ', required: true }, { key: 'baseUrl', label: 'Base URL' }],
  GIGACHAT: [
    { key: 'clientId', label: 'Client ID', required: true },
    { key: 'clientSecret', label: 'Client Secret', required: true },
    { key: 'scope', label: 'Scope' },
  ],
  YANDEXGPT: [
    { key: 'apiKey', label: 'API ключ', required: true },
    { key: 'folderId', label: 'Folder ID', required: true },
  ],
  OLLAMA: [{ key: 'baseUrl', label: 'Base URL', required: true }],
}

export function AiProvidersManager({ workspaceId }: { workspaceId: string }) {
  const utils = trpc.useUtils()
  const list = trpc.aiProvider.list.useQuery({ workspaceId })
  const invalidate = () => {
    utils.aiProvider.list.invalidate({ workspaceId })
    utils.aiSettings.listAvailableModels.invalidate({ workspaceId })
    utils.aiSettings.listAvailableEmbeddingModels.invalidate({ workspaceId })
  }
  const create = trpc.aiProvider.create.useMutation({
    onSuccess: () => {
      invalidate()
      setOpen(false)
    },
  })
  const del = trpc.aiProvider.delete.useMutation({ onSuccess: invalidate })

  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<Kind>('OPENAI')
  const [name, setName] = useState('')
  const [connection, setConnection] = useState<Record<string, string>>({})
  const [modelSlug, setModelSlug] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [contextTokens, setContextTokens] = useState('128000')
  const [supportsEmbeddings, setSupportsEmbeddings] = useState(false)

  const reset = () => {
    setKind('OPENAI')
    setName('')
    setConnection({})
    setModelSlug('')
    setDisplayName('')
    setContextTokens('128000')
    setSupportsEmbeddings(false)
  }

  const submit = () => {
    const conn: Record<string, string> = {}
    for (const f of FIELDS[kind]) {
      const v = connection[f.key]?.trim()
      if (v) conn[f.key] = v
    }
    create.mutate({
      workspaceId,
      kind,
      name: name.trim(),
      connection: conn,
      model: {
        slug: modelSlug.trim(),
        displayName: displayName.trim() || modelSlug.trim(),
        contextTokens: Number(contextTokens) || 4096,
        supportsEmbeddings,
      },
    })
  }

  return (
    <SettingsCard
      title="Свои провайдеры"
      description="Подключите собственные LLM/embedding провайдеры с вашими ключами. Перед сохранением выполняется проверка соединения."
    >
      {list.data?.length ? (
        <Stack spacing={1}>
          {list.data.map((p) => (
            <Box
              key={p.id}
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                border: 1,
                borderColor: 'divider',
                borderRadius: 1,
                p: 1.5,
              }}
            >
              <Box>
                <Typography variant="subtitle2">
                  {p.name} <Chip size="small" label={p.kind} sx={{ ml: 1 }} />
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {p.models.map((m) => m.displayName).join(', ') || 'нет моделей'}
                </Typography>
              </Box>
              <IconButton onClick={() => del.mutate({ workspaceId, providerId: p.id })} aria-label="Удалить провайдера">
                <DeleteIcon />
              </IconButton>
            </Box>
          ))}
        </Stack>
      ) : (
        <Typography variant="body2" color="text.secondary">
          Пока нет своих провайдеров.
        </Typography>
      )}

      <Button
        variant="outlined"
        onClick={() => {
          reset()
          setOpen(true)
        }}
        sx={{ alignSelf: 'flex-start' }}
      >
        Добавить провайдера
      </Button>

      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Новый провайдер</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {create.error ? <Alert severity="error">{create.error.message}</Alert> : null}
            <TextField
              label="Тип"
              select
              value={kind}
              onChange={(e) => {
                setKind(e.target.value as Kind)
                setConnection({})
              }}
            >
              {KINDS.map((k) => (
                <MenuItem key={k} value={k}>
                  {k}
                </MenuItem>
              ))}
            </TextField>
            <TextField label="Название" value={name} onChange={(e) => setName(e.target.value)} />
            {FIELDS[kind].map((f) => (
              <TextField
                key={f.key}
                label={f.label + (f.required ? ' *' : '')}
                value={connection[f.key] ?? ''}
                onChange={(e) => setConnection((c) => ({ ...c, [f.key]: e.target.value }))}
              />
            ))}
            <Typography variant="subtitle2">Первая модель</Typography>
            <TextField label="Идентификатор модели (slug)" value={modelSlug} onChange={(e) => setModelSlug(e.target.value)} />
            <TextField label="Отображаемое имя" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            <TextField label="Контекст (токены)" value={contextTokens} onChange={(e) => setContextTokens(e.target.value)} />
            <TextField
              label="Тип модели"
              select
              value={supportsEmbeddings ? 'emb' : 'chat'}
              onChange={(e) => setSupportsEmbeddings(e.target.value === 'emb')}
            >
              <MenuItem value="chat">Чат (LLM)</MenuItem>
              <MenuItem value="emb">Векторизация (embeddings)</MenuItem>
            </TextField>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Отмена</Button>
          <Button
            variant="contained"
            onClick={submit}
            loading={create.isPending}
            disabled={!name.trim() || !modelSlug.trim()}
          >
            {create.isPending ? 'Проверка соединения…' : 'Сохранить'}
          </Button>
        </DialogActions>
      </Dialog>
    </SettingsCard>
  )
}
