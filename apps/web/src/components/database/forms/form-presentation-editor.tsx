'use client'

import { MenuItem, Stack, TextField, Typography } from '@repo/ui/components'
import type { FormCover, FormPresentation } from '@repo/domain/database/forms'

interface FormPresentationEditorProps {
  readonly presentation: FormPresentation
  readonly onChange: (presentation: FormPresentation) => void
}

type CoverKind = 'none' | FormCover['kind']

const COVER_DEFAULTS: Record<Exclude<CoverKind, 'none'>, string> = {
  color: '#6366f1',
  gradient: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
  image: '/logo.png',
}

export function FormPresentationEditor({ presentation, onChange }: FormPresentationEditorProps) {
  const coverKind: CoverKind = presentation.cover?.kind ?? 'none'

  function setOptional(
    field: 'description' | 'icon' | 'organizationName' | 'submitButtonColor',
    value: string,
  ) {
    onChange({ ...presentation, [field]: value || undefined })
  }

  function changeCover(kind: CoverKind) {
    onChange({
      ...presentation,
      cover: kind === 'none' ? undefined : { kind, value: COVER_DEFAULTS[kind] },
    })
  }

  return (
    <Stack spacing={2}>
      <Typography variant="subtitle2">Оформление</Typography>
      <TextField
        fullWidth
        size="small"
        label="Название формы"
        value={presentation.title}
        onChange={(event) => onChange({ ...presentation, title: event.target.value })}
      />
      <TextField
        fullWidth
        multiline
        minRows={3}
        size="small"
        label="Описание формы"
        value={presentation.description ?? ''}
        onChange={(event) => setOptional('description', event.target.value)}
      />
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
        <TextField
          fullWidth
          size="small"
          label="Иконка"
          value={presentation.icon ?? ''}
          placeholder="💬"
          onChange={(event) => setOptional('icon', event.target.value)}
        />
        <TextField
          fullWidth
          size="small"
          label="Организация"
          value={presentation.organizationName ?? ''}
          onChange={(event) => setOptional('organizationName', event.target.value)}
        />
      </Stack>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
        <TextField
          select
          fullWidth
          size="small"
          label="Тип обложки"
          value={coverKind}
          onChange={(event) => changeCover(event.target.value as CoverKind)}
        >
          <MenuItem value="none">Без обложки</MenuItem>
          <MenuItem value="color">Цвет</MenuItem>
          <MenuItem value="gradient">Градиент</MenuItem>
          <MenuItem value="image">Изображение</MenuItem>
        </TextField>
        {presentation.cover ? (
          <TextField
            fullWidth
            size="small"
            label="Значение обложки"
            value={presentation.cover.value}
            helperText={
              presentation.cover.kind === 'image'
                ? 'Путь к публичному изображению AnyNote: /api/files/{id}'
                : presentation.cover.kind === 'gradient'
                  ? 'CSS-градиент'
                  : 'Цвет в формате CSS'
            }
            onChange={(event) =>
              onChange({
                ...presentation,
                cover: { ...presentation.cover!, value: event.target.value },
              })
            }
          />
        ) : null}
      </Stack>
      <Typography variant="subtitle2">Кнопка отправки</Typography>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
        <TextField
          fullWidth
          size="small"
          label="Текст кнопки"
          value={presentation.submitButtonText}
          onChange={(event) => onChange({ ...presentation, submitButtonText: event.target.value })}
        />
        <TextField
          fullWidth
          size="small"
          label="Цвет кнопки"
          value={presentation.submitButtonColor ?? ''}
          placeholder="#6366f1"
          onChange={(event) => setOptional('submitButtonColor', event.target.value)}
        />
      </Stack>
    </Stack>
  )
}
