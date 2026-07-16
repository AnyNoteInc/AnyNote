'use client'

import {
  AddIcon,
  Alert,
  Button,
  DeleteOutlineIcon,
  FormControlLabel,
  IconButton,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@repo/ui/components'
import type { FormInputConfig, FormOptionSnapshot } from '@repo/domain/database/forms'

interface FormInputConfigEditorProps {
  readonly input: FormInputConfig
  readonly onChange: (input: FormInputConfig) => void
}

function optionalNumber(value: string): number | undefined {
  return value === '' ? undefined : Number(value)
}

function optionId(existing: readonly FormOptionSnapshot[]): string {
  let suffix = existing.length + 1
  while (existing.some(({ id }) => id === `option-${suffix}`)) suffix += 1
  return `option-${suffix}`
}

function ChoiceOptions({
  options,
  onChange,
}: {
  options: readonly FormOptionSnapshot[]
  onChange: (options: FormOptionSnapshot[]) => void
}) {
  function update(index: number, patch: Partial<FormOptionSnapshot>) {
    onChange(
      options.map((option, itemIndex) => (itemIndex === index ? { ...option, ...patch } : option)),
    )
  }

  return (
    <Stack spacing={1}>
      <Typography variant="subtitle2">Варианты ответа</Typography>
      {options.map((option, index) => (
        <Stack key={option.id} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <TextField
            fullWidth
            size="small"
            label={`Название варианта ${index + 1}`}
            value={option.label}
            onChange={(event) => update(index, { label: event.target.value })}
          />
          <TextField
            size="small"
            label={`Цвет варианта ${index + 1}`}
            value={option.color ?? ''}
            placeholder="#6366f1"
            onChange={(event) => update(index, { color: event.target.value || undefined })}
            sx={{ width: 150 }}
          />
          <IconButton
            aria-label={`Удалить вариант ${index + 1}`}
            disabled={options.length === 1}
            onClick={() => onChange(options.filter((_, itemIndex) => itemIndex !== index))}
          >
            <DeleteOutlineIcon />
          </IconButton>
        </Stack>
      ))}
      <Button
        size="small"
        startIcon={<AddIcon />}
        sx={{ alignSelf: 'flex-start' }}
        onClick={() =>
          onChange([...options, { id: optionId(options), label: `Вариант ${options.length + 1}` }])
        }
      >
        Добавить вариант
      </Button>
    </Stack>
  )
}

export function FormInputConfigEditor({ input, onChange }: FormInputConfigEditorProps) {
  switch (input.kind) {
    case 'TEXT':
      return (
        <Stack spacing={1.5}>
          <FormControlLabel
            control={
              <Switch
                checked={input.multiline}
                onChange={(_, checked) => onChange({ ...input, multiline: checked })}
              />
            }
            label="Многострочный ответ"
          />
          <Stack direction="row" spacing={1}>
            <TextField
              fullWidth
              size="small"
              type="number"
              label="Минимум символов"
              value={input.minLength ?? ''}
              slotProps={{ htmlInput: { min: 0 } }}
              onChange={(event) =>
                onChange({ ...input, minLength: optionalNumber(event.target.value) })
              }
            />
            <TextField
              fullWidth
              size="small"
              type="number"
              label="Максимум символов"
              value={input.maxLength}
              slotProps={{ htmlInput: { min: 0 } }}
              onChange={(event) => onChange({ ...input, maxLength: Number(event.target.value) })}
            />
          </Stack>
        </Stack>
      )
    case 'NUMBER':
      return (
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
          <TextField
            fullWidth
            size="small"
            type="number"
            label="Минимальное значение"
            value={input.min ?? ''}
            onChange={(event) => onChange({ ...input, min: optionalNumber(event.target.value) })}
          />
          <TextField
            fullWidth
            size="small"
            type="number"
            label="Максимальное значение"
            value={input.max ?? ''}
            onChange={(event) => onChange({ ...input, max: optionalNumber(event.target.value) })}
          />
          <TextField
            fullWidth
            size="small"
            type="number"
            label="Шаг"
            value={input.step ?? ''}
            slotProps={{ htmlInput: { min: Number.MIN_VALUE } }}
            onChange={(event) => onChange({ ...input, step: optionalNumber(event.target.value) })}
          />
        </Stack>
      )
    case 'SINGLE_CHOICE':
      return (
        <Stack spacing={2}>
          <TextField
            select
            size="small"
            label="Вид вариантов"
            value={input.appearance}
            onChange={(event) =>
              onChange({ ...input, appearance: event.target.value as typeof input.appearance })
            }
          >
            <MenuItem value="RADIO">Переключатели</MenuItem>
            <MenuItem value="LIST">Список</MenuItem>
            <MenuItem value="DROPDOWN">Выпадающий список</MenuItem>
          </TextField>
          <ChoiceOptions
            options={input.options}
            onChange={(options) => onChange({ ...input, options })}
          />
        </Stack>
      )
    case 'MULTI_CHOICE':
      return (
        <Stack spacing={2}>
          <TextField
            select
            size="small"
            label="Вид вариантов"
            value={input.appearance}
            onChange={(event) =>
              onChange({ ...input, appearance: event.target.value as typeof input.appearance })
            }
          >
            <MenuItem value="CHECKLIST">Флажки</MenuItem>
            <MenuItem value="MULTI_PICKER">Множественный выбор</MenuItem>
          </TextField>
          <Stack direction="row" spacing={1}>
            <TextField
              fullWidth
              size="small"
              type="number"
              label="Минимум выбранных"
              value={input.minSelections ?? ''}
              slotProps={{ htmlInput: { min: 0, max: input.maxSelections } }}
              onChange={(event) =>
                onChange({ ...input, minSelections: optionalNumber(event.target.value) })
              }
            />
            <TextField
              fullWidth
              size="small"
              type="number"
              label="Максимум выбранных"
              value={input.maxSelections}
              slotProps={{ htmlInput: { min: 1, max: input.options.length } }}
              onChange={(event) =>
                onChange({ ...input, maxSelections: Number(event.target.value) })
              }
            />
          </Stack>
          <ChoiceOptions
            options={input.options}
            onChange={(options) =>
              onChange({
                ...input,
                options,
                maxSelections:
                  input.maxSelections === input.options.length
                    ? options.length
                    : Math.min(Math.max(input.maxSelections, 1), options.length),
                minSelections:
                  input.minSelections === undefined
                    ? undefined
                    : Math.min(input.minSelections, options.length),
              })
            }
          />
        </Stack>
      )
    case 'CHECKBOX':
      return (
        <FormControlLabel
          control={
            <Switch
              checked={input.consent}
              onChange={(_, checked) => onChange({ ...input, consent: checked })}
            />
          }
          label="Использовать как согласие"
        />
      )
    case 'DATE':
      return (
        <FormControlLabel
          control={
            <Switch
              checked={input.includeTime}
              onChange={(_, checked) => onChange({ ...input, includeTime: checked })}
            />
          }
          label="Разрешить выбор времени"
        />
      )
    case 'FILE':
      return (
        <Stack spacing={1.5}>
          <TextField
            fullWidth
            size="small"
            label="Разрешённые MIME-типы"
            value={input.allowedMimeTypes.join(', ')}
            helperText="Через запятую; пустое поле разрешает любые типы"
            onChange={(event) =>
              onChange({
                ...input,
                allowedMimeTypes: event.target.value
                  .split(',')
                  .map((value) => value.trim())
                  .filter(Boolean),
              })
            }
          />
          <Stack direction="row" spacing={1}>
            <TextField
              fullWidth
              size="small"
              type="number"
              label="Байт на файл"
              value={input.maxBytesPerFile}
              slotProps={{ htmlInput: { min: 1 } }}
              onChange={(event) =>
                onChange({ ...input, maxBytesPerFile: Number(event.target.value) })
              }
            />
            <TextField
              fullWidth
              size="small"
              type="number"
              label="Максимум файлов"
              value={input.maxFiles}
              slotProps={{ htmlInput: { min: 1 } }}
              onChange={(event) => onChange({ ...input, maxFiles: Number(event.target.value) })}
            />
          </Stack>
        </Stack>
      )
    case 'PERSON':
    case 'RELATION':
      return (
        <TextField
          fullWidth
          size="small"
          type="number"
          label="Максимум выбранных"
          value={input.maxSelections}
          slotProps={{ htmlInput: { min: 1 } }}
          onChange={(event) => onChange({ ...input, maxSelections: Number(event.target.value) })}
        />
      )
    case 'URL':
    case 'EMAIL':
    case 'PHONE':
    case 'PAGE_LINK':
      return <Alert severity="info">Для этого типа ответа дополнительных настроек нет.</Alert>
    default:
      return null
  }
}
