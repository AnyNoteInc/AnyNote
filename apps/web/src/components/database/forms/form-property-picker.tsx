'use client'

import { useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@repo/ui/components'
import {
  FORM_PROPERTY_TYPES,
  type FormInputConfig,
  type FormPropertyRef,
  type FormPropertyType,
  type FormVersionDocument,
} from '@repo/domain/database/forms'

import { trpc } from '@/trpc/client'

interface PropertyOption {
  readonly id: string
  readonly name: string
  readonly type: string
  readonly settings?: unknown
}

export interface FormPropertySelection {
  property: FormPropertyRef
  label: string
  input: FormInputConfig
}

interface FormPropertyPickerProps {
  readonly open: boolean
  readonly pageId: string
  readonly workspaceId?: string
  readonly selfSourceId?: string
  readonly document: FormVersionDocument
  readonly properties: readonly PropertyOption[]
  readonly onClose: () => void
  readonly onAdd: (selection: FormPropertySelection) => void
  readonly onPropertyCreated?: () => Promise<void> | void
}

type OptionSnapshot = { id: string; label: string; color?: string }

const TYPE_LABEL: Record<FormPropertyType, string> = {
  TEXT: 'Текст',
  NUMBER: 'Число',
  STATUS: 'Статус',
  SELECT: 'Выбор',
  MULTI_SELECT: 'Мультивыбор',
  CHECKBOX: 'Флажок',
  DATE: 'Дата',
  PERSON: 'Участник',
  FILE: 'Файл',
  URL: 'Ссылка',
  EMAIL: 'Email',
  PHONE: 'Телефон',
  RELATION: 'Связь',
  PAGE_LINK: 'Ссылка на страницу',
}

function optionsFrom(settings: unknown): OptionSnapshot[] {
  if (!settings || typeof settings !== 'object') return []
  const options = (settings as { options?: unknown }).options
  if (!Array.isArray(options)) return []
  return options.flatMap((option) => {
    if (!option || typeof option !== 'object') return []
    const value = option as { id?: unknown; label?: unknown; color?: unknown }
    if (typeof value.id !== 'string' || typeof value.label !== 'string') return []
    return [
      {
        id: value.id,
        label: value.label,
        ...(typeof value.color === 'string' ? { color: value.color } : {}),
      },
    ]
  })
}

export function inputForProperty(
  type: FormPropertyType,
  settings?: unknown,
): FormInputConfig | null {
  switch (type) {
    case 'TEXT':
      return { kind: 'TEXT', multiline: false, maxLength: 2_000 }
    case 'NUMBER':
      return { kind: 'NUMBER' }
    case 'STATUS':
    case 'SELECT': {
      const options = optionsFrom(settings)
      return options.length > 0 ? { kind: 'SINGLE_CHOICE', appearance: 'LIST', options } : null
    }
    case 'MULTI_SELECT': {
      const options = optionsFrom(settings)
      return options.length > 0
        ? { kind: 'MULTI_CHOICE', appearance: 'CHECKLIST', options, maxSelections: options.length }
        : null
    }
    case 'CHECKBOX':
      return { kind: 'CHECKBOX', consent: false }
    case 'DATE':
      return { kind: 'DATE', includeTime: false }
    case 'PERSON':
      return { kind: 'PERSON', maxSelections: 1 }
    case 'FILE':
      return {
        kind: 'FILE',
        allowedMimeTypes: [],
        maxBytesPerFile: 10 * 1_024 * 1_024,
        maxFiles: 1,
      }
    case 'URL':
      return { kind: 'URL' }
    case 'EMAIL':
      return { kind: 'EMAIL' }
    case 'PHONE':
      return { kind: 'PHONE' }
    case 'RELATION':
      return { kind: 'RELATION', maxSelections: 1 }
    case 'PAGE_LINK':
      return { kind: 'PAGE_LINK' }
  }
}

function isFormPropertyType(type: string): type is FormPropertyType {
  return (FORM_PROPERTY_TYPES as readonly string[]).includes(type)
}

function newUuid(): string {
  return globalThis.crypto.randomUUID()
}

export function FormPropertyPicker({
  open,
  pageId,
  workspaceId,
  selfSourceId,
  document,
  properties,
  onClose,
  onAdd,
  onPropertyCreated,
}: FormPropertyPickerProps) {
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('Новое свойство')
  const [type, setType] = useState<FormPropertyType>('TEXT')
  const [relationTargetSourceId, setRelationTargetSourceId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const createProperty = trpc.database.createProperty.useMutation()
  const sources = trpc.database.listSources.useQuery(
    { workspaceId: workspaceId ?? '00000000-0000-4000-8000-000000000000' },
    { enabled: open && creating && type === 'RELATION' && Boolean(workspaceId) },
  )
  const usedPropertyIds = useMemo(
    () =>
      new Set(
        document.questions.flatMap(({ property }) =>
          property.kind === 'PROPERTY' ? [property.propertyId] : [],
        ),
      ),
    [document.questions],
  )
  const hasTitle = document.questions.some(({ property }) => property.kind === 'TITLE')
  const available = properties.flatMap((property) => {
    if (usedPropertyIds.has(property.id) || !isFormPropertyType(property.type)) return []
    const input = inputForProperty(property.type, property.settings)
    return input ? [{ property, type: property.type, input }] : []
  })

  function addExisting(
    property: PropertyOption,
    propertyType: FormPropertyType,
    input: FormInputConfig,
  ) {
    onAdd({
      property: { kind: 'PROPERTY', propertyId: property.id, propertyType },
      label: property.name,
      input,
    })
    onClose()
  }

  async function createAndAdd() {
    const trimmed = name.trim()
    if (!trimmed) return
    const option = { id: newUuid(), label: 'Вариант 1' }
    const settings =
      type === 'STATUS' || type === 'SELECT' || type === 'MULTI_SELECT'
        ? { options: [option] }
        : type === 'RELATION'
          ? relationTargetSourceId
            ? { relation: { targetSourceId: relationTargetSourceId } }
            : undefined
          : undefined
    if (type === 'RELATION' && !settings) {
      setError('Выберите связанную базу')
      return
    }
    setError(null)
    try {
      const created = await createProperty.mutateAsync({ pageId, type, name: trimmed, settings })
      const input = inputForProperty(type, created.settings)
      if (!input) throw new Error('FORM_PROPERTY_OPTIONS_REQUIRED')
      await onPropertyCreated?.()
      onAdd({
        property: { kind: 'PROPERTY', propertyId: created.id, propertyType: type },
        label: created.name,
        input,
      })
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось создать свойство')
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{creating ? 'Новое свойство' : 'Добавить вопрос'}</DialogTitle>
      <DialogContent dividers>
        {error ? (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        ) : null}
        {creating ? (
          <Stack spacing={2}>
            <TextField
              label="Название нового свойства"
              value={name}
              onChange={(event) => setName(event.target.value)}
              fullWidth
              autoFocus
            />
            <FormControl fullWidth>
              <InputLabel id="new-form-property-type-label">Тип нового свойства</InputLabel>
              <Select
                labelId="new-form-property-type-label"
                label="Тип нового свойства"
                value={type}
                onChange={(event) => setType(event.target.value as FormPropertyType)}
              >
                {FORM_PROPERTY_TYPES.map((propertyType) => (
                  <MenuItem key={propertyType} value={propertyType}>
                    {TYPE_LABEL[propertyType]}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            {type === 'RELATION' ? (
              <FormControl fullWidth>
                <InputLabel id="new-form-relation-target-label">Связанная база</InputLabel>
                <Select
                  labelId="new-form-relation-target-label"
                  label="Связанная база"
                  value={relationTargetSourceId}
                  onChange={(event) => setRelationTargetSourceId(event.target.value)}
                >
                  {(sources.data ?? [])
                    .filter(({ sourceId }) => sourceId !== selfSourceId)
                    .map((source) => (
                      <MenuItem key={source.sourceId} value={source.sourceId}>
                        {source.title ?? 'Без названия'}
                      </MenuItem>
                    ))}
                </Select>
              </FormControl>
            ) : null}
          </Stack>
        ) : (
          <Stack spacing={1}>
            {!hasTitle ? (
              <Button
                variant="outlined"
                onClick={() => {
                  onAdd({
                    property: { kind: 'TITLE' },
                    label: 'Название',
                    input: { kind: 'TEXT', multiline: false, maxLength: 200 },
                  })
                  onClose()
                }}
                sx={{ minHeight: 48, justifyContent: 'flex-start' }}
              >
                Название · системное
              </Button>
            ) : null}
            {available.map(({ property, type: propertyType, input }) => (
              <Button
                key={property.id}
                variant="outlined"
                onClick={() => addExisting(property, propertyType, input)}
                sx={{ minHeight: 48, justifyContent: 'space-between' }}
              >
                <span>{property.name}</span>
                <Typography component="span" variant="caption" color="text.secondary">
                  {TYPE_LABEL[propertyType]}
                </Typography>
              </Button>
            ))}
            {available.length === 0 && hasTitle ? (
              <Typography color="text.secondary">
                Все совместимые свойства уже добавлены.
              </Typography>
            ) : null}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        {creating ? (
          <Button onClick={() => setCreating(false)}>Назад</Button>
        ) : (
          <Button onClick={onClose}>Отмена</Button>
        )}
        {creating ? (
          <Button
            variant="contained"
            disabled={createProperty.isPending || !name.trim()}
            onClick={() => void createAndAdd()}
          >
            Создать и добавить
          </Button>
        ) : (
          <Button variant="contained" onClick={() => setCreating(true)}>
            Создать свойство
          </Button>
        )}
      </DialogActions>
    </Dialog>
  )
}
