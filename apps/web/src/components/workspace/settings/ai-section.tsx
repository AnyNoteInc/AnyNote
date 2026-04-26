'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  FormControl,
  FormHelperText,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography,
} from '@repo/ui/components'
import { trpc } from '@/trpc/client'

type InitialModel = { id: string; displayName: string; provider: { name: string; slug: string } }

type Props = { workspaceId: string; initialModels?: InitialModel[] }

export function WorkspaceAiSection({ workspaceId, initialModels }: Props) {
  const utils = trpc.useUtils()
  const settingsQuery = trpc.aiSettings.get.useQuery({ workspaceId })
  const modelsQuery = trpc.aiSettings.listAvailableModels.useQuery(
    { workspaceId },
    { enabled: initialModels === undefined },
  )
  const [successShown, setSuccessShown] = useState(false)
  const update = trpc.aiSettings.update.useMutation({
    onSuccess: () => {
      utils.aiSettings.get.invalidate({ workspaceId })
      setSuccessShown(true)
      setTimeout(() => setSuccessShown(false), 3000)
    },
  })

  const [defaultModelId, setDefaultModelId] = useState<string>('')
  const [systemPrompt, setSystemPrompt] = useState<string>('')

  useEffect(() => {
    if (!settingsQuery.data) return
    setDefaultModelId(settingsQuery.data.defaultModelId ?? '')
    setSystemPrompt(settingsQuery.data.systemPrompt ?? '')
  }, [settingsQuery.data])

  const flatModels = useMemo(() => {
    if (initialModels !== undefined) {
      return initialModels.map((m) => ({
        id: m.id,
        label: `${m.provider.name} · ${m.displayName}`,
        providerSlug: m.provider.slug,
      }))
    }
    if (!modelsQuery.data) return []
    return modelsQuery.data.flatMap((p) =>
      p.models.map((m) => ({
        id: m.id,
        label: `${p.name} · ${m.displayName}`,
        providerSlug: p.slug,
      })),
    )
  }, [initialModels, modelsQuery.data])

  const onSave = () => {
    update.mutate({
      workspaceId,
      defaultModelId: defaultModelId === '' ? null : defaultModelId,
      systemPrompt: systemPrompt.trim() === '' ? null : systemPrompt,
    })
  }

  const disabled = settingsQuery.isLoading || (initialModels === undefined && modelsQuery.isLoading)

  return (
    <Paper variant="outlined" sx={{ p: 3 }}>
      <Stack spacing={2}>
        <Typography variant="h6">Настройки LLM</Typography>
        <Typography variant="body2" color="text.secondary">
          Эти параметры применяются к чату AnyNote AI в этом workspace.
        </Typography>
        {update.error ? <Alert severity="error">{update.error.message}</Alert> : null}
        {successShown ? <Alert severity="success">Сохранено</Alert> : null}
        <FormControl fullWidth>
          <InputLabel id="ai-default-model">Модель по умолчанию</InputLabel>
          <Select
            labelId="ai-default-model"
            label="Модель по умолчанию"
            value={defaultModelId}
            onChange={(e) => setDefaultModelId(String(e.target.value))}
            disabled={disabled}
          >
            <MenuItem value="">
              <em>Не выбрано</em>
            </MenuItem>
            {flatModels.map((m) => (
              <MenuItem key={m.id} value={m.id}>
                {m.label}
              </MenuItem>
            ))}
          </Select>
          <FormHelperText>Выбирается из доступных моделей по тарифу workspace.</FormHelperText>
        </FormControl>
        <TextField
          label="Системный промпт"
          placeholder="Инструкции, которые подмешиваются в начало каждого запроса к модели."
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          disabled={disabled}
          multiline
          minRows={4}
          fullWidth
        />
        <Button
          variant="contained"
          onClick={onSave}
          loading={update.isPending}
          disabled={disabled}
          sx={{ alignSelf: 'flex-start' }}
        >
          Сохранить
        </Button>
      </Stack>
    </Paper>
  )
}
