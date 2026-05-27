'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControl,
  FormHelperText,
  InputLabel,
  ListSubheader,
  MenuItem,
  Select,
  Stack,
  TextField,
} from '@repo/ui/components'
import { trpc } from '@/trpc/client'

import { SettingsCard } from './settings-card'

type InitialModel = { id: string; displayName: string; provider: { name: string; slug: string } }
type InitialEmbeddingModel = {
  id: string
  displayName: string
  vectorSize: number | null
  minPlanSlug: string | null
  provider: { name: string; slug: string }
}

type Props = {
  workspaceId: string
  initialModels?: InitialModel[]
  initialEmbeddingModels?: InitialEmbeddingModel[]
}

export function WorkspaceAiSection({ workspaceId, initialModels, initialEmbeddingModels }: Props) {
  const utils = trpc.useUtils()
  const settingsQuery = trpc.aiSettings.get.useQuery({ workspaceId })
  const modelsQuery = trpc.aiSettings.listAvailableModels.useQuery(
    { workspaceId },
    { enabled: initialModels === undefined },
  )
  const embeddingModelsQuery = trpc.aiSettings.listAvailableEmbeddingModels.useQuery(
    { workspaceId },
    { enabled: initialEmbeddingModels === undefined },
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
  const [embeddingsModelId, setEmbeddingsModelId] = useState<string>('')
  const [systemPrompt, setSystemPrompt] = useState<string>('')
  const [confirmOpen, setConfirmOpen] = useState(false)

  useEffect(() => {
    if (!settingsQuery.data) return
    setDefaultModelId(settingsQuery.data.defaultModelId ?? '')
    setEmbeddingsModelId(settingsQuery.data.embeddingsModelId ?? '')
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

  const groupedEmbeddingModels = useMemo(() => {
    if (initialEmbeddingModels !== undefined) {
      const groups = new Map<string, { providerName: string; models: InitialEmbeddingModel[] }>()
      for (const model of initialEmbeddingModels) {
        const current = groups.get(model.provider.slug) ?? {
          providerName: model.provider.name,
          models: [],
        }
        current.models.push(model)
        groups.set(model.provider.slug, current)
      }
      return [...groups.values()]
    }

    if (!embeddingModelsQuery.data) return []
    return embeddingModelsQuery.data.map((provider) => ({
      providerName: provider.name,
      models: provider.models.map((model) => ({
        id: model.id,
        displayName: model.displayName,
        vectorSize: model.vectorSize,
        minPlanSlug: model.minPlanSlug,
        provider: { name: provider.name, slug: provider.slug },
      })),
    }))
  }, [initialEmbeddingModels, embeddingModelsQuery.data])

  const loadedEmbeddingsModelId = settingsQuery.data?.embeddingsModelId ?? ''
  const embeddingsChanged = embeddingsModelId !== loadedEmbeddingsModelId

  const submit = () => {
    update.mutate({
      workspaceId,
      defaultModelId: defaultModelId === '' ? null : defaultModelId,
      embeddingsModelId: embeddingsModelId === '' ? null : embeddingsModelId,
      systemPrompt: systemPrompt.trim() === '' ? null : systemPrompt,
    })
  }

  const onSave = () => {
    if (embeddingsChanged) {
      setConfirmOpen(true)
      return
    }
    submit()
  }

  const onConfirm = () => {
    setConfirmOpen(false)
    submit()
  }

  const disabled =
    settingsQuery.isLoading ||
    (initialModels === undefined && modelsQuery.isLoading) ||
    (initialEmbeddingModels === undefined && embeddingModelsQuery.isLoading)

  return (
    <Stack spacing={3}>
      <SettingsCard
        title="Настройки LLM"
        description="Эти параметры применяются к чату AnyNote AI в этом workspace."
      >
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
      </SettingsCard>

      <SettingsCard
        title="Векторизация"
        description="Модель для индексации страниц и поиска по контексту в чатах. Без выбранной модели страницы не индексируются и поиск по содержимому не работает."
      >
        <FormControl fullWidth>
          <InputLabel id="ai-embeddings-model">Модель векторизации</InputLabel>
          <Select
            labelId="ai-embeddings-model"
            label="Модель векторизации"
            value={embeddingsModelId}
            onChange={(e) => setEmbeddingsModelId(String(e.target.value))}
            disabled={disabled}
          >
            <MenuItem value="">
              <em>Не выбрано</em>
            </MenuItem>
            {groupedEmbeddingModels.flatMap((group) => [
              <ListSubheader key={`provider-${group.providerName}`}>
                {group.providerName}
              </ListSubheader>,
              ...group.models.map((model) => (
                <MenuItem key={model.id} value={model.id}>
                  {model.displayName}
                  {model.vectorSize !== null ? ` · ${model.vectorSize}` : ''}
                </MenuItem>
              )),
            ])}
          </Select>
          <FormHelperText>
            При смене или сбросе модели все векторы будут удалены, а страницы начнут
            индексироваться заново. Это может занять время для больших пространств.
          </FormHelperText>
        </FormControl>
      </SettingsCard>

      <Stack direction="row">
        <Button variant="contained" onClick={onSave} loading={update.isPending} disabled={disabled}>
          Сохранить
        </Button>
      </Stack>

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)}>
        <DialogTitle>Сменить модель векторизации?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Все ранее проиндексированные данные будут удалены, и страницы начнут векторизироваться
            заново. На больших пространствах это может занять время.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)}>Отмена</Button>
          <Button onClick={onConfirm} variant="contained">
            Подтвердить
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}
