"use client"

import { useEffect, useMemo, useState } from "react"
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
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

const CREDENTIAL_FIELDS: Record<string, Array<{ key: string; label: string }>> = {
  ollama: [{ key: "baseUrl", label: "Base URL (опционально)" }],
  openai: [
    { key: "apiKey", label: "API key" },
    { key: "organization", label: "Organization (опционально)" },
  ],
  gigachat: [
    { key: "clientId", label: "Client ID" },
    { key: "clientSecret", label: "Client secret" },
    { key: "scope", label: "Scope (например, GIGACHAT_API_PERS)" },
  ],
}

export function WorkspaceAiSection({ workspaceId }: Props) {
  const utils = trpc.useUtils()
  const settingsQuery = trpc.aiSettings.get.useQuery({ workspaceId })
  const modelsQuery = trpc.aiSettings.listAvailableModels.useQuery({ workspaceId })
  const pagesQuery = trpc.aiSettings.listWorkspacePages.useQuery({ workspaceId })
  const update = trpc.aiSettings.update.useMutation({
    onSuccess: () => {
      utils.aiSettings.get.invalidate({ workspaceId })
    },
  })
  const reindex = trpc.aiSettings.reindexWorkspace.useMutation()

  const [defaultModelId, setDefaultModelId] = useState<string>("")
  const [systemPromptPageId, setSystemPromptPageId] = useState<string>("")
  const [temperature, setTemperature] = useState<number>(0.7)
  const [maxOutputTokens, setMaxOutputTokens] = useState<string>("")
  const [credentials, setCredentials] = useState<Record<string, Record<string, string>>>({})
  const [skillPageIds, setSkillPageIds] = useState<string[]>([])

  useEffect(() => {
    if (!settingsQuery.data) return
    setDefaultModelId(settingsQuery.data.defaultModelId ?? "")
    setSystemPromptPageId(settingsQuery.data.systemPromptPageId ?? "")
    setTemperature(settingsQuery.data.temperature ?? 0.7)
    setMaxOutputTokens(
      settingsQuery.data.maxOutputTokens != null ? String(settingsQuery.data.maxOutputTokens) : "",
    )
    setCredentials(settingsQuery.data.providerCredentials ?? {})
    setSkillPageIds(settingsQuery.data.skillPageIds ?? [])
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

  const visibleProviders = useMemo(() => modelsQuery.data ?? [], [modelsQuery.data])

  const onSave = () => {
    update.mutate({
      workspaceId,
      defaultModelId: defaultModelId === "" ? null : defaultModelId,
      systemPromptPageId: systemPromptPageId.trim() === "" ? null : systemPromptPageId.trim(),
      temperature,
      maxOutputTokens: maxOutputTokens === "" ? null : Number(maxOutputTokens),
      providerCredentials: credentials,
      skillPageIds,
    })
  }

  const setCredentialField = (providerSlug: string, field: string, value: string) => {
    setCredentials((prev) => {
      const next = { ...prev }
      const slot = { ...(next[providerSlug] ?? {}) }
      if (value) {
        slot[field] = value
      } else {
        delete slot[field]
      }
      if (Object.keys(slot).length === 0) {
        delete next[providerSlug]
      } else {
        next[providerSlug] = slot
      }
      return next
    })
  }

  const toggleSkill = (pageId: string) => {
    setSkillPageIds((prev) =>
      prev.includes(pageId) ? prev.filter((id) => id !== pageId) : [...prev, pageId],
    )
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

          <FormControl fullWidth>
            <InputLabel id="ai-system-prompt-page">Системный промпт (страница)</InputLabel>
            <Select
              labelId="ai-system-prompt-page"
              label="Системный промпт (страница)"
              value={systemPromptPageId}
              onChange={(e) => setSystemPromptPageId(String(e.target.value))}
            >
              <MenuItem value="">
                <em>Не выбрано</em>
              </MenuItem>
              {(pagesQuery.data ?? []).map((p) => (
                <MenuItem key={p.id} value={p.id}>
                  {p.title || "Без названия"}
                </MenuItem>
              ))}
            </Select>
            <FormHelperText>
              Содержимое выбранной страницы прикрепляется в начало каждого промпта.
            </FormHelperText>
          </FormControl>

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
        </Stack>
      </Paper>

      <Paper variant="outlined" sx={{ p: 3 }}>
        <Stack spacing={2}>
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 600 }}>
              API ключи провайдеров
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Хранятся как JSON в workspace_ai_settings.provider_credentials. В будущем
              перенесём в зашифрованный vault.
            </Typography>
          </Box>
          {visibleProviders.map((p) => {
            const fields = CREDENTIAL_FIELDS[p.slug] ?? [{ key: "apiKey", label: "API key" }]
            return (
              <Box key={p.id}>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                  {p.name}
                </Typography>
                <Stack spacing={1.5}>
                  {fields.map((f) => (
                    <TextField
                      key={f.key}
                      label={f.label}
                      type={f.key.toLowerCase().includes("secret") || f.key === "apiKey"
                        ? "password"
                        : "text"}
                      value={credentials[p.slug]?.[f.key] ?? ""}
                      onChange={(e) => setCredentialField(p.slug, f.key, e.target.value)}
                      fullWidth
                      size="small"
                    />
                  ))}
                </Stack>
              </Box>
            )
          })}
        </Stack>
      </Paper>

      <Paper variant="outlined" sx={{ p: 3 }}>
        <Stack spacing={2}>
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 600 }}>
              Скиллы
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Страницы workspace, которые подмешиваются в промпт как описания скиллов.
            </Typography>
          </Box>
          {pagesQuery.isLoading ? (
            <Typography variant="body2" color="text.secondary">
              Загружаем список страниц…
            </Typography>
          ) : (pagesQuery.data ?? []).length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              В этом workspace пока нет страниц.
            </Typography>
          ) : (
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
              {(pagesQuery.data ?? []).map((page) => {
                const active = skillPageIds.includes(page.id)
                return (
                  <Chip
                    key={page.id}
                    label={page.title || "Без названия"}
                    color={active ? "primary" : "default"}
                    variant={active ? "filled" : "outlined"}
                    onClick={() => toggleSkill(page.id)}
                    clickable
                  />
                )
              })}
            </Box>
          )}
          <FormHelperText>
            Кликните по странице, чтобы добавить её в активные скиллы. Выбрано: {skillPageIds.length}
          </FormHelperText>
        </Stack>
      </Paper>

      <Paper variant="outlined" sx={{ p: 3 }}>
        <Stack spacing={2}>
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 600 }}>
              Переиндексация
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Перевыпустит outbox-событие page.upserted для каждой страницы
              workspace, чтобы индексатор пересобрал точки в Qdrant. Полезно
              после смены embeddings-модели или восстановления после простоя.
            </Typography>
          </Box>
          <Box>
            <Button
              variant="outlined"
              onClick={() => reindex.mutate({ workspaceId })}
              loading={reindex.isPending}
            >
              Переиндексировать workspace
            </Button>
          </Box>
          {reindex.error && <Alert severity="error">{reindex.error.message}</Alert>}
          {reindex.isSuccess && reindex.data && (
            <Alert severity="success">
              Поставлено в очередь страниц: {reindex.data.enqueued}
            </Alert>
          )}
        </Stack>
      </Paper>

      <Divider />

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
  )
}
