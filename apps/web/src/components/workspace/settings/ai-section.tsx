"use client"

import { useEffect, useMemo, useState } from "react"
import {
  Alert,
  Box,
  Button,
  FormControl,
  FormHelperText,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Slider,
  Stack,
  TextField,
  Typography,
} from "@repo/ui/components"
import { trpc } from "@/trpc/client"

type Props = { workspaceId: string }

export function WorkspaceAiSection({ workspaceId }: Props) {
  const utils = trpc.useUtils()
  const settingsQuery = trpc.aiSettings.get.useQuery({ workspaceId })
  const modelsQuery = trpc.aiSettings.listAvailableModels.useQuery({ workspaceId })
  const update = trpc.aiSettings.update.useMutation({
    onSuccess: () => {
      utils.aiSettings.get.invalidate({ workspaceId })
    },
  })

  const [defaultModelId, setDefaultModelId] = useState<string>("")
  const [systemPromptPageId, setSystemPromptPageId] = useState<string>("")
  const [temperature, setTemperature] = useState<number>(0.7)
  const [maxOutputTokens, setMaxOutputTokens] = useState<string>("")

  useEffect(() => {
    if (!settingsQuery.data) return
    setDefaultModelId(settingsQuery.data.defaultModelId ?? "")
    setSystemPromptPageId(settingsQuery.data.systemPromptPageId ?? "")
    setTemperature(settingsQuery.data.temperature ?? 0.7)
    setMaxOutputTokens(
      settingsQuery.data.maxOutputTokens != null ? String(settingsQuery.data.maxOutputTokens) : "",
    )
  }, [settingsQuery.data])

  const flatModels = useMemo(() => {
    if (!modelsQuery.data) return []
    return modelsQuery.data.flatMap((p) =>
      p.models.map((m) => ({
        id: m.id,
        label: `${p.name} · ${m.displayName}`,
        providerSlug: p.slug,
      })),
    )
  }, [modelsQuery.data])

  const onSave = () => {
    update.mutate({
      workspaceId,
      defaultModelId: defaultModelId === "" ? null : defaultModelId,
      systemPromptPageId: systemPromptPageId.trim() === "" ? null : systemPromptPageId.trim(),
      temperature,
      maxOutputTokens: maxOutputTokens === "" ? null : Number(maxOutputTokens),
    })
  }

  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h5" sx={{ fontWeight: 600 }}>
          Настройки LLM
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          Эти параметры применяются к чату AnyNote AI в этом workspace.
        </Typography>
      </Box>

      <Paper variant="outlined" sx={{ p: 3 }}>
        <Stack spacing={3}>
          <FormControl fullWidth>
            <InputLabel id="ai-default-model">Модель по умолчанию</InputLabel>
            <Select
              labelId="ai-default-model"
              label="Модель по умолчанию"
              value={defaultModelId}
              onChange={(e) => setDefaultModelId(String(e.target.value))}
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
            <FormHelperText>
              Выбирается из доступных моделей по тарифу workspace.
            </FormHelperText>
          </FormControl>

          <TextField
            label="Системный промпт (ID страницы)"
            placeholder="UUID страницы из этого workspace"
            value={systemPromptPageId}
            onChange={(e) => setSystemPromptPageId(e.target.value)}
            helperText="Содержимое указанной страницы прикрепляется в начало каждого промпта."
            fullWidth
          />

          <Box>
            <Typography variant="body2" sx={{ mb: 1 }}>
              Температура: {temperature.toFixed(2)}
            </Typography>
            <Slider
              value={temperature}
              min={0}
              max={2}
              step={0.05}
              onChange={(_e: Event, v: number | number[]) =>
                setTemperature(Array.isArray(v) ? (v[0] ?? 0) : v)
              }
              valueLabelDisplay="auto"
            />
          </Box>

          <TextField
            label="Максимум токенов в ответе"
            placeholder="например, 2000"
            type="number"
            value={maxOutputTokens}
            onChange={(e) => setMaxOutputTokens(e.target.value)}
            helperText="Оставьте пустым, чтобы использовать значение по умолчанию модели."
            fullWidth
          />

          {update.error && <Alert severity="error">{update.error.message}</Alert>}
          {update.isSuccess && <Alert severity="success">Настройки сохранены</Alert>}

          <Box>
            <Button
              variant="contained"
              onClick={onSave}
              loading={update.isPending}
              disabled={settingsQuery.isLoading || modelsQuery.isLoading}
            >
              Сохранить
            </Button>
          </Box>
        </Stack>
      </Paper>
    </Stack>
  )
}
