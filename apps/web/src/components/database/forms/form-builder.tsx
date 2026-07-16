'use client'

import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  ContentCopyIcon,
  Dialog,
  DialogContent,
  DialogTitle,
  PublishIcon,
  Stack,
  Typography,
  useMediaQuery,
  useTheme,
} from '@repo/ui/components'
import { parseFormVersionDocument, type FormVersionDocument } from '@repo/domain/database/forms'

import { trpc } from '@/trpc/client'
import { usePlanFeatures } from '@/components/workspace/plan-features-context'
import { FormRenderer } from '@/components/forms/form-renderer'

import type { DatabaseManagedForm, DatabaseSchema } from '../types'
import { FormOutlinePanel } from './form-outline-panel'
import { FormPreviewCanvas } from './form-preview-canvas'
import { FormResponsesPanel } from './form-responses-panel'
import { FormSettingsPanel } from './form-settings-panel'
import { FormSharePanel } from './form-share-panel'
import { initialBuilderState, reduceBuilder } from './form-builder-state'
import { validateFormPublishReadiness } from './form-builder-validation'

interface FormBuilderProps {
  readonly pageId: string
  readonly formViewId: string
  readonly editable?: boolean
}

const FORM_LOOKUP_PLACEHOLDER = '00000000-0000-4000-8000-000000000000'

function isConflict(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const candidate = error as { message?: unknown; data?: { code?: unknown } }
  return candidate.data?.code === 'CONFLICT' || candidate.message === 'FORM_DRAFT_CONFLICT'
}

function LoadingState() {
  return (
    <Box sx={{ height: '100%', display: 'grid', placeItems: 'center' }}>
      <CircularProgress />
    </Box>
  )
}

export function FormBuilder({ pageId, formViewId, editable = true }: FormBuilderProps) {
  const forms = trpc.database.listForms.useQuery({ pageId })
  const formEntries = forms.data as readonly { id: string; viewId: string | null }[] | undefined
  const formId = formEntries?.find(({ viewId }) => viewId === formViewId)?.id
  const formQuery = trpc.database.getForm.useQuery(
    { pageId, formId: formId ?? FORM_LOOKUP_PLACEHOLDER },
    { enabled: Boolean(formId), retry: false },
  )
  const schemaQuery = trpc.database.getByPage.useQuery({ pageId }, { retry: false })
  const form = formQuery.data as DatabaseManagedForm | undefined
  const schema = schemaQuery.data as DatabaseSchema | undefined

  if (forms.isLoading || (formId && formQuery.isLoading)) return <LoadingState />
  if (forms.error || formQuery.error || !formId || !form) {
    return <Alert severity="error">Не удалось открыть конструктор формы.</Alert>
  }

  try {
    const document = parseFormVersionDocument(form.draftSchema)
    return (
      <LoadedFormBuilder
        key={form.id}
        pageId={pageId}
        formViewId={formViewId}
        initialForm={form}
        initialDocument={document}
        schema={schema}
        editable={editable}
        refetchForm={formQuery.refetch as () => Promise<{ data?: DatabaseManagedForm }>}
      />
    )
  } catch {
    return <Alert severity="error">Черновик формы повреждён и не может быть открыт.</Alert>
  }
}

function LoadedFormBuilder({
  pageId,
  formViewId,
  initialForm,
  initialDocument,
  schema,
  editable,
  refetchForm,
}: {
  pageId: string
  formViewId: string
  initialForm: DatabaseManagedForm
  initialDocument: FormVersionDocument
  schema: DatabaseSchema | undefined
  editable: boolean
  refetchForm: () => Promise<{ data?: DatabaseManagedForm }>
}) {
  const theme = useTheme()
  const desktop = !useMediaQuery(theme.breakpoints.down('lg'))
  const features = usePlanFeatures()
  const [state, dispatch] = useReducer(reduceBuilder, undefined, () =>
    initialBuilderState(initialDocument, initialForm.draftRevision),
  )
  const [form, setForm] = useState(initialForm)
  const [shareOpen, setShareOpen] = useState(false)
  const [responsesOpen, setResponsesOpen] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [publishError, setPublishError] = useState<string | null>(null)
  const mountedRef = useRef(true)
  const inFlightRef = useRef(false)

  const updateDraft = trpc.database.updateFormDraft.useMutation()
  const publish = trpc.database.publishForm.useMutation()
  const updateProperty = trpc.database.updateProperty.useMutation()
  const readiness = useMemo(
    () =>
      validateFormPublishReadiness({
        document: state.document,
        properties: form.source.properties.map((property) => ({
          id: property.id,
          type: property.type,
          settings: property.settings ?? null,
        })),
        audience: form.audience,
        customSlug: form.customSlug,
        features,
      }),
    [features, form.audience, form.customSlug, form.source.properties, state.document],
  )

  useEffect(
    () => () => {
      mountedRef.current = false
    },
    [],
  )

  useEffect(() => {
    if (!editable || !state.dirty || state.saveState === 'conflict' || inFlightRef.current) return
    const saveGeneration = state.generation
    const expectedRevision = state.serverRevision
    const document = state.document
    const timer = window.setTimeout(async () => {
      inFlightRef.current = true
      dispatch({ type: 'SAVE_STARTED', generation: saveGeneration })
      try {
        const intents = Object.entries(state.propertyNameIntents)
        for (const [id, name] of intents) {
          await updateProperty.mutateAsync({ pageId, id, name })
          if (!mountedRef.current) return
          dispatch({ type: 'PROPERTY_RENAME_CONFIRMED', propertyId: id, name })
        }
        const updated = await updateDraft.mutateAsync({
          pageId,
          formId: form.id,
          expectedRevision,
          schema: document,
        })
        if (!mountedRef.current) return
        setForm(updated)
        dispatch({
          type: 'SAVE_CONFIRMED',
          generation: saveGeneration,
          revision: updated.draftRevision,
        })
      } catch (error) {
        if (!mountedRef.current) return
        dispatch(
          isConflict(error)
            ? { type: 'SAVE_CONFLICT' }
            : {
                type: 'SAVE_FAILED',
                message: error instanceof Error ? error.message : 'Не удалось сохранить форму',
              },
        )
      } finally {
        inFlightRef.current = false
      }
    }, 700)
    return () => window.clearTimeout(timer)
  }, [
    editable,
    form.id,
    pageId,
    state.dirty,
    state.document,
    state.generation,
    state.propertyNameIntents,
    state.saveState,
    state.serverRevision,
    updateDraft,
    updateProperty,
  ])

  async function refresh() {
    const result = await refetchForm()
    if (result.data) setForm(result.data)
  }

  async function reloadServer() {
    const result = await refetchForm()
    if (!result.data) return
    const document = parseFormVersionDocument(result.data.draftSchema)
    setForm(result.data)
    dispatch({ type: 'SERVER_RELOADED', document, revision: result.data.draftRevision })
  }

  async function publishForm() {
    if (!readiness.ok || state.dirty || state.saveState !== 'idle') return
    setPublishError(null)
    try {
      const published = await publish.mutateAsync({ pageId, formId: form.id })
      setForm(published)
    } catch (error) {
      setPublishError(error instanceof Error ? error.message : 'Не удалось опубликовать')
    }
  }

  if (!desktop) {
    return (
      <Box
        sx={{ height: '100%', display: 'grid', placeItems: 'center', p: 4, textAlign: 'center' }}
      >
        <Stack spacing={1} sx={{ maxWidth: 420 }}>
          <Typography variant="h6">Откройте конструктор на компьютере</Typography>
          <Typography variant="body2" color="text.secondary">
            Для трёх панелей и предпросмотра нужен широкий экран. По ссылке форма работает на любом
            устройстве.
          </Typography>
        </Stack>
      </Box>
    )
  }

  return (
    <Stack sx={{ height: '100%', minHeight: 0, bgcolor: 'background.paper' }}>
      <Stack
        component="header"
        direction="row"
        spacing={1}
        sx={{
          px: 1.5,
          minHeight: 52,
          alignItems: 'center',
          borderBottom: 1,
          borderColor: 'divider',
        }}
      >
        <Box sx={{ minWidth: 120 }} aria-live="polite">
          <Typography
            variant="caption"
            color={
              state.saveState === 'conflict' || state.saveState === 'error'
                ? 'error.main'
                : 'text.secondary'
            }
          >
            {state.saveState === 'conflict'
              ? 'Конфликт версий'
              : state.saveState === 'error'
                ? 'Ошибка сохранения · повторяем'
                : state.saveState === 'saving'
                  ? 'Сохранение…'
                  : state.dirty
                    ? 'Есть изменения'
                    : 'Сохранено'}
          </Typography>
        </Box>
        <Box sx={{ flex: 1 }} />
        <Button onClick={() => setPreviewOpen(true)}>Предпросмотр</Button>
        <Button onClick={() => setResponsesOpen(true)}>
          Ответы {form.acceptedResponses > 0 ? `· ${form.acceptedResponses}` : ''}
        </Button>
        <Button onClick={() => setShareOpen(true)}>Поделиться</Button>
        <Button
          variant="contained"
          startIcon={<PublishIcon />}
          disabled={!readiness.ok || state.dirty || state.saveState !== 'idle' || publish.isPending}
          onClick={() => void publishForm()}
        >
          Опубликовать
        </Button>
      </Stack>
      {!readiness.ok ? (
        <Alert severity="warning" variant="outlined">
          Публикация недоступна: найдено проблем — {readiness.issues.length}. Они отмечены в
          структуре и настройках формы.
        </Alert>
      ) : null}
      {state.saveState === 'conflict' ? (
        <Alert
          severity="error"
          action={
            <Stack direction="row" spacing={0.5}>
              <Button color="inherit" onClick={() => void reloadServer()}>
                Перезагрузить
              </Button>
              <Button
                color="inherit"
                startIcon={<ContentCopyIcon />}
                onClick={() =>
                  navigator.clipboard.writeText(
                    state.conflictLocalJson ?? JSON.stringify(state.document, null, 2),
                  )
                }
              >
                Скопировать локальный JSON
              </Button>
            </Stack>
          }
        >
          Черновик изменился в другой вкладке. Автосохранение остановлено.
        </Alert>
      ) : null}
      {state.saveState === 'error' ? (
        <Alert severity="error">{state.saveError ?? 'Не удалось сохранить форму.'}</Alert>
      ) : null}
      {publishError ? (
        <Alert severity="error" onClose={() => setPublishError(null)}>
          {publishError}
        </Alert>
      ) : null}
      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          display: 'grid',
          gridTemplateColumns: '280px minmax(460px, 1fr) 320px',
        }}
      >
        <FormOutlinePanel
          pageId={pageId}
          workspaceId={form.source.workspaceId}
          selfSourceId={form.source.id ?? form.sourceId}
          state={state}
          properties={form.source.properties}
          issues={readiness.issues}
          dispatch={dispatch}
          onPropertyCreated={refresh}
        />
        <FormPreviewCanvas state={state} dispatch={dispatch} />
        <FormSettingsPanel
          state={state}
          issues={readiness.issues}
          properties={form.source.properties}
          conditionalLogicEnabled={features.formConditionalLogicEnabled}
          dispatch={dispatch}
        />
      </Box>
      <Dialog open={previewOpen} onClose={() => setPreviewOpen(false)} maxWidth="lg" fullWidth>
        <DialogTitle>Предпросмотр</DialogTitle>
        <DialogContent sx={{ p: 0, minHeight: '70vh' }}>
          <FormRenderer version={state.document} mode="preview" submissionDisabled />
        </DialogContent>
      </Dialog>
      <FormSharePanel
        open={shareOpen}
        pageId={pageId}
        form={form}
        draftDocument={state.document}
        hideBranding={state.document.presentation.hideAnyNoteBranding}
        onClose={() => setShareOpen(false)}
        onChanged={refresh}
        onBrandingChange={(hidden) =>
          dispatch({ type: 'PRESENTATION_UPDATED', patch: { hideAnyNoteBranding: hidden } })
        }
      />
      {schema ? (
        <FormResponsesPanel
          open={responsesOpen}
          pageId={pageId}
          formId={form.id}
          formViewId={formViewId}
          schema={schema}
          editable={editable}
          onClose={() => setResponsesOpen(false)}
        />
      ) : null}
    </Stack>
  )
}
